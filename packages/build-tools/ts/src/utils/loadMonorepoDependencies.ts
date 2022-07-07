import fg from 'fast-glob';
import { dirname, join } from 'node:path';

import { logger } from '../logger/logger';
import { readPackageJson } from '../package-json/readPackageJson';
import type { BivarianceHack } from './bivarianceHack';
import { monorepoRootPath } from './monorepoRootPath';
import { readPackagesGlobs } from './readPackagesGlobs';

/**
 * Extract real package name from dependency - should match name
 * in their package json file
 *
 * @param entry Key and value of dependency entry from package.json
 */
function extractPackageName([key, value]: [string, string]) {
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
  return key;
}

type MonorepoDependency = {
  /**
   * Location of the package in monorepo
   */
  packageDirectory: string;

  /**
   * Name of the package as appears in their package json
   */
  packageName: string;

  /**
   * Name of the package as appears in the dependent code
   */
  aliasName: string;
};

/**
 * For a given package directory load all internal monorepo dependencies
 *
 * @param packageDirectory Directory to look for package.json
 */
export async function loadMonorepoDependencies(
  packageDirectory: string = process.cwd()
): Promise<MonorepoDependency[]> {
  const root = await monorepoRootPath();
  const [packagesGlobs, packageJson] = await Promise.all([
    readPackagesGlobs(root),
    readPackageJson(join(packageDirectory, 'package.json')),
  ]);
  if (packagesGlobs.length === 0) {
    return [];
  }
  const packageJsons = fg.stream(
    packagesGlobs.map((glob) => `${glob}/package.json`),
    {
      cwd: root,
    }
  );

  const searchingPackageGlobsFinished = new Promise<void>((res, rej) => {
    packageJsons.on('end', res);
    packageJsons.on('error', rej);
  });
  const tasks: Array<Promise<void>> = [];

  // allows turning regular callbacks into asynchronous callbacks
  const runTask = <T extends BivarianceHack<unknown[], Promise<void>>>(
    cb: T
  ) => {
    return (...args: Parameters<T>) => {
      tasks.push(cb(...args));
    };
  };

  const unresolvedDependencies = new Map(
    [
      ...Object.entries(packageJson.dependencies || {}),
      ...Object.entries(packageJson.devDependencies || {}),
    ].map((dependency) => {
      const packageName = extractPackageName(dependency);
      const aliasName = dependency[0];
      return [
        packageName,
        {
          packageName,
          aliasName,
        },
      ];
    })
  );

  const resolvedDependencies: MonorepoDependency[] = [];

  packageJsons.on(
    'data',
    runTask(async (relativePath: string) => {
      const packageJsonFile = join(root, relativePath);
      const otherPackageJson = await readPackageJson(packageJsonFile);
      if (unresolvedDependencies.size === 0) {
        return;
      }
      if (!otherPackageJson.name) {
        logger.warn(
          `Package json at path ${packageJsonFile} doesn't have a name!`
        );
        return;
      }

      const resolvedPackage = unresolvedDependencies.get(otherPackageJson.name);
      if (!resolvedPackage) {
        // ignore
        return;
      }
      unresolvedDependencies.delete(otherPackageJson.name);

      const packageDirectory = dirname(packageJsonFile);

      resolvedDependencies.push({
        packageDirectory,
        ...resolvedPackage,
      });
    })
  );

  await searchingPackageGlobsFinished.then(() => Promise.allSettled(tasks));

  return resolvedDependencies;
}
