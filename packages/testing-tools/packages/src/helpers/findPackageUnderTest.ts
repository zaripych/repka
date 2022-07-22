import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function findPackageUnderTest(startWith = process.cwd()) {
  // faster way:
  if (process.env['npm_package_name']) {
    return process.env['npm_package_name'];
  }
  let current = startWith;
  while (current !== '/') {
    const location = join(current, 'package.json');
    const exists = await stat(location)
      .then((result) => result.isFile())
      .catch(() => false);
    if (exists) {
      const contents = await readFile(location, 'utf-8');
      const name = (JSON.parse(contents) as { name?: string }).name;
      if (name) {
        return name;
      }
    }
    current = dirname(current);
  }
  return undefined;
}
