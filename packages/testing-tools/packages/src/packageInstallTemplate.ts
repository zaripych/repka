import type { TaskTypes } from '@build-tools/ts';
import { runTurboTasksForSinglePackage } from '@build-tools/ts';
import { logger } from '@build-tools/ts';
import { onceAsync } from '@utils/ts';
import assert from 'node:assert';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { copyFiles } from './helpers/copyFiles';
import { deleteTurboCache } from './helpers/deleteTurboCache';
import { findPackageUnderTest } from './helpers/findPackageUnderTest';
import { ignoreErrors } from './helpers/ignoreErrors';
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
        'install-result.json'
      );
      const packageUnderTestInstallDirectory = join(
        templateDirectory,
        'node_modules',
        packageUnderTest
      );

      // avoid having to --force install and make it look like
      // we have a new package every time
      const randomId = randomText(8);
      const cacheBustedInstallSource = join(testRootDirectory, `.${randomId}`);

      const expectedInstallResult = {
        propsTriggeringReinstall: {
          packageManager: allProps.packageManager,
          packageUnderTest: allProps.packageUnderTest,
          packageInstallSource: allProps.packageInstallSource,
          packageJsonContents: await readPackageJson(packageInstallSource),
        },
        turboHash: process.env['TURBO_HASH'],
        cacheBustedInstallSource,
      };
      const previousInstallResult = await ignoreErrors(
        readFile(installResultFilePath, 'utf-8').then(
          (result) => JSON.parse(result) as typeof expectedInstallResult
        )
      );

      if (
        !previousInstallResult ||
        JSON.stringify(expectedInstallResult.propsTriggeringReinstall) !==
          JSON.stringify(previousInstallResult.propsTriggeringReinstall)
      ) {
        logger.info('Will install using package manager', packageManager);

        // remove the entire root if the file could not be loaded
        // this means file doesn't exist and we are starting from scratch
        await ignoreErrors(rm(testRootDirectory, { recursive: true }));

        // delete cache entry for previous run when we have to reinstall
        if (previousInstallResult?.turboHash) {
          await deleteTurboCache(previousInstallResult.turboHash);
        }

        await mkdir(templateDirectory, { recursive: true });

        const transform = opts?.packageJson
          ? opts.packageJson
          : (opt: Record<string, unknown>) => opt;

        await copyFiles({
          source: packageInstallSource,
          destination: cacheBustedInstallSource,
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
                [packageUnderTest]: `file:${cacheBustedInstallSource}`,
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
