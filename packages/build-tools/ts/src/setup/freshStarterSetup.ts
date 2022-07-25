import prompts from 'prompts';

import { taskPipeline } from './setup-tasks-definition/pipeline';
import { createPackageJson } from './tasks/createPackageJson';
import { createRootPackageJson } from './tasks/createRootPackageJson';
import { install } from './tasks/install';
import { setupTsConfig } from './tasks/tsconfig';

export async function freshStarterSetup() {
  const result = await prompts({
    message: 'Please select the type of repository you wish to initialize',
    name: 'type',
    type: 'select',
    choices: [
      {
        title: 'solo',
        description:
          'You only ever going to have a single package in your repository',
        value: 'solo',
      },
      {
        title: 'monorepo',
        description: 'Setup for multiple packages',
        value: 'monorepo',
      },
    ],
  });

  const type = result.type as 'single-package' | 'monorepo';

  if (type === 'single-package') {
    await taskPipeline([
      createPackageJson(),
      setupTsConfig(),
      install({
        directory: process.cwd(),
      }),
    ]);
  } else {
    await taskPipeline([
      createRootPackageJson(),
      setupTsConfig(),
      install({
        directory: process.cwd(),
      }),
    ]);
  }
}
