import { filterTruthy } from '@utils/ts';

import { determinePackageManager } from '../utils/determinePackageManager';
import { packageNamePrompt } from './prompts/packageName';
import { repositoryTypePrompt } from './prompts/repositoryType';
import { taskPipeline } from './tasks/core/pipeline';
import { createMinimalScaffolding } from './tasks/createMinimalScaffolding';
import { createPackageJson } from './tasks/createPackageJson';
import { createRepositoryPackageJson } from './tasks/createRepositoryPackageJson';
import { eslintConfigs } from './tasks/eslintConfigs';
import { gitignore } from './tasks/gitignore';
import { readPackageJsonWithDefault } from './tasks/helpers/readPackageJson';
import { install } from './tasks/install';
import { pnpmWorkspaceYaml } from './tasks/pnpmWorkspaceYaml';
import { setupTsConfig } from './tasks/tsconfig';

export async function freshStarterSetup() {
  await taskPipeline(
    [repositoryTypePrompt, packageNamePrompt],
    async ({ readFile }, { repositoryType, packageName }) => {
      const packageManager = await determinePackageManager(
        {
          directory: process.cwd(),
        },
        {
          readPackageJson: (path) =>
            readPackageJsonWithDefault(path, {
              readFile,
            }),
        }
      );
      const packagesGlobs = ['packages/*'];
      const [slug, pkg] = packageName.includes('/')
        ? packageName.split('/')
        : [undefined, packageName];
      const directory = `packages/${pkg}`;
      return filterTruthy([
        gitignore(),
        ...(repositoryType === 'solo'
          ? [
              createMinimalScaffolding(),
              createPackageJson({
                packageName,
                devDependencies: {
                  '@jest/globals': 'lookup:from-our-package-json',
                },
              }),
              eslintConfigs(),
              setupTsConfig(),
            ]
          : [
              createMinimalScaffolding({
                directory,
              }),
              setupTsConfig({
                directory,
              }),
              createPackageJson({
                packageName,
                directory,
              }),
              createRepositoryPackageJson({
                packageName: slug ? `${slug}/repository` : `${pkg}-repository`,
                directory: '.',
                packagesGlobs,
                devDependencies: {
                  '@jest/globals': 'lookup:from-our-package-json',
                },
              }),
              packageManager === 'pnpm' &&
                pnpmWorkspaceYaml({
                  directory: '.',
                  packagesGlobs,
                }),
              eslintConfigs({
                directory: '.',
                packagesGlobs,
              }),
            ]),
        install(),
      ]);
    }
  );
}
