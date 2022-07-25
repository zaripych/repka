import { basename, join } from 'node:path';

import type { TaskDefinition } from '../setup-tasks-definition/definition';

export const createPackageJson = (
  opts: {
    packageName?: string;
    directory?: string;
  } = {}
): TaskDefinition => {
  const { directory = process.cwd(), packageName = basename(directory) } = opts;
  const path = join(directory, 'package.json');

  return {
    name: 'package.json',
    description: `Create package.json with repka defaults at ${directory}`,
    optional: false,

    async shouldExecute({ fileExists }) {
      return !(await fileExists(path));
    },
    async execute({ writeFile }) {
      await writeFile(
        path,
        JSON.stringify({
          name: packageName,
          version: '1.0.0',
          description: '',
          keywords: [],
          license: 'ISC',
          author: '',
          type: 'module',
          exports: 'src/index.ts',
          main: 'src/index.ts',
          types: 'src/index.ts',
          scripts: {
            test: 'repka test',
            lint: 'repka lint',
          },
          devDependencies: {
            '@repka-kit/ts':
              'file:///Users/rz/Projects/repka/packages/build-tools/ts/dist',
          },
        })
      );
    },
  };
};
