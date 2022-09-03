import {
  readFile as nodeReadFile,
  stat,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { configFilePath } from '../utils/configFilePath';

async function fileExists(path: string) {
  return stat(path)
    .then((result) => result.isFile())
    .catch(() => false);
}

async function readFile(path: string) {
  return await nodeReadFile(path, {
    encoding: 'utf-8',
  });
}

async function writeFile(path: string, data: string) {
  await nodeWriteFile(path, data, 'utf-8');
}

export async function ensureTsConfigExists(
  opts?: {
    directory?: string;
  },
  deps = { fileExists, readFile, writeFile }
) {
  const directory = opts?.directory ?? process.cwd();
  if (!opts?.directory) {
    const cwdPackageJsonPath = join(directory, 'package.json');
    const packageJsonExists = await deps.fileExists(cwdPackageJsonPath);
    if (!packageJsonExists) {
      return;
    }
  }
  const path = join(directory, 'tsconfig.json');
  const configExists = await deps.fileExists(path);
  if (configExists) {
    return;
  }
  const text = await deps.readFile(configFilePath('tsconfig.pkg.json'));
  await deps.writeFile(path, text);
}
