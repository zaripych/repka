import { chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'rollup';

const makeExecutable = async (binPath: string) => {
  const mode = await stat(binPath);
  await chmod(binPath, mode.mode | 0o111);
};

export const rollupMakeExecutablePlugin = (): Plugin => {
  return {
    name: 'makeExecutable',
    async writeBundle(options, bundle) {
      if (options.dir) {
        for (const key of Object.keys(bundle)) {
          const binPath = join(options.dir, key);
          await makeExecutable(binPath);
        }
      } else if (options.file) {
        const binPath = options.file;
        await makeExecutable(binPath);
      }
    },
  };
};
