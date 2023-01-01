import type { DepsOf } from '@utils/ts';

import type { DependencyVersion } from '../../../package-json/lookupPackageVersions';
import { lookupPackageVersions } from '../../../package-json/lookupPackageVersions';
import type { DependencyKeys } from '../../../package-json/packageJson';
import { dependencyKeys } from '../../../package-json/packageJson';

export async function lookupAndMergeDependencies(
  original: {
    [keys in DependencyKeys]?: Record<string, string>;
  },
  mergeWith: {
    [keys in DependencyKeys]?: Record<string, DependencyVersion>;
  },
  deps?: DepsOf<typeof lookupPackageVersions>
) {
  return Object.fromEntries(
    await Promise.all(
      dependencyKeys.map(async (key) => {
        const record = mergeWith[key];
        return [
          key,
          {
            ...original[key],
            ...(record && (await lookupPackageVersions(record, deps))),
          },
        ];
      })
    )
  ) as {
    [keys in DependencyKeys]?: Record<string, string>;
  };
}
