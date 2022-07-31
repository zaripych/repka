import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function* iteratePackageRootDirectories(startWith: string) {
  let current = startWith;
  while (current !== '/' && current !== '~/') {
    const location = join(current, 'package.json');
    const exists = await stat(location)
      .then((result) => result.isFile())
      .catch(() => false);
    if (exists) {
      yield current;
    }
    current = dirname(current);
  }
}
