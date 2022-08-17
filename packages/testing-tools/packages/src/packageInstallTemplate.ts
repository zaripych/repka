import type { TaskTypes } from '@build-tools/ts';
import { runTurboTasksForSinglePackage } from '@build-tools/ts';
import { logger } from '@build-tools/ts';
import { onceAsync } from '@utils/ts';
import fg from 'fast-glob';
import assert from 'node:assert';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { getTestConfig } from './getTestConfig';
import { copyFiles } from './helpers/copyFiles';
import { deleteTurboCache } from './helpers/deleteTurboCache';
import { findPackageUnderTest } from './helpers/findPackageUnderTest';
import { ignoreErrors } from './helpers/ignoreErrors';
import { randomText } from './helpers/randomText';
import type { PostActionsOpts } from './helpers/runPostActions';
import { runPostActions } from './helpers/runPostActions';
import { readPackageJson, writePackageJson } from './helpers/writePackageJson';
import {
  installPackageAt,
  isSupportedPackageManager,
} from './installPackageAt';
import { sortedDirectoryContents } from './sortedDirectoryContents';

export type PackageInstallTemplateProps = {
  /**
   * Root directory of the package that contains the tests
   */
  packageRootDirectory: string;

  /**
   * Root directory for temporary files where all packages are going to be
   * installed
   */
  testRootDirectory: string;

  /**
   * Root directory for current template
   */
  templateDirectory: string;

  /**
   * Location of the package under test to be installed
   */
  packageInstallSource: string;

  /**
   * Name of the package under test as appears in dependencies in package.json
   */
  packageUnderTest: string;

  /**
   * Type of package under test dependency
   */
  packageUnderTestDependencyType: 'dependencies' | 'devDependencies';

  /**
   * Key/value pair in package.json that references package under test
   */
  packageUnderTestDependency: [key: string, location: string];

  packageManager: 'pnpm' | 'npm' | 'yarn';
};

type PackageInstallResult = {
  propsTriggeringReinstall: {
    packageManager: 'pnpm' | 'npm' | 'yarn';
    packageUnderTest: string;
    packageInstallSource: string;
    packageJsonContents: Record<string, unknown>;
  };
  turboHash: string | undefined;
  cacheBustedInstallSource: string;
};

export type PackageInstallTemplateOpts = {
  importMetaUrl: string;

  /**
   * Name of the template directory, useful when there are multiple
   */
  templateName?: string;

  /**
   * Directory where package under test resides exactly the way before it
   * was meant to be published - this is what is going to be installed as
   * dependency of the template package
   */
  packageUnderTestPublishDirectory?: string;

  /**
   * Whether package under test is a dev dependency or a regular dependency
   */
  packageUnderTestDependencyType?: 'dependencies' | 'devDependencies';

  /**
   * Tasks to run before the integration test
   */
  buildTasks?: [TaskTypes, ...TaskTypes[]];

  /**
   * Install via this package manager
   */
  packageManager?: 'pnpm' | 'npm' | 'yarn';
} & PostActionsOpts<PackageInstallTemplateProps>;

/**
 * Environment variable used to specify package manager to use
 * to install the package under test as dependency
 */
export const TEST_PACKAGE_MANAGER = 'TEST_PACKAGE_MANAGER';

/**
 * Creates a temporary npm package directory with the package under test
 * in dependencies, this will create `package.json` and install all
 * dependencies in `.integration/template` directory which later can be
 * copied over to a sandbox location before running actual tests
 * in those sandboxes.
 */
