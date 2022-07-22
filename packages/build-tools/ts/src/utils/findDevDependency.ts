import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '../logger/logger';
import { readCwdPackageJson } from '../package-json/readPackageJson';
import { repositoryRootPath } from './repositoryRootPath';

export { readPackageJson } from '../package-json/readPackageJson';
export { loadRepositoryConfiguration } from './loadRepositoryConfiguration';
export { repositoryRootPath } from './repositoryRootPath';

async function testPath(opts: {
  root: string;
  wrapperPackageName: string;
  lookupPackageName: string;
}) {
  const path = join(
    opts.root,
    `node_modules/${opts.wrapperPackageName}/node_modules/${opts.lookupPackageName}`
  );
  return stat(path)
    .then((result) => (result.isDirectory() ? path : undefined))
    .catch(() => undefined);
}

async function testLocalAndRoot({
  wrapperPackageName,
  lookupPackageName,
  repoRootPathPromise,
}: {
  repoRootPathPromise: Promise<string>;
  wrapperPackageName: string;
  lookupPackageName: string;
}) {
  const localPromise = testPath({
    root: process.cwd(),
    wrapperPackageName,
    lookupPackageName,
  });
  const repoRootPath = await repoRootPathPromise;
  if (repoRootPath === process.cwd()) {
    const local = await localPromise;
    if (local) {
      return local;
    }
  } else {
    // test monorepo root as well:
    const rootPromise = testPath({
      root: repoRootPath,
      wrapperPackageName,
      lookupPackageName,
    });
    const local = await localPromise;
    if (local) {
      return local;
    }
    const root = await rootPromise;
    if (root) {
      return root;
    }
  }
  return undefined;
}

function packageName([key, value]: [string, string]) {
  if (value.startsWith('workspace:')) {
    // workspace:package@sem.ver.x
    const result = /workspace:(.*)@(.*)/.exec(value);
    if (result) {
      const [, packageName] = result;
      if (packageName) {
        return packageName;
      }
    }
  }
  if (value.startsWith('npm:')) {
    // npm:package@sem.ver.x
    const result = /npm:(.*)@(.*)/.exec(value);
    if (result) {
      const [, packageName] = result;
      if (packageName) {
        return packageName;
      }
    }
  }
  return key;
}

/**
 * Lookup location for devDependencies of "@repka-kit/ts" - this function will
 * lookup for "opts.lookupPackageName", it favours the local ./node_modules/ path
 * and falls back to the monorepo root.
 *
 * This will also try to lookup alias of the "@repka-kit/ts" package and if that is defined
 * will try to find the dependencies in the dependencies of the aliased package.
 */
export async function findDevDependency(opts: {
  wrapperPackageName?: string;
  lookupPackageName: string;
}) {
  const wrapperPackageName = opts.wrapperPackageName ?? '@repka-kit/ts';
  const lookupPackageName = opts.lookupPackageName;
  // start looking up the repository root to check monorepo scenarios:
  const repoRootPathPromise = repositoryRootPath();

  const defaultResult = await testPath({
    root: process.cwd(),
    lookupPackageName,
    wrapperPackageName,
  });
  if (defaultResult) {
    return defaultResult;
  }

  // lookup for alternative name of @repka-kit/ts
  const wrapperAliasName = await readCwdPackageJson()
    .then((result) => {
      const dependency = Object.entries(result.devDependencies || {}).find(
        (dependency) => packageName(dependency) === wrapperPackageName
      );
      return dependency ? dependency[0] : undefined;
    })
    .catch((err) => {
      logger.warn('Cannot read package json', err);
      return undefined;
    });

  if (!wrapperAliasName) {
    // the only alternative now is the repository root
    const repoRootPath = await repoRootPathPromise;
    if (repoRootPath !== process.cwd()) {
      return await testPath({
        root: repoRootPath,
        lookupPackageName,
        wrapperPackageName,
      });
    }
    return undefined;
  }

  const aliasResult = await testLocalAndRoot({
    repoRootPathPromise,
    lookupPackageName,
    wrapperPackageName: wrapperAliasName,
  });

  return aliasResult;
}
