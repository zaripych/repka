import { UnreachableError } from '@utils/ts';

import { moduleRootDirectory } from '../utils/moduleRootDirectory';
import { dependencyVersionFromPackageJson } from './dependencyVersion';
import {
  isPackageVersionValid,
  latestPackageVersion,
} from './latestPackageVersion';
import type { JsonType } from './packageJson';
import { ourPackageJson } from './readPackageJson';

export type DependencyVersion =
  | (string & {
      _dependencyVersion?: never;
    })
  | 'lookup:from-our-package-json'
  | 'lookup:latest';

export async function lookupPackageVersions(
  dependencies: Record<string, DependencyVersion>,
  deps = {
    latestPackageVersion,
    ourPackageJson,
  }
) {
  const lookupPackageJson = await deps.ourPackageJson();

  return Object.fromEntries(
    await Promise.all(
      Object.entries(dependencies).map(([name, version]) =>
        lookupPackageVersion(
          {
            name,
            version,
            lookupPackageJson,
          },
          { latestPackageVersion: deps.latestPackageVersion }
        )
      )
    )
  );
}

async function lookupPackageVersion(
  opts: {
    name: string;
    version: DependencyVersion;
    lookupPackageJson: Record<string, JsonType>;
  },
  deps = {
    latestPackageVersion,
  }
): Promise<[string, string]> {
  const { name, version, lookupPackageJson } = opts;

  if (!['lookup:from-our-package-json', 'lookup:latest'].includes(version)) {
    return [name, version as string];
  }

  if (version === 'lookup:from-our-package-json') {
    if (name === lookupPackageJson['name']) {
      const ourVersion = lookupPackageJson['version'];

      if (typeof ourVersion !== 'string') {
        throw new Error(
          `Cannot determine version of a dependency "${name}" which we meant to lookup in our own package.json`
        );
      }

      /**
       * @note This is a special case when we are testing installation of
       * "@repka-kit/ts" package before it is published to npm registry.
       *
       * This condition might be affected by the user being offline
       * and us not being able to determine if this version of the package
       * is valid or not.
       */
      const isValid = await isPackageVersionValid(name, ourVersion).catch(
        () => true
      );
      if (!isValid) {
        const filePath = moduleRootDirectory();
        return [name, `file:${filePath}`];
      }

      return [name, ourVersion];
    }

    const version = dependencyVersionFromPackageJson(name, lookupPackageJson);
    if (!version) {
      throw new Error(
        `Cannot determine version of a dependency "${name}" which we meant to lookup in our own package.json`
      );
    }
    return [name, version];
  } else if (version === 'lookup:latest') {
    return [name, await deps.latestPackageVersion(name)];
  } else {
    throw new UnreachableError(version as never);
  }
}
