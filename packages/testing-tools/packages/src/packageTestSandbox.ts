import assert from 'node:assert';
import { stat, symlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { logger } from '@build-tools/ts';
import { onceAsync } from '@utils/ts';
import fg from 'fast-glob';

import { getTestConfig } from './getTestConfig';
import { copyFiles } from './helpers/copyFiles';
import { createTestSpawnApi } from './helpers/createSpawnApi';
import { emptyDir } from './helpers/emptyDir';
import { findPackageUnderTest } from './helpers/findPackageUnderTest';
import { ignoreErrors } from './helpers/ignoreErrors';
import type { PostActionsOpts } from './helpers/runPostActions';
import { runPostActions } from './helpers/runPostActions';

type PackageTestSandboxProps = {
  packageRootDirectory: string;
  testRootDirectory: string;
  packageUnderTest: string;
  templateDirectory: string;
  sandboxDirectory: string;
};

export type PackageTestSandboxOpts = {
  tag: string;
  importMetaUrl: string;
  templateName?: string;
  /**
   * Type of the sandbox. Defaults to `symlink`.
   *
   * The sandbox type can be `symlink` when the tests do not make any
   * changes to the `node_modules` directory.
   *
   * When tests add/remove dependencies or re-install dependencies the
   * sandbox type must be `copy` to make sure different tests do not affect
   * each other.
   */
  sandboxType?: 'symlink' | 'copy';

  env?: Record<string, string>;
} & PostActionsOpts<PackageTestSandboxProps>;

/**
 * Creates a sandbox location where we copy already installed packages
 * and files from a template to test them.
 */
export function packageTestSandbox(opts: PackageTestSandboxOpts) {
  const props = onceAsync(async () => {
    const config = await getTestConfig(fileURLToPath(opts.importMetaUrl));
    const packageUnderTest = await findPackageUnderTest(
      config.packageRootDirectory
    );
    assert(
      packageUnderTest,
      'Name of the package under test should be in the environment variables or provided'
    );
    const sandboxDirectory = join(
      config.testRootDirectory,
      `sandbox-${opts.tag}`
    );
    return {
      ...config,
      packageUnderTest,
      templateDirectory: join(
        config.testRootDirectory,
        opts.templateName ?? 'template'
      ),
      sandboxDirectory,
    };
  });

  return {
    props,
    create: async () => {
      const start = performance.now();

      const allProps = await props();
      const { sandboxDirectory, templateDirectory } = allProps;

      const sandboxName = basename(sandboxDirectory);

      const templateExists = await ignoreErrors(
        stat(templateDirectory).then((result) => result.isDirectory())
      );
      if (!templateExists) {
        throw new Error(
          `Template directory doesn't exist, have you specified correct "templateName"?`
        );
      }

      await emptyDir(sandboxDirectory);

      const sandboxType = opts.sandboxType || 'symlink';

      if (sandboxType === 'symlink') {
        await copyFiles({
          source: templateDirectory,
          include: ['**/*'],
          exclude: ['node_modules', 'install-result.json'],
          destination: sandboxDirectory,
          options: {
            dot: true,
          },
        });

        const dirs = fg.stream(
          [`node_modules`, `*/node_modules`, `!(node_modules)/*/node_modules`],
          {
            cwd: templateDirectory,
            onlyDirectories: false,
            markDirectories: false,
            onlyFiles: false,
          }
        ) as AsyncIterable<string>;

        for await (const nodeModulesDir of dirs) {
          await symlink(
            join(templateDirectory, nodeModulesDir),
            join(sandboxDirectory, nodeModulesDir)
          );
        }
      } else {
        await copyFiles({
          source: templateDirectory,
          include: ['**/*'],
          exclude: ['install-result.json'],
          destination: sandboxDirectory,
          options: {
            dot: true,
          },
        });
      }

      await runPostActions(allProps, {
        testFilePath: allProps.testFilePath,
        targetDirectory: sandboxDirectory,
        ...opts,
      });

      const stop = performance.now();

      logger.debug(
        `Total time to create "${sandboxName}" ${(
          (stop - start) /
          1000
        ).toFixed(2)}s`
      );
    },
    ...createTestSpawnApi(async () => {
      const { sandboxDirectory } = await props();
      return {
        cwd: sandboxDirectory,
        env: opts.env,
      };
    }),
  };
}
