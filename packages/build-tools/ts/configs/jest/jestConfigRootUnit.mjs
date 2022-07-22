import { join } from 'node:path';

import { jestTransformConfigProp } from './common.mjs';
import { unitTestConfig } from './commonUnit.mjs';
import {
  jestPluginRoot,
  loadRepositoryConfiguration,
  readPackageJson,
} from './jestConfigHelpers.gen.mjs';

async function generateConfig() {
  const repoConfig = await loadRepositoryConfiguration();
  if (repoConfig.type === 'single-package') {
    return {
      ...unitTestConfig,
      ...jestTransformConfigProp(await jestPluginRoot()),
    };
  } else {
    if (repoConfig.root !== process.cwd()) {
      return {
        ...unitTestConfig,
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
          if (
            !packageJson.name ||
            !packageJson.scripts ||
            !packageJson.scripts.test
          ) {
            return false;
          }
          return {
            ...unitTestConfig,
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

export default await generateConfig();
