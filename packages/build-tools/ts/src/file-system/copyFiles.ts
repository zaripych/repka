import fg from 'fast-glob';
import type { Stats } from 'node:fs';
import { copyFile, mkdir, realpath, stat, symlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { logger } from '../logger/logger';

export type CopyOptsExtra = Pick<
  fg.Options,
  'cwd' | 'deep' | 'dot' | 'onlyDirectories' | 'followSymbolicLinks'
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

export type CopyBasicOpts = {
  source?: string;
  files: string[];
  destination: string;
  options?: {
    followSymbolicLinks?: boolean;
    dryRun?: boolean;
  };
};

export type CopyOpts = CopyGlobOpts | CopyBasicOpts;

async function entriesFromGlobs({
  source,
  exclude,
  include,
  options,
}: Pick<CopyGlobOpts, 'source' | 'include' | 'exclude' | 'options'>) {
  const entries = await fg(
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
  return entries as Array<{
    path: string;
    stats: Stats;
  }>;
}

async function entriesFromBasic({ files, source }: CopyBasicOpts) {
  const entries = await Promise.all(
    files.map((path) =>
      stat(join(source || '.', path)).then((stats) => {
        if (stats.isDirectory()) {
          return entriesFromGlobs({
            source,
            include: [`${path}**/*`],
            options: {
              dot: true,
            },
          });
        }
        return [
          {
            path: join(source || '.', path),
            stats,
          },
        ];
      })
    )
  );
  return entries.flatMap((entries) => entries);
}

function getDeps(opts: CopyOpts) {
  const normalDeps = {
    mkdir,
    realpath,
    symlink,
    copyFile,
  };
  const dryRunDeps = {
    mkdir: (...[directory]: Parameters<typeof mkdir>) => {
      logger.log('mkdir', { directory });
      return Promise.resolve();
    },
    realpath,
    symlink: (...[source, target]: Parameters<typeof symlink>) => {
      logger.log('symlink', { source, target });
      return Promise.resolve();
    },
    copyFile: (...[source, target]: Parameters<typeof copyFile>) => {
      logger.log('copyFile', { source, target });
      return Promise.resolve();
    },
  };
  const deps = opts.options?.dryRun ? dryRunDeps : normalDeps;
  return deps;
}

export async function copyFiles(opts: CopyOpts) {
  const deps = getDeps(opts);
  const entries =
    'include' in opts
      ? await entriesFromGlobs(opts)
      : 'files' in opts
      ? await entriesFromBasic(opts)
      : [];

  if (opts.options?.dryRun) {
    logger.log(
      'entries',
      entries.map((entry) => entry.path)
    );
  }

  const followSymbolicLinks = opts.options?.followSymbolicLinks ?? false;
  const createdDirs = new Set<string>();

  for (const entry of entries) {
    const sourcePath = entry.path;
    const relativePath = relative(opts.source || '.', sourcePath);
    const targetPath = join(opts.destination, relativePath);
    const info = entry.stats;

    const targetDirectory = dirname(targetPath);
    if (!info.isDirectory() && !createdDirs.has(targetDirectory)) {
      await deps.mkdir(targetDirectory, {
        recursive: true,
      });
      createdDirs.add(targetDirectory);
    }

    if (info.isSymbolicLink() && !followSymbolicLinks) {
      const realSourcePath = await realpath(sourcePath);
      await deps
        .symlink(realSourcePath, targetPath)
        .catch(async (err: NodeJS.ErrnoException) => {
          if (err.code === 'EEXIST') {
            const existingRealSourcePath = await realpath(targetPath);
            if (existingRealSourcePath !== realSourcePath) {
              return Promise.reject(err);
            } else {
              return Promise.resolve();
            }
          }
        });
    } else if (info.isFile()) {
      await deps.copyFile(sourcePath, targetPath);
    } else if (info.isDirectory()) {
      await deps.mkdir(targetPath, {
        recursive: true,
      });
    } else {
      // ignore
    }
  }
}
