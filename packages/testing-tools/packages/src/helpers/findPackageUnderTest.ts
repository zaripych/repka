import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { iteratePackageRootDirectories } from './iteratePackageRootDirectories';

export async function findPackageUnderTest(startWith: string) {
  for await (const directory of iteratePackageRootDirectories(startWith)) {
    const contents = await readFile(join(directory, 'package.json'), 'utf-8');
    const name = (JSON.parse(contents) as { name?: string }).name;
    if (name) {
      return name;
    }
  }
  return undefined;
}
