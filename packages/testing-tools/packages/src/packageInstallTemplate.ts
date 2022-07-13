import type { TaskTypes } from '@repka-kit/ts';
import {
  runTurboTasksForSinglePackage,
  spawnWithOutputWhenFailed,
} from '@repka-kit/ts';
import { logger } from '@repka-kit/ts';
import assert from 'node:assert';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { copyFiles } from './helpers/copyFiles';
import { randomText } from './helpers/randomText';
import { writePackageJson } from './helpers/writePackageJson';
import { writePnpmWorkspaceYaml } from './helpers/writePnpmWorkspaceYaml';
import { sortedDirectoryContents } from './sortedDirectoryContents';

/**
 * Creates a synthetic npm package with the package under test
 * in dependencies, this will create:
 * ```
 * package.json
 * pnpm-workspace.yaml
 * ```
 * and install all dependencies in `../../../.temporary/template`
 * directory which later can be copied over to a sandbox location
 * before running actual tests on those sandboxes.
 */
export function packageInstallTemplate(opts?: {
  /**
   * Name of the package under test, should be detected automatically from
   * npm_package_name environment variable, otherwise must be provided
   */
  packageUnderTest?: string;
  /**
   * Directory where package under test resides exactly the way before it was meant to be published
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
}) {
  const rootDirectory = join(process.cwd(), './.integration', 'template');

  const packageUnderTest =
    opts?.packageUnderTest ?? process.env['npm_package_name'];
  assert(
    !!packageUnderTest,
    'Name of the package under test should be in the environment variables or provided'
  );

  return {
    rootDirectory,
    packageUnderTest,
    create: async () => {
      logger.debug('Template root directory is', rootDirectory);

      await runTurboTasksForSinglePackage({
        tasks: opts?.buildTasks ?? ['build', 'declarations'],
      });

      if (logger.logLevel === 'debug') {
        logger.debug('"dist" after build', sortedDirectoryContents('./dist'));
      }

      await rm(rootDirectory, { recursive: true }).catch(() => {
        return;
      });
      await mkdir(rootDirectory, { recursive: true });

      const transform = opts?.packageJson
        ? opts.packageJson
        : (opt: Record<string, unknown>) => opt;

      await Promise.all([
        writePackageJson(
          rootDirectory,
          transform({
            name: `package-${randomText(8)}`,
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
              [`${packageUnderTest}`]: `file:${resolve(
                opts?.packageUnderTestPublishDirectory || './dist'
              )}`,
            },
          })
        ),
        writePnpmWorkspaceYaml(rootDirectory),
      ]);

      await spawnWithOutputWhenFailed(
        'pnpm',
        ['install', '--force', '--virtual-store-dir', '../.pnpm'],
        {
          cwd: rootDirectory,
        }
      );

      if (logger.logLevel === 'debug') {
        logger.debug(
          '"./.integration/template" after setup:integration',
          sortedDirectoryContents('./.integration/template', [
            '**',
            '!node_modules/**',
            '!.git/**',
            `node_modules/${packageUnderTest}`,
          ])
        );
      }
    },
    copyTo: async (destination: string) => {
      await copyFiles({
        source: rootDirectory,
        include: ['**/*'],
        destination,
        options: {
          dot: true,
          // create symlinks instead of copying
          // symlinked content
          followSymbolicLinks: false,
        },
      });
    },
    cleanup: async () => {
      await rm(rootDirectory, { recursive: true });
    },
  };
}
