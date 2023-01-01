import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

import { latestPackageVersion } from '../../../package-json/latestPackageVersion';
import type { DependencyVersion } from '../../../package-json/lookupPackageVersions';
import { lookupPackageVersions } from '../../../package-json/lookupPackageVersions';
import type {
  DependencyKeys,
  JsonType,
} from '../../../package-json/packageJson';
import { dependencyKeys } from '../../../package-json/packageJson';
import { ourPackageJson } from '../../../package-json/readPackageJson';
import { readPackageJsonWithDefault } from './readPackageJson';

function initDependenciesRecord(
  packageJson: Record<string, JsonType>,
  key: DependencyKeys
): Record<string, string> {
  const packageDependencies = packageJson[key];
  if (typeof packageDependencies !== 'object' || !packageDependencies) {
    const obj = {};
    packageJson[key] = obj;
    return obj;
  }
  return packageDependencies as Record<string, string>;
}

function addSingle(
  toRecord: Record<string, JsonType>,
  [name, version]: [string, string]
) {
  const existing = toRecord[name];
  if (!existing) {
    toRecord[name] = version;
  } else {
    if (existing !== version) {
      throw new Error(
        `Trying to add dependency "${name}":"${version}" but it already exists with different version "${version}"`
      );
    }
  }
}

function addMultiple(
  toRecord: Record<string, JsonType>,
  entries: Array<[string, string]>
) {
  entries.forEach((dep) => {
    addSingle(toRecord, dep);
  });
}

export type AddDependenciesOpts = {
  directory: string;
  dependencies?: Record<string, DependencyVersion>;
  devDependencies?: Record<string, DependencyVersion>;
  peerDependencies?: Record<string, DependencyVersion>;
};

export const addDependencies = async (
  opts: AddDependenciesOpts,
  deps = {
    readFile: (path: string) => readFile(path, 'utf-8'),
    writeFile: (path: string, data: string) => writeFile(path, data, 'utf-8'),
    ourPackageJson,
    latestPackageVersion,
  }
) => {
  const depsByKey = await Promise.all(
    dependencyKeys.map((key) =>
      lookupPackageVersions(opts[key] || {}, {
        latestPackageVersion: deps.latestPackageVersion,
        ourPackageJson: deps.ourPackageJson,
      }).then((result) => Object.entries(result))
    )
  );
  if (depsByKey.every((deps) => deps.length === 0)) {
    return;
  }

  const packageJsonPath = join(opts.directory, 'package.json');
  const packageJson = await readPackageJsonWithDefault(packageJsonPath, {
    readFile: deps.readFile,
  });

  const recordByKey = dependencyKeys.map((key) =>
    initDependenciesRecord(packageJson, key)
  );

  for (let i = 0; i < dependencyKeys.length; i += 1) {
    const packageDependencies = recordByKey[i];
    const dependenciesToAdd = depsByKey[i];
    if (!packageDependencies || !dependenciesToAdd) {
      continue;
    }
    addMultiple(packageDependencies, dependenciesToAdd);
  }

  await deps.writeFile(packageJsonPath, JSON.stringify(packageJson));
};
