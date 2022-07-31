import { spawnOutput } from '@build-tools/ts';
import { onceAsync } from '@utils/ts';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import type { CopyGlobOpts } from './helpers/copyFiles';
import { copyFiles } from './helpers/copyFiles';
import { findPackageUnderTest } from './helpers/findPackageUnderTest';
import { randomText } from './helpers/randomText';
import type { ReplaceTextOpts } from './helpers/replaceTextInFiles';
import { replaceTextInFiles } from './helpers/replaceTextInFiles';
import { readPackageJson, writePackageJson } from './helpers/writePackageJson';
import { loadTestConfig } from './loadTestConfig';

type OptionallyAsync<T> = T | Promise<T> | (() => T | Promise<T>);

async function unwrap<T extends OptionallyAsync<unknown>>(
  value: T
): Promise<T extends OptionallyAsync<infer U> ? U : never> {
  return (await Promise.resolve(
    typeof value === 'function' ? value() : value
  )) as T extends OptionallyAsync<infer U> ? U : never;
}

export type BuildSandboxOpts = {
  tag: string;
  templateLocation?: string;
  packageUnderTest?: string;

  copyFiles?: OptionallyAsync<
    Array<Omit<CopyGlobOpts, 'destination'> & { destination?: string }>
  >;
  replaceTextInFiles?: OptionallyAsync<Array<ReplaceTextOpts>>;
  packageJson?:
    | ((entries: Record<string, unknown>) => Record<string, unknown>)
    | undefined;
};

/**
 * Creates a sandbox location where we copy already installed packages
 * and files from a template to test them.
 */
export function packageTestSandbox(opts: BuildSandboxOpts) {
  const props = onceAsync(async () => {
    const config = await loadTestConfig();
    const packageUnderTest =
      opts.packageUnderTest ??
      (await findPackageUnderTest(config.packageRootDirectory));
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
      templateDirectory:
        opts.templateLocation || join(config.testRootDirectory, 'template'),
      sandboxDirectory,
      packageUnderTestDirectory: join(
        sandboxDirectory,
        'node_modules',
        packageUnderTest
      ),
    };
  });

  return {
    props,
    create: async () => {
      const { sandboxDirectory, templateDirectory } = await props();
      await rm(sandboxDirectory, { recursive: true }).catch(() => {
        // ignore
      });
      await mkdir(sandboxDirectory);
      await copyFiles({
        source: templateDirectory,
        include: ['**/*'],
        exclude: ['node_modules'],
        destination: sandboxDirectory,
        options: {
          dot: true,
          // create symlinks instead of copying
          // symlinked content
          followSymbolicLinks: false,
        },
      });
      await symlink(
        join(templateDirectory, 'node_modules'),
        join(sandboxDirectory, 'node_modules')
      );
      if (opts.copyFiles) {
        const copyFilesOpt = await unwrap(opts.copyFiles);
        assert(
          !copyFilesOpt.some(
            (opt) => opt.destination && isAbsolute(opt.destination)
          ),
          'destination copy paths cannot be absolute, please specify directory relative to the sandbox'
        );
        await Promise.all(
          copyFilesOpt.map((copyOpts) =>
            copyFiles({
              ...copyOpts,
              destination: join(sandboxDirectory, copyOpts.destination || './'),
            })
          )
        );
      }
      if (opts.replaceTextInFiles) {
        const replaceTextInFilesOpt = await unwrap(opts.replaceTextInFiles);
        assert(
          !replaceTextInFilesOpt.some(
            (opt) => opt.target && isAbsolute(opt.target)
          ),
          'replace target paths cannot be absolute, please specify directory relative to the sandbox'
        );
        await Promise.all(
          replaceTextInFilesOpt.map((replaceOpts) =>
            replaceTextInFiles({
              ...replaceOpts,
              target: join(sandboxDirectory, replaceOpts.target || './'),
            })
          )
        );
      }
      const json = await readPackageJson(sandboxDirectory);
      const modified = opts.packageJson
        ? opts.packageJson({
            ...json,
            name: `package-${randomText(8)}`,
          })
        : {
            ...json,
            name: `package-${randomText(8)}`,
          };
      await writePackageJson(sandboxDirectory, modified);
    },
    runMain: async (...args: string[]) => {
      const { packageUnderTestDirectory, sandboxDirectory } = await props();

      const cp = spawn(process.execPath, [packageUnderTestDirectory, ...args], {
        cwd: sandboxDirectory,
      });
      return {
        output: await spawnOutput(cp, {
          exitCodes: 'any',
        }),
        exitCode: cp.exitCode,
      };
    },
    runBin: async (bin: string, ...args: string[]) => {
      const { sandboxDirectory } = await props();

      const cp = spawn(join('./node_modules/.bin/', bin), args, {
        cwd: sandboxDirectory,
      });
      return {
        output: await spawnOutput(cp, {
          exitCodes: 'inherit',
        }),
        exitCode: cp.exitCode,
        ...(cp.signalCode && {
          signalCode: cp.signalCode,
        }),
      };
    },
    cleanup: async () => {
      const { sandboxDirectory } = await props();
      await rm(sandboxDirectory, { recursive: true });
    },
  };
}
