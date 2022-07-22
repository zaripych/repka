import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function findPackageRootDir(startWith = process.cwd()) {
  let current = startWith;
  while (current !== '/') {
    const location = join(current, 'package.json');
    const exists = await stat(location)
      .then((result) => result.isFile())
      .catch(() => false);
    if (exists) {
      return current;
    }
    current = dirname(current);
  }
  return undefined;
}
