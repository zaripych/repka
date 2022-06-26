import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { configFilePath } from '../utils/configFilePath';

export async function ensureTsConfigExists() {
  const cwdPackageJsonPath = join(process.cwd(), 'package.json');
  const packageJsonExists = await stat(cwdPackageJsonPath)
    .then((result) => result.isFile())
    .catch(() => false);
  if (!packageJsonExists) {
    return;
  }
  const expected = join(process.cwd(), 'tsconfig.json');
  const configExists = await stat(expected)
    .then((result) => result.isFile())
    .catch(() => false);

  if (configExists) {
    return;
  }
  const text = await readFile(configFilePath('tsconfig.pkg.json'), {
    encoding: 'utf-8',
  });
  await writeFile(expected, text);
}
