import { join } from 'node:path';

import { spawnToPromise } from '../../child-process/index';
import type { PackageJson } from '../../package-json/packageJson';
import { taskFactory } from './core/definition';
import { determinePackageManager } from './helpers/determinePackageManager';
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
          const command = await determinePackageManager({
            directory: opts.directory,
            packageJson,
          });
          const args: string[] = ['install'];
          if (command === 'pnpm') {
            args.push('--no-frozen-lockfile');
          }
          await spawnToPromise(command, args, {
            cwd: opts.directory,
            stdio: 'inherit',
            exitCodes: [0],
          });
        });
      },
    };
  }
);
