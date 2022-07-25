import { ensureTsConfigExists } from '../../tsc/ensureTsConfigExists';
import type { TaskDefinition } from '../setup-tasks-definition/definition';

export const setupTsConfig = (): TaskDefinition => {
  return {
    name: 'tsconfig.json',
    description: `Generate tsconfig.json with repka defaults, you will need a tsconfig.json for every package and it's going to be created automatically on lint`,
    optional: true,

    async execute({ fileExists, readFile, writeFile }) {
      await ensureTsConfigExists(
        {
          ensurePackageJsonInCurrentDirectory: false,
        },
        {
          fileExists,
          readFile,
          writeFile,
        }
      );
    },
  };
};
