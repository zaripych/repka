import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { configFilePath } from '../utils/configFilePath';
import { readMonorepoPackagesGlobs } from '../utils/readPackagesGlobs';
import { repositoryRootPath } from '../utils/repositoryRootPath';

async function ensureEslintTsConfigExists() {
  const { root, packagesGlobs } = await readMonorepoPackagesGlobs();
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

  await writeFile(
    expected,
    text.replace(
      '["GLOBS"]',
      JSON.stringify([
        ...new Set(
          packagesGlobs.map((glob) => (glob !== '*' ? `${glob}/*.ts` : `*.ts`))
        ),
      ])
    )
  );
}

async function ensureEslintRootConfigExists() {
  const root = await repositoryRootPath();
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
