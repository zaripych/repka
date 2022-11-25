import { logger } from '@build-tools/ts';
import fg from 'fast-glob';
import type { Stats } from 'node:fs';
import { copyFile, mkdir, readlink, realpath, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export type CopyOptsExtra = Pick<
  fg.Options,
  'cwd' | 'deep' | 'dot' | 'onlyDirectories'
>;

export type CopyGlobOpts = {
  /**
   * Source directory
   */
  source?: string;
  /**
   * One or more patterns inside directory.
   *
   * NOTE: the directory structure of the matched files/directories is going to be retained
   * relative to the source directory
   */
  include: string[];
  exclude?: string[];
  destination: string;
  options?: CopyOptsExtra & {
    dryRun?: boolean;
  };
};

export type CopyOpts = CopyGlobOpts;

type Entry = {
  path: string;
  stats: Stats;
};

function entriesFromGlobs({
  source,
  exclude,
  include,
  options,
}: Pick<CopyGlobOpts, 'source' | 'include' | 'exclude' | 'options'>) {
  const entries = fg.stream(
    [
      ...(exclude ? exclude.map((glob) => `!${source || '.'}/${glob}`) : []),
      ...include.map((glob) => `${source || '.'}/${glob}`),
    ],
    {
      followSymbolicLinks: false,
      ...options,
      onlyFiles: false,
      stats: true,
      objectMode: true,
    }
  );
  return entries as AsyncIterable<Entry>;
}

function getDeps(opts: CopyOpts) {
  const normalDeps = {
    realpath,
    readlink,
    mkdir,
    symlink,
    copyFile,
  };
  const dryRunDeps = {
    realpath,
    readlink,
    mkdir: (...[directory]: Parameters<typeof mkdir>) => {
      logger.debug('mkdir', { directory });
      return Promise.resolve();
    },
    symlink: (...[source, target]: Parameters<typeof symlink>) => {
      logger.debug('symlink', { source, target });
      return Promise.resolve();
    },
    copyFile: (...[source, target]: Parameters<typeof copyFile>) => {
      logger.debug('copyFile', { source, target });
      return Promise.resolve();
    },
  };
  const deps = opts.options?.dryRun ? dryRunDeps : normalDeps;
  return deps;
}

export async function copyFiles(opts: CopyOpts) {
  const deps = getDeps(opts);

  const createdDirs = new Set<string>();
  const symlinkEntries: Array<Entry> = [];
  const source = resolve(opts.source || '.');

  for await (const entry of entriesFromGlobs(opts)) {
    if (opts.options?.dryRun) {
      console.log('found entry', entry);
    }

    const { path: sourcePath, stats } = entry;
    const targetPath = join(opts.destination, relative(source, sourcePath));

    if (stats.isSymbolicLink()) {
      // skip symbolic links for now as they might be pointing to the
      // files in the directory tree being copied, this allows us to
      // create identical symbolic links later
      symlinkEntries.push(entry);
    } else if (stats.isFile()) {
      const targetDirectory = dirname(targetPath);
      if (!stats.isDirectory() && !createdDirs.has(targetDirectory)) {
        await deps.mkdir(targetDirectory, {
          recursive: true,
        });
        createdDirs.add(targetDirectory);
      }
      await deps.copyFile(sourcePath, targetPath);
    } else if (stats.isDirectory()) {
      await deps.mkdir(targetPath, {
        recursive: true,
      });
      createdDirs.add(targetPath);
    } else {
      // ignore
    }
  }

  const realSource = await deps.realpath(source);
  for (const entry of symlinkEntries) {
    const sourcePath = entry.path;
    const targetPath = join(opts.destination, relative(source, sourcePath));

    const link = await deps.readlink(sourcePath);
    const realLinkTarget = await deps.realpath(sourcePath);

    const linkTargetIsWithinSourceDir = realLinkTarget.startsWith(realSource);
    const relativeLinkAndTargetDirectoryNameSame =
      !isAbsolute(link) && dirname(source) === dirname(opts.destination);

    if (linkTargetIsWithinSourceDir || relativeLinkAndTargetDirectoryNameSame) {
      await deps
        .symlink(link, targetPath)
        .catch(async (err: NodeJS.ErrnoException) => {
          if (err.code === 'EEXIST') {
            const existingLink = await readlink(targetPath);
            if (existingLink !== link) {
              return Promise.reject(err);
            } else {
              return Promise.resolve();
            }
          }
        });
    } else {
      // no way but to create a symlink to the target outside destination:
      await deps
        .symlink(realLinkTarget, targetPath)
        .catch(async (err: NodeJS.ErrnoException) => {
          if (err.code === 'EEXIST') {
            const existingRealSourcePath = await realpath(targetPath);
            if (existingRealSourcePath !== realLinkTarget) {
              return Promise.reject(err);
            } else {
              return Promise.resolve();
            }
          }
        });
    }
  }
}
