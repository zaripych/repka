import { basename, join } from 'node:path';

import type { TaskDefinition } from '../setup-tasks-definition/definition';

export const createRootPackageJson = (
  opts: {
    packageName?: string;
    directory?: string;
  } = {}
): TaskDefinition => {
  const { directory = process.cwd(), packageName = basename(directory) } = opts;
  const path = join(directory, 'package.json');

  return {
    name: 'package.json',
    description: `Create package.json with repka defaults at root ${directory}`,
    optional: false,

    async shouldExecute({ fileExists }) {
      return !(await fileExists(path));
    },
    async execute({ writeFile }) {
      await writeFile(
        path,
        JSON.stringify({
          name: packageName,
          private: true,
          version: '1.0.0',
          description: '',
          keywords: [],
          license: 'ISC',
          author: '',
          type: 'module',
          scripts: {
            'build:all': 'pnpm turbo run build',
            'build:changed': "pnpm turbo run build --filter='...[HEAD]'",
            integration: 'pnpm turbo run integration',
            'integration:all': 'pnpm turbo run integration',
            'integration:changed':
              "pnpm turbo run integration --filter='...[HEAD]'",
            'lint:all': 'pnpm turbo run lint',
            'lint:changed': "pnpm turbo run lint --filter='...[HEAD]'",
            prepare: 'husky install',
            'prettify:all':
              "prettier './**/*.(json|js|jsx|ts|tsx|html|css|yml|yaml)' --write",
            test: 'pnpm turbo run test',
            'test:all': 'pnpm turbo run test',
            'test:changed': "pnpm turbo run test --filter='...[HEAD]'",
            turbo: 'turbo',
          },
          devDependencies: {
            '@repka-kit/ts':
              'file:///Users/rz/Projects/repka/packages/build-tools/ts/dist',
            husky: '8.0.1',
          },
          engines: {
            node: '16',
          },
        })
      );
    },
  };
};
