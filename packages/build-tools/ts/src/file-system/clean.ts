import { rm, stat } from 'node:fs/promises';
import { join } from 'path';

export async function rmrfDist(root = process.cwd()) {
  // ensure we are not deleting some really valuable directory
  // and this one is next to package.json where ./dist is expected to be
  // an output
  const pkgStat = await stat(join(root, './package.json'));
  if (!pkgStat.isFile()) {
    throw new Error('Expected current directory to contain "package.json"');
  }
  await rm(join(root, './dist'), {
    recursive: true,
    force: true,
  });
}
