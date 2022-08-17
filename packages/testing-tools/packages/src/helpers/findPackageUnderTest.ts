import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { iteratePackageRootDirectories } from './iteratePackageRootDirectories';

export async function findPackageUnderTest(startWith: string) {
  // faster way:
  if (process.env['npm_package_name']) {
    return process.env['npm_package_name'];
  }
  for await (const directory of iteratePackageRootDirectories(startWith)) {
    const contents = await readFile(join(directory, 'package.json'), 'utf-8');
    const name = (JSON.parse(contents) as { name?: string }).name;
    if (name) {
      return name;
    }
  }
  return undefined;
}
