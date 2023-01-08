import type { Config } from 'jest';
import { readInitialOptions } from 'jest-config';
import { join } from 'node:path';

import { readPackageJson } from '../package-json/readPackageJson';
import { loadRepositoryConfiguration } from '../utils/loadRepositoryConfiguration';
import {
  customFlavorTestDefaults,
  jestTransformConfigProp,
  unitTestDefaults,
} from './configBuildingBlocks';
import { generateScript } from './generateScript';
import { jestPluginRoot } from './jestPluginRoot';

export type TestFlavor =
  | 'unit'
  | 'integration'
  | (string & {
      $$custom: never;
    });

async function createConfig(
  flavor: TestFlavor,
  rootDir: string,
  parentRootDir?: string
) {
  const pluginRoot = jestPluginRoot();

  const baseConfig =
    flavor === 'unit' ? unitTestDefaults() : customFlavorTestDefaults(flavor);

  const globalSetup = generateScript({
    script: 'setup',
    flavor,
    rootDir,
  });

  const globalTeardown = generateScript({
    script: 'teardown',
    flavor,
    rootDir,
  });

  process.env['TEST_FLAVOR'] = flavor;

  const jestConfig = readInitialOptions(undefined, {
    packageRootOrConfig: rootDir,
    parentConfigDirname: parentRootDir,
    readFromCwd: false,
    skipMultipleConfigError: true,
  });

  const config = {
    ...baseConfig,
    ...jestTransformConfigProp(await pluginRoot),
    ...(await jestConfig).config,
    globalSetup: await globalSetup,
    globalTeardown: await globalTeardown,
  };

  return config;
}

export async function createJestConfigForSinglePackage({
  flavor = 'unit',
  rootDir = process.cwd(),
}: {
  flavor: TestFlavor;
  rootDir?: string;
}): Promise<Config> {
  return await createConfig(flavor, rootDir);
}

export async function createJestConfigForMonorepo({
  flavor = 'unit',
  cwd = process.cwd(),
}: {
  flavor: TestFlavor;
  cwd: string;
}): Promise<Config> {
  const repoConfig = await loadRepositoryConfiguration();

  if (repoConfig.type === 'single-package') {
    return createJestConfigForSinglePackage({
      flavor,
      rootDir: repoConfig.root,
    });
  }

  if (repoConfig.root !== cwd) {
    return createJestConfigForSinglePackage({ flavor, rootDir: cwd });
  }

  const projects = (
    await Promise.all(
      repoConfig.packageLocations.map(async (location) => {
        const baseConfig = createConfig(flavor, location, cwd);
        const packageJson = readPackageJson(join(location, 'package.json'));
        return {
          ...(await baseConfig),
          rootDir: location,
          displayName: (await packageJson).name,
        };
      })
    )
  ).filter(Boolean);

  const testTimeout = projects.reduce(
    (acc, project) =>
      Math.max(
        acc,
        typeof project.testTimeout === 'number' ? project.testTimeout : 0
      ),
    0
  );

  return {
    ...(testTimeout !== 0 && {
      testTimeout,
    }),
    projects: projects.map(
      ({ coverageDirectory, testTimeout, ...project }) => project
    ),
  };
}
