import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { spawnOutput } from '../../../child-process';
import type { JsonType } from '../../../package-json/packageJson';
import { readPackageJsonWithDefault } from './readPackageJson';

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

export async function determinePackageManager(opts: {
  directory: string;
  packageJson?: Record<string, JsonType>;
  read?: (path: string) => Promise<string>;
  default?: 'pnpm' | 'npm' | 'yarn';
}) {
  const path = join(opts.directory, 'package.json');
  const packageJson = opts.read
    ? await readPackageJsonWithDefault(path, {
        readFile: opts.read,
      })
    : opts.packageJson;
  if (!packageJson) {
    throw new Error('Either packageJson or read should be provided');
  }
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
