import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { onceAsync } from '../utils/onceAsync';
import type { PackageJson } from './packageJson';

const cwdPackageJsonPath = () => join(process.cwd(), './package.json');

export async function readPackageJson(path: string): Promise<PackageJson> {
  return await readFile(path, 'utf-8').then(
    (result) => JSON.parse(result) as PackageJson
  );
}

export const readCwdPackageJson = onceAsync(() =>
  readPackageJson(cwdPackageJsonPath())
);
