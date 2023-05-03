import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { onceAsync } from '@utils/ts';

import { moduleRootDirectory } from '../utils/moduleRootDirectory';
import type { PackageJson } from './packageJson';

const cwdPackageJsonPath = () => join(process.cwd(), './package.json');

async function readPackageJsonAt(
  path: string,
  deps = { readFile: (path: string) => readFile(path, 'utf-8') }
): Promise<PackageJson> {
  return await deps
    .readFile(path)
    .then((result) => JSON.parse(result) as PackageJson);
}

export const readCwdPackageJson = onceAsync(() =>
  readPackageJsonAt(cwdPackageJsonPath())
);

export async function readPackageJson(
  path: string,
  deps = { readFile: (path: string) => readFile(path, 'utf-8') }
): Promise<PackageJson> {
  // assuming current directory doesn't change while app is running
  return process.cwd() === cwdPackageJsonPath()
    ? await readCwdPackageJson()
    : await readPackageJsonAt(path, deps);
}

/**
 * Read package json of the current library (@repka-kit/ts)
 */
export const ourPackageJson = onceAsync(
  async (
    deps = {
      readFile: (path: string) => readFile(path, 'utf-8'),
    }
  ) => {
    const packageJsonPath = join(moduleRootDirectory(), 'package.json');
    return await readPackageJsonAt(packageJsonPath, {
      readFile: deps.readFile,
    });
  }
);
