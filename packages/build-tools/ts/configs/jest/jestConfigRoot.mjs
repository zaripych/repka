import { join } from 'node:path';

import { jestTransformConfigProp } from './common.mjs';
import { integrationTestConfig } from './commonIntegration.mjs';
import { unitTestConfig } from './commonUnit.mjs';
import {
  jestPluginRoot,
  loadRepositoryConfiguration,
  readPackageJson,
} from './jestConfigHelpers.gen.mjs';

export async function generateConfig(flavor) {
  const repoConfig = await loadRepositoryConfiguration();
  const testFlavor = flavor || process.env['TEST_FLAVOR'] || 'unit-test';
  const baseConfig =
    testFlavor === 'unit-test' ? unitTestConfig : integrationTestConfig;
  if (repoConfig.type === 'single-package') {
    return {
      ...baseConfig,
      ...jestTransformConfigProp(await jestPluginRoot()),
    };
  } else {
    if (repoConfig.root !== process.cwd()) {
      return {
        ...baseConfig,
        ...jestTransformConfigProp(await jestPluginRoot()),
      };
    }
    const transform = await jestTransformConfigProp(await jestPluginRoot());
    const projects = (
      await Promise.all(
        repoConfig.packageLocations.map(async (location) => {
          const packageJson = await readPackageJson(
            join(location, 'package.json')
          );
          // if (
          //   !packageJson.name ||
          //   !packageJson.scripts ||
          //   !packageJson.scripts.test
          // ) {
          //   return false;
          // }
          return {
            ...baseConfig,
            ...transform,
            displayName: packageJson.name,
            rootDir: location,
          };
        })
      )
    ).filter(Boolean);
    return {
      projects,
    };
  }
}
