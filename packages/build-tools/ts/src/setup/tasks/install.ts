import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { spawnToPromise } from '../../child-process/index';
import type { PackageJson } from '../../package-json/packageJson';
import type { TaskDefinition } from '../setup-tasks-definition/definition';

async function readPackageJson(
  path: string,
  read: (path: string) => Promise<string>
) {
  const text = await read(path);
  const packageJson = JSON.parse(text) as PackageJson;
  return packageJson;
}

function packageJsonDeps(packageJson: PackageJson) {
  return {
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
    peerDependencies: packageJson.peerDependencies,
    resolutions: packageJson['resolutions'],
    engines: packageJson['engines'],
    packageManager: packageJson['packageManager'],
  };
}

function packageManagerFromPackageJson(packageJson: PackageJson) {
  const pkgMgr = packageJson['packageManager'];
  if (typeof pkgMgr !== 'string') {
    return;
  }
  const valid = ['pnpm', 'yarn', 'npm'];
  const result = new RegExp(`(${valid.join('|')})(@.+)?`).exec(pkgMgr);
  if (!result) {
    return;
  }
  return result[0] as 'yarn' | 'pnpm' | 'npm';
}

async function packageManagerFromFs(directory: string) {
  const contents = await readdir(directory);
  const managerByLockFile: Record<string, 'yarn' | 'pnpm' | 'npm'> = {
    'yarn.lock': 'yarn',
    'pnpm-lock.yaml': 'pnpm',
    'package-lock.json': 'npm',
  };
  const result = contents.find((file) => !!managerByLockFile[file]);
  if (!result) {
    return;
  }
  return managerByLockFile[result];
}

export const install = (opts: { directory: string }): TaskDefinition => {
  return {
    name: 'install',
    description: `Install using your currently configured package manager (pnpm if not configured)`,
    optional: true,

    async execute({ readOriginalFile, readFile, addPostOp }) {
      const original = await readPackageJson(
        join(opts.directory, 'package.json'),
        readOriginalFile
      ).catch(() => ({}));
      const modified = await readPackageJson(
        join(opts.directory, 'package.json'),
        readFile
      ).catch(() => ({}));
      if (
        JSON.stringify(packageJsonDeps(original)) ===
        JSON.stringify(packageJsonDeps(modified))
      ) {
        return;
      }
      addPostOp(async () => {
        const command =
          packageManagerFromPackageJson(modified) ||
          (await packageManagerFromFs(opts.directory)) ||
          'npm';
        await spawnToPromise(command, ['install'], {
          cwd: opts.directory,
          stdio: 'inherit',
          exitCodes: [0],
        });
      });
    },
  };
};
