import { onceAsync } from '@utils/ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PackageJson } from './packageJson';

const cwdPackageJsonPath = () => join(process.cwd(), './package.json');

async function readPackageJsonAt(path: string): Promise<PackageJson> {
  return await readFile(path, 'utf-8').then(
    (result) => JSON.parse(result) as PackageJson
  );
}

export const readCwdPackageJson = onceAsync(() =>
  readPackageJsonAt(cwdPackageJsonPath())
);

export async function readPackageJson(path: string): Promise<PackageJson> {
  // assuming current directory doesn't change while app is running
  return process.cwd() === cwdPackageJsonPath()
    ? await readCwdPackageJson()
    : await readPackageJsonAt(path);
}
