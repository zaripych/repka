import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

import { memoizeFunction } from '@utils/ts';

import { latestPackageVersion } from '../../../package-json/latestPackageVersion';
import { ourPackageJson } from '../../../package-json/readPackageJson';
import { addDependencies } from '../helpers/addDependencies';
import { eslintFix } from './eslintFix';
import { prettierWrite } from './prettierWrite';

export function createTasksApi() {
  const mkdirCache = memoizeFunction('mkdir', {
    memoizeFn: async (path: string) => {
      const fullPath = resolve(path);
      await mkdir(fullPath, { recursive: true });
    },
    keyFromArgs: (path: string) => {
      const fullPath = resolve(path);
      return fullPath;
    },
  });
  const fileExistsCache = memoizeFunction('fileExists', {
    memoizeFn: async (path: string) => {
      const fullPath = resolve(path);
      return await stat(fullPath)
        .then((result) => result.isFile())
        .catch(() => false);
    },
    keyFromArgs: (path: string) => {
      const fullPath = resolve(path);
      return fullPath;
    },
  });
  const readFileCache = memoizeFunction('readFile', {
    memoizeFn: async (path: string) => {
      const fullPath = resolve(path);
      return await readFile(fullPath, {
        encoding: 'utf-8',
      });
    },
    keyFromArgs: (path: string) => {
      const fullPath = resolve(path);
      return fullPath;
    },
  });
  const packageVersionCache = memoizeFunction('latestPackageVersion', {
    memoizeFn: latestPackageVersion,
    keyFromArgs: (name) => name,
  });

  const writeFileCache = new Map<string, string>();
  const ops: Array<() => Promise<void>> = [];

  const writeToCache = async (path: string, data: string) => {
    const fullPath = resolve(path);
    writeFileCache.set(fullPath, data);
    return Promise.resolve();
  };

  const readFileUsingWriteCache = async (path: string) => {
    const fullPath = resolve(path);
    const existing = writeFileCache.get(fullPath);
    if (existing !== undefined) {
      return existing;
    }
    return await readFileCache.readFile(path);
  };

  return {
    addDependencies: async (opts: Parameters<typeof addDependencies>[0]) => {
      await addDependencies(opts, {
        readFile: readFileUsingWriteCache,
        writeFile: writeToCache,
        ourPackageJson,
        latestPackageVersion: packageVersionCache.latestPackageVersion,
      });
    },
    fileExists: async (path: string) => {
      return await fileExistsCache.fileExists(path);
    },
    readFile: readFileUsingWriteCache,
    readOriginalFile: async (path: string) => {
      return await readFileCache.readFile(path);
    },
    writeFile: writeToCache,
    addPostOp: (operation: () => Promise<void>) => {
      ops.push(operation);
    },
    commit: async () => {
      for (const [fullPath, data] of writeFileCache) {
        await mkdirCache.mkdir(dirname(fullPath));
        await writeFile(fullPath, data, 'utf-8');
      }
      for (const op of ops) {
        await op();
      }
      const changedFiles = [...writeFileCache.keys()];
      const extensions = [
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.cjs',
        '.mjs',
        '.json',
      ];
      const eslintFiles = changedFiles.filter((file) =>
        extensions.includes(extname(file))
      );
      const prettierFiles = changedFiles.filter((file) =>
        [...extensions, '.yaml', '.yml', '.md', '.html', '.css'].includes(
          extname(file)
        )
      );
      await eslintFix(eslintFiles);
      await prettierWrite(prettierFiles);
    },
  };
}
