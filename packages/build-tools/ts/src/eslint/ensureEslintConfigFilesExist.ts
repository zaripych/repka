import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { configFilePath } from '../utils/configFilePath';
import { readMonorepoPackagesGlobs } from '../utils/readPackagesGlobs';

const defaultDeps = {
  fileExists: (path: string) =>
    stat(path)
      .then((result) => result.isFile())
      .catch(() => false),
  readFile: (path: string) => readFile(path, { encoding: 'utf-8' }),
  writeFile: (path: string, data: string) =>
    writeFile(path, data, { encoding: 'utf-8' }),
};

export async function ensureEslintTsConfigExists(
  opts: {
    directory: string;
    packagesGlobs: string[];
  },
  deps = defaultDeps
) {
  const path = join(opts.directory, 'tsconfig.eslint.json');
  const eslintConfigExists = await deps.fileExists(path);

  if (eslintConfigExists) {
    return;
  }
  const text = await deps.readFile(
    configFilePath('eslint/tsconfig.eslint.json')
  );

  const globs = new Set(
    opts.packagesGlobs.map((glob) => (glob !== '*' ? `${glob}/*.ts` : `*.ts`))
  );

  await deps.writeFile(
    path,
    text.replace(
      '["GLOBS"]',
      JSON.stringify(globs.size === 0 ? ['*.ts'] : [...globs])
    )
  );
}

export async function ensureEslintRootConfigExists(
  opts: { directory: string },
  deps = defaultDeps
) {
  const path = join(opts.directory, '.eslintrc.cjs');
  const eslintConfigExists = await deps.fileExists(path);

  if (eslintConfigExists) {
    return;
  }
  const text = await deps.readFile(configFilePath('eslint/eslint-ref.cjs'));
  await deps.writeFile(path, text);
}

export async function ensureEslintConfigFilesExist() {
  const { root, packagesGlobs } = await readMonorepoPackagesGlobs();
  await Promise.all([
    ensureEslintTsConfigExists({
      directory: root,
      packagesGlobs,
    }),
    ensureEslintRootConfigExists({
      directory: root,
    }),
  ]);
}
