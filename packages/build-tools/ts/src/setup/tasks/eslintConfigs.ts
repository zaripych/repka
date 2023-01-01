import {
  ensureEslintRootConfigExists,
  ensureEslintTsConfigExists,
} from '../../eslint/ensureEslintConfigFilesExist';
import { taskFactory } from './core/definition';

export const eslintConfigs = taskFactory(
  (opts?: { directory?: string; packagesGlobs?: string[] }) => {
    const directory = opts?.directory ?? process.cwd();
    const packagesGlobs = opts?.packagesGlobs ?? [];
    return {
      name: 'eslint',
      description: `Generate tsconfig.eslint.json and .eslintrc for entire repository`,

      async execute({ fileExists, readFile, writeFile }) {
        await ensureEslintRootConfigExists(
          {
            directory,
          },
          {
            fileExists,
            readFile,
            writeFile,
          }
        );
        await ensureEslintTsConfigExists(
          {
            directory,
            packagesGlobs,
          },
          {
            fileExists,
            readFile,
            writeFile,
          }
        );
      },
    };
  }
);
