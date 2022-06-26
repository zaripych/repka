import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { configFilePath } from '../utils/configFilePath';
import { monorepoRootPath } from '../utils/monorepoRootPath';

export async function ensureTsConfigExists() {
  const root = await monorepoRootPath();
  const expected = join(root, 'tsconfig.json');
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
