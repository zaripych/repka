import { spawnOutput } from '@build-tools/ts';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import type { CopyGlobOpts } from './helpers/copyFiles';
import { copyFiles } from './helpers/copyFiles';
import { findPackageUnderTest } from './helpers/findPackageUnderTest';
import { randomText } from './helpers/randomText';
import type { ReplaceTextOpts } from './helpers/replaceTextInFiles';
import { replaceTextInFiles } from './helpers/replaceTextInFiles';
import { readPackageJson, writePackageJson } from './helpers/writePackageJson';

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
  const rootDirectory = join(
    process.cwd(),
    './.integration',
    `sandbox-${opts.tag}`
  );

  const packageUnderTest = async () => {
    const result = opts.packageUnderTest ?? (await findPackageUnderTest());
    assert(
      !!result,
      'Name of the package under test should be in the environment variables or provided'
    );
    return result;
  };

  const templateLocation =
    opts.templateLocation ?? join(process.cwd(), './.integration', `template`);

  const packageUnderTestPath = async () =>
    join(rootDirectory, 'node_modules', await packageUnderTest());

  return {
    rootDirectory,
    packageUnderTest,
    packageUnderTestPath,
    create: async () => {
      await rm(rootDirectory, { recursive: true }).catch(() => {
        // ignore
      });
      await copyFiles({
        source: templateLocation,
        include: ['**/*'],
        exclude: ['.turbo'],
        destination: rootDirectory,
        options: {
          dot: true,
          // create symlinks instead of copying
          // symlinked content
          followSymbolicLinks: false,
        },
      });
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
              destination: join(rootDirectory, copyOpts.destination || './'),
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
              target: join(rootDirectory, replaceOpts.target || './'),
            })
          )
        );
      }
      const json = await readPackageJson(rootDirectory);
      const modified = opts.packageJson
        ? opts.packageJson({
            ...json,
            name: `package-${randomText(8)}`,
          })
        : {
            ...json,
            name: `package-${randomText(8)}`,
          };
      await writePackageJson(rootDirectory, modified);
    },
    runMain: async (...args: string[]) => {
      const cp = spawn(
        process.execPath,
        [await packageUnderTestPath(), ...args],
        {
          cwd: rootDirectory,
        }
      );
      return {
        output: await spawnOutput(cp, {
          exitCodes: 'any',
        }),
        exitCode: cp.exitCode,
      };
    },
    runBin: async (bin: string, ...args: string[]) => {
      const cp = spawn(join('./node_modules/.bin/', bin), args, {
        cwd: rootDirectory,
      });
      return {
        output: await spawnOutput(cp, {
          exitCodes: 'inherit',
        }),
        exitCode: cp.exitCode,
      };
    },
    cleanup: async () => {
      await rm(rootDirectory, { recursive: true });
    },
  };
}
