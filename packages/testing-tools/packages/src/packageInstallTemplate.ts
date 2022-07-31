import type { TaskTypes } from '@build-tools/ts';
import { runTurboTasksForSinglePackage } from '@build-tools/ts';
import { logger } from '@build-tools/ts';
import { onceAsync } from '@utils/ts';
import assert from 'node:assert';
import {
  mkdir,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { copyFiles } from './helpers/copyFiles';
import { findPackageUnderTest } from './helpers/findPackageUnderTest';
import { randomText } from './helpers/randomText';
import { readPackageJson, writePackageJson } from './helpers/writePackageJson';
import { installPackage, isSupportedPackageManager } from './installPackage';
import { loadTestConfig } from './loadTestConfig';
import { sortedDirectoryContents } from './sortedDirectoryContents';

/**
 * Environment variable used to specify package manager to use
 * to install the package under test as dependency
 */
export const TEST_PACKAGE_MANAGER = 'TEST_PACKAGE_MANAGER';

/**
 * Creates a temporary npm package directory with the package under test
 * in dependencies, this will create:
 * ```
 * package.json
 * pnpm-workspace.yaml
 * ```
 * and install all dependencies in `.integration/template`
 * directory which later can be copied over to a sandbox location
 * before running actual tests on those sandboxes.
 */
export function packageInstallTemplate(opts?: {
  /**
   * Name of the package under test, should be detected automatically from
   * npm_package_name environment variable, or from the nearest package.json,
   * otherwise must be provided
   */
  packageUnderTest?: string;
  /**
   * Directory where package under test resides exactly the way before it
   * was meant to be published - this is what is going to be installed as
   * dependency of the template package
   */
  packageUnderTestPublishDirectory?: string;
  /**
   * Additional entries in the package JSON of the module which depends on the
   * package under test
   */
  packageJson?: (entries: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Tasks to run before the integration test
   */
  buildTasks?: [TaskTypes, ...TaskTypes[]];
  /**
   * Install via this package manager
   */
  packageManager?: 'pnpm' | 'npm' | 'yarn';
}) {
  const props = onceAsync(async () => {
    const config = await loadTestConfig();
    const packageUnderTest =
      opts?.packageUnderTest ??
      (await findPackageUnderTest(config.packageRootDirectory));
    assert(
      packageUnderTest,
      'Name of the package under test should be in the environment variables or provided'
    );
    const envPackageManager = process.env[TEST_PACKAGE_MANAGER];
    const packageManager =
      opts?.packageManager ||
      (isSupportedPackageManager(envPackageManager)
        ? envPackageManager
        : 'pnpm');
    return {
      packageManager,
      packageUnderTest,
      packageInstallSource: resolve(
        opts?.packageUnderTestPublishDirectory ||
          join(config.packageRootDirectory, './dist')
      ),
      ...config,
      templateDirectory: join(config.testRootDirectory, 'template'),
    };
  });

  return {
    props,
    create: async () => {
      const allProps = await props();
      const {
        packageRootDirectory,
        testRootDirectory,
        templateDirectory,
        packageUnderTest,
        packageInstallSource,
        packageManager,
      } = allProps;

      logger.info(
        `Test root directory is "${testRootDirectory}", add "--log-level=debug" for more info`
      );

      await runTurboTasksForSinglePackage({
        tasks: opts?.buildTasks ?? ['build', 'declarations'],
        packageDir: packageRootDirectory,
        spawnOpts: {
          exitCodes: [0],
        },
      });

      if (logger.logLevel === 'debug') {
        logger.debug(
          '"dist" after build, before install',
          await sortedDirectoryContents(packageInstallSource)
        );
      }

      const installResultFilePath = join(
        testRootDirectory,
        'template-install-result.json'
      );
      const packageUnderTestInstallDirectory = join(
        templateDirectory,
        'node_modules',
        packageUnderTest
      );

      const currentContents = readPackageJson(packageInstallSource);
      const expectedInstallResult = {
        ...allProps,
        packageJsonContents: await currentContents,
      };
      const previousInstallResult = await readFile(
        installResultFilePath,
        'utf-8'
      )
        .then((result) => JSON.parse(result) as Record<string, unknown>)
        .catch(() => undefined);

      if (
        !previousInstallResult ||
        JSON.stringify(expectedInstallResult) !==
          JSON.stringify(previousInstallResult)
      ) {
        await rm(templateDirectory, { recursive: true }).catch(() => {
          return;
        });
        await mkdir(templateDirectory, { recursive: true });

        const transform = opts?.packageJson
          ? opts.packageJson
          : (opt: Record<string, unknown>) => opt;

        // avoid having to --force install and make it look like
        // we have a new package every time
        const randomId = randomText(8);
        const cacheBustedLocation = join(testRootDirectory, `.${randomId}`);
        await copyFiles({
          source: packageInstallSource,
          destination: cacheBustedLocation,
          include: ['**'],
          exclude: ['node_modules'],
          options: {
            dot: true,
          },
        });

        await Promise.all([
          writePackageJson(
            templateDirectory,
            transform({
              name: `package-${randomId}`,
              private: true,
              version: '1.0.0',
              description: '',
              main: 'index.js',
              scripts: {
                test: 'echo "Error: no test specified" && exit 1',
              },
              keywords: [],
              author: '',
              license: 'ISC',
              type: 'module',
              dependencies: {
                [packageUnderTest]: `file:${cacheBustedLocation}`,
              },
            })
          ),
        ]);

        await installPackage({
          directory: templateDirectory,
          packageManager,
        });
      } else {
        logger.info(
          'Skipping installation because package.json contents has not changed and props are same',
          allProps
        );
        await unlink(installResultFilePath);
        if (
          (await realpath(packageInstallSource)) !==
          (await realpath(packageUnderTestInstallDirectory))
        ) {
          await copyFiles({
            source: packageInstallSource,
            destination: packageUnderTestInstallDirectory,
            include: ['**'],
            exclude: ['node_modules'],
            options: {
              dot: true,
            },
          });
        }
      }

      await writeFile(
        installResultFilePath,
        JSON.stringify(expectedInstallResult, undefined, '  '),
        'utf-8'
      );

      if (logger.logLevel === 'debug') {
        logger.debug(
          '"./template" after setup:integration',
          await sortedDirectoryContents(templateDirectory, {
            include: [`**`, `node_modules/${packageUnderTest}`],
          })
        );
      }
    },
    cleanup: async () => {
      const { templateDirectory } = await props();
      await rm(templateDirectory, { recursive: true });
    },
  };
}
