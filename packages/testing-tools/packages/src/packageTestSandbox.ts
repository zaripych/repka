import { spawnOutput } from '@repka-kit/ts';
import { rm } from 'fs/promises';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { join } from 'path';

import type { CopyGlobOpts } from './helpers/copyFiles';
import { copyFiles } from './helpers/copyFiles';
import { readPackageJson, writePackageJson } from './helpers/writePackageJson';
import { packageInstallTemplate } from './packageInstallTemplate';

export type BuildSandboxOpts = {
  tag: string;
  copyFiles?: Array<
    Omit<CopyGlobOpts, 'destination'> & { destination?: string }
  >;
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

  const installTemplate = packageInstallTemplate();

  const packageUnderTestPath = () =>
    join(rootDirectory, 'node_modules', installTemplate.packageUnderTest);

  return {
    rootDirectory,
    packageUnderTest: installTemplate.packageUnderTest,
    packageUnderTestPath,
    create: async () => {
      await rm(rootDirectory, { recursive: true }).catch(() => {
        // ignore
      });
      await installTemplate.copyTo(rootDirectory);
      if (opts.copyFiles) {
        assert(
          !opts.copyFiles.some(
            (opt) => opt.destination && isAbsolute(opt.destination)
          ),
          'destination copy paths cannot be absolute'
        );
        await Promise.all(
          opts.copyFiles.map((copyOpts) =>
            copyFiles({
              ...copyOpts,
              destination: join(rootDirectory, copyOpts.destination || './'),
            })
          )
        );
      }
      if (opts.packageJson) {
        const json = await readPackageJson(rootDirectory);
        await writePackageJson(rootDirectory, opts.packageJson(json));
      }
    },
    runMain: async (...args: string[]) => {
      const cp = spawn(process.execPath, [packageUnderTestPath(), ...args], {
        cwd: rootDirectory,
      });
      return {
        output: await spawnOutput(cp),
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
