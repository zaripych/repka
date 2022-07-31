import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'path';

export async function readPackageJson(directory: string) {
  const text = await readFile(join(directory, 'package.json'), {
    encoding: 'utf-8',
  });
  const json = JSON.parse(text) as Record<string, unknown>;
  return json;
}

export async function writePackageJson(
  directory: string,
  packageJson: Record<string, unknown>
) {
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify(packageJson, undefined, '  '),
    {
      encoding: 'utf-8',
    }
  );
}
