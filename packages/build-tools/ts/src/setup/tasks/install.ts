import { join } from 'node:path';

import { spawnToPromise } from '../../child-process/index';
import type { PackageJson } from '../../package-json/packageJson';
import { determinePackageManager } from '../../utils/determinePackageManager';
import { taskFactory } from './core/definition';
import { readPackageJsonWithDefault } from './helpers/readPackageJson';

function packageJsonFieldsCausingReinstall(packageJson: PackageJson) {
  return {
    bin: packageJson.bin,
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
    peerDependencies: packageJson.peerDependencies,
    resolutions: packageJson['resolutions'],
    engines: packageJson['engines'],
    packageManager: packageJson['packageManager'],
  };
}

export const install = taskFactory(
  (opts: { directory: string } = { directory: process.cwd() }) => {
    return {
      name: 'install',
      description: `Install using your currently configured package manager (pnpm if not configured)`,

      async execute({ readOriginalFile, readFile, addPostOp }) {
        const original = await readPackageJsonWithDefault(
          join(opts.directory, 'package.json'),
          { readFile: readOriginalFile }
        );

        const packageJson = await readPackageJsonWithDefault(
          join(opts.directory, 'package.json'),
          { readFile: readFile }
        );

        if (
          JSON.stringify(packageJsonFieldsCausingReinstall(original)) ===
          JSON.stringify(packageJsonFieldsCausingReinstall(packageJson))
        ) {
          return;
        }

        addPostOp(async () => {
          const command = await determinePackageManager(
            {
              directory: opts.directory,
              packageJson,
            },
            {
              readPackageJson: (path) =>
                readPackageJsonWithDefault(path, {
                  readFile,
                }),
            }
          );
          const args: string[] = ['install'];
          if (command === 'pnpm') {
            args.push('--prefer-offline');
            args.push('--no-frozen-lockfile');
            args.push('--reporter=default');
          }
          await spawnToPromise(command, args, {
            cwd: opts.directory,
            stdio: 'pipe',
            exitCodes: [0],
            shell: process.platform === 'win32',
            env: {
              ...process.env,
              CI: 'true',
            },
          });
        });
      },
    };
  }
);
