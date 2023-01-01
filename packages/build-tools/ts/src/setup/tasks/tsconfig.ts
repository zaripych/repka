import { ensureTsConfigExists } from '../../tsc/ensureTsConfigExists';
import { taskFactory } from './core/definition';

export const setupTsConfig = taskFactory((opts?: { directory?: string }) => {
  const directory = opts?.directory ?? process.cwd();
  return {
    name: 'tsconfig.json',
    description: `Generate tsconfig.json with repka defaults`,

    async execute({ fileExists, readFile, writeFile }) {
      await ensureTsConfigExists(
        {
          directory,
        },
        {
          fileExists,
          readFile,
          writeFile,
        }
      );
    },
  };
});
