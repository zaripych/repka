import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { spawnOutput } from '../child-process';
import type { JsonType } from '../package-json/packageJson';
import { readPackageJson } from './findDevDependency';

function packageManagerFromPackageJson(packageJson: Record<string, JsonType>) {
  const pkgMgr = packageJson['packageManager'];
  if (typeof pkgMgr !== 'string') {
    return;
  }

  const valid = ['pnpm', 'yarn', 'npm'];

  const result = new RegExp(`(${valid.join('|')})(@.+)?`).exec(pkgMgr);
  if (!result) {
    return;
  }

  return result[1] as 'yarn' | 'pnpm' | 'npm';
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

export async function determinePackageManager(
  opts: {
    directory: string;
    packageJson?: Record<string, JsonType>;
    default?: 'pnpm' | 'npm' | 'yarn';
  },
  deps = {
    readPackageJson: (path: string) => readPackageJson(path),
  }
) {
  const path = join(opts.directory, 'package.json');

  const packageJson = opts.packageJson ?? (await deps.readPackageJson(path));

  const [fromPackageJson, fromFs] = await Promise.all([
    packageManagerFromPackageJson(packageJson),
    packageManagerFromFs(opts.directory),
  ]);

  return (
    fromPackageJson ||
    fromFs ||
    opts.default ||
    (await spawnOutput('which', ['pnpm'], { exitCodes: [0] }).then(
      () => 'pnpm',
      () => 'npm'
    ))
  );
}
