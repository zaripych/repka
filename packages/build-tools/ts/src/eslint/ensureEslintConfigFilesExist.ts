import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { configFilePath } from '../utils/configFilePath';
import { monorepoRootPath } from '../utils/monorepoRootPath';
import { readPackagesGlobs } from '../utils/readPackagesGlobs';

async function ensureEslintTsConfigExists() {
  const root = await monorepoRootPath();
  const expected = join(root, 'tsconfig.eslint.json');
  const eslintConfigExists = await stat(expected)
    .then((result) => result.isFile())
    .catch(() => false);

  if (eslintConfigExists) {
    return;
  }
  const text = await readFile(configFilePath('eslint/tsconfig.eslint.json'), {
    encoding: 'utf-8',
  });
  const globs = await readPackagesGlobs(root);
  await writeFile(
    expected,
    text.replace(
      'GLOBS',
      JSON.stringify([
        ...new Set(
          globs.map((glob) => (glob !== '*' ? `${glob}/*.ts` : `*.ts`))
        ),
      ])
    )
  );
}

async function ensureEslintRootConfigExists() {
  const root = await monorepoRootPath();
  const expected = join(root, '.eslintrc.cjs');
  const eslintConfigExists = await stat(expected)
    .then((result) => result.isFile())
    .catch(() => false);

  if (eslintConfigExists) {
    return;
  }
  const text = await readFile(configFilePath('eslint/eslint-ref.cjs'), {
    encoding: 'utf-8',
  });
  await writeFile(expected, text);
}

export async function ensureEslintConfigFilesExist() {
  await Promise.all([
    ensureEslintTsConfigExists(),
    ensureEslintRootConfigExists(),
  ]);
}