export function packageInstallTemplate(opts: PackageInstallTemplateOpts) {
  const props = onceAsync(async () => {
    const config = await getTestConfig(fileURLToPath(opts.importMetaUrl));
    const packageUnderTest = await findPackageUnderTest(
      config.packageRootDirectory
    );
    assert(
      packageUnderTest,
      'Name of the package under test should be in the environment variables or provided'
    );
    const envPackageManager = process.env[TEST_PACKAGE_MANAGER];
    const packageManager =
      opts.packageManager ||
      (isSupportedPackageManager(envPackageManager)
        ? envPackageManager
        : 'pnpm');

    const randomId = randomText(8);
    const cacheBustedInstallSource = join(
      config.testRootDirectory,
      `.${randomId}`
    );

    return {
      packageManager,
      packageUnderTest,
      packageInstallSource: resolve(
        opts.packageUnderTestPublishDirectory ||
          join(config.packageRootDirectory, './dist')
      ),
      ...config,
      templateDirectory: join(
        config.testRootDirectory,
        opts.templateName ?? 'template'
      ),
      packageUnderTestDependencyType:
        opts.packageUnderTestDependencyType || 'dependencies',
      packageUnderTestDependency: [
        packageUnderTest,
        `file:${cacheBustedInstallSource}`,
      ] as [key: string, location: string],
      randomId,
      cacheBustedInstallSource,
    };
  });

  return {
    props,
    create: async () => {
      const start = performance.now();

      const allProps = await props();
      const {
        packageRootDirectory,
        testRootDirectory,
        templateDirectory,
        packageUnderTest,
        packageUnderTestDependency,
        packageUnderTestDependencyType,
        packageInstallSource,
        packageManager,
        randomId,
        cacheBustedInstallSource,
      } = allProps;

      logger.info(
        `Test root directory is "${testRootDirectory}", add "--log-level=debug" for more info`
      );

      const templateName = basename(templateDirectory);

      const buildStart = performance.now();

      await runTurboTasksForSinglePackage({
        tasks: opts.buildTasks ?? ['build', 'declarations'],
        packageDir: packageRootDirectory,
        spawnOpts: {
          exitCodes: [0],
        },
      });

      const buildStop = performance.now();

      if (logger.logLevel === 'debug') {
        logger.debug(
          'Package install source ("dist") after build, before install',
          await sortedDirectoryContents(packageInstallSource)
        );
      }

      const installResultFilePath = join(
        templateDirectory,
        'install-result.json'
      );

      const expectedInstallResult: PackageInstallResult = {
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
          (result) => JSON.parse(result) as PackageInstallResult
        )
      );

      const shouldFullInstall =
        !previousInstallResult ||
        JSON.stringify(expectedInstallResult.propsTriggeringReinstall) !==
          JSON.stringify(previousInstallResult.propsTriggeringReinstall);

      if (shouldFullInstall) {
        logger.info(
          `Will install "${templateName}" from scratch using package manager`,
          packageManager
        );

        await ignoreErrors(rm(templateDirectory, { recursive: true }));
        if (previousInstallResult?.cacheBustedInstallSource) {
          await ignoreErrors(
            rm(previousInstallResult.cacheBustedInstallSource, {
              recursive: true,
            })
          );
        }

        // delete cache entry for previous run when we have to reinstall
        if (previousInstallResult?.turboHash) {
          await deleteTurboCache(previousInstallResult.turboHash);
        }

        await mkdir(templateDirectory, { recursive: true });

        await copyFiles({
          source: packageInstallSource,
          destination: cacheBustedInstallSource,
          include: ['**'],
          exclude: ['node_modules'],
          options: {
            dot: true,
          },
        });

        await writePackageJson(templateDirectory, {
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
          [packageUnderTestDependencyType]: Object.fromEntries([
            packageUnderTestDependency,
          ]),
        });

        await runPostActions<PackageInstallTemplateProps>(allProps, {
          targetDirectory: templateDirectory,
          ...opts,
        });

        await installPackageAt({
          directory: templateDirectory,
          packageManager,
        });
      } else {
        logger.debug(
          'Skipping full installation because package.json contents has not changed and props are same',
          Object.keys(expectedInstallResult.propsTriggeringReinstall)
        );

        const dirs = fg.stream(`**/node_modules/${packageUnderTest}`, {
          cwd: templateDirectory,
          absolute: true,
          onlyDirectories: false,
          markDirectories: true,
          onlyFiles: false,
        }) as AsyncIterable<string>;

        const copiedTo: string[] = [];

        const realSource = await realpath(packageInstallSource);

        for await (const dir of dirs) {
          const target = await realpath(dir);
          if (realSource === target) {
            // no need to copy if symlinked
            return;
          }
          if (copiedTo.includes(target)) {
            return;
          }

          await copyFiles({
            source: packageInstallSource,
            destination: dir,
            include: ['**'],
            exclude: ['node_modules'],
            options: {
              dot: true,
            },
          });

          copiedTo.push(target);
        }
      }

      await writeFile(
        installResultFilePath,
        JSON.stringify(expectedInstallResult, undefined, '  '),
        'utf-8'
      );

      const stop = performance.now();

      if (logger.logLevel === 'debug') {
        logger.debug(
          `"${templateName}" after install`,
          await sortedDirectoryContents(templateDirectory, {
            include: [`**`, `node_modules/${packageUnderTest}`],
          })
        );
      }

      logger.debug(
        `Total time to create ${templateName}
  Re-Build Time:      ${((buildStop - buildStart) / 1000).toFixed(2)}s
  ${
    shouldFullInstall
      ? `Full Install Time:  ${((stop - start) / 1000).toFixed(2)}s`
      : `Quick Refresh Time: ${((stop - start) / 1000).toFixed(2)}s`
  }`
      );
    },
    cleanup: async () => {
      const { templateDirectory } = await props();
      await rm(templateDirectory, { recursive: true });
    },
  };
}
