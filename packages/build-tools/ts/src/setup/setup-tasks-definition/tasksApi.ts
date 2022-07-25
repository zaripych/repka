import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { memoizeFunction } from '../../utils/memoizeFunction';
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
  const writeFileCache = new Map<string, string>();
  const ops: Array<() => Promise<void>> = [];
  return {
    fileExists: async (path: string) => {
      return await fileExistsCache.fileExists(path);
    },
    readFile: async (path: string) => {
      const fullPath = resolve(path);
      const existing = writeFileCache.get(fullPath);
      if (existing !== undefined) {
        return existing;
      }
      return await readFileCache.readFile(path);
    },
    readOriginalFile: async (path: string) => {
      return await readFileCache.readFile(path);
    },
    writeFile: async (path: string, data: string) => {
      writeFileCache.set(path, data);
      return Promise.resolve();
    },
    addPostOp: (operation: () => Promise<void>) => {
      ops.push(operation);
    },
    commit: async () => {
      for (const [fullPath, data] of writeFileCache) {
        await mkdirCache.mkdir(dirname(fullPath));
        await writeFile(fullPath, data, 'utf-8');
        await eslintFix(fullPath);
        await prettierWrite(fullPath);
      }
      for (const op of ops) {
        await op();
      }
    },
  };
}
