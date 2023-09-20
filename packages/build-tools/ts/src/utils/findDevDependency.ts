import { join } from 'node:path';

import { isDirectory } from './isDirectory';
import { moduleRootDirectory } from './moduleRootDirectory';
import { upwardDirectorySearch } from './upwardDirectorySearch';

export { readPackageJson } from '../package-json/readPackageJson';
export { loadRepositoryConfiguration } from './loadRepositoryConfiguration';
export { repositoryRootPath } from './repositoryRootPath';

async function lookup(opts: { path: string; lookupPackageName: string }) {
  return await upwardDirectorySearch({
    start: opts.path,
    appendPath: join('node_modules', opts.lookupPackageName),
    test: isDirectory,
  });
}

/**
 * Lookup location for devDependencies of "@repka-kit/ts" - this function will
 * lookup for "opts.lookupPackageName"
 */
export async function findDevDependency(opts: {
  path?: string;
  lookupPackageName: string;
}) {
  const lookupPackageName = opts.lookupPackageName;

  return await lookup({
    path: opts.path ?? moduleRootDirectory(),
    lookupPackageName,
  });
}
