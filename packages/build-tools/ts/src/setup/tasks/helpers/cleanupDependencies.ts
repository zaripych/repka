import type { JsonType } from '../../../package-json/packageJson';
import { getDependenciesRecord } from '../../../package-json/packageJson';

/**
 * Cleanup package json dependencies/devDependencies and place repka into
 * valid dependency category, retaining existing versions if present
 *
 * @param packageJson
 * @returns
 */
export function cleanupDependencies(packageJson: Record<string, JsonType>) {
  const repka = '@repka-kit/ts';

  const dependencies = getDependenciesRecord(packageJson, 'dependencies');
  const devDependencies = getDependenciesRecord(packageJson, 'devDependencies');
  const peerDependencies = getDependenciesRecord(
    packageJson,
    'peerDependencies'
  );

  const devDep = devDependencies[repka];
  const dep = dependencies[repka];

  delete dependencies[repka];

  return {
    dependencies,
    devDependencies: {
      ...devDependencies,
      ...((dep || devDep) && {
        [repka]: dep || devDep,
      }),
    },
    peerDependencies,
  };
}
