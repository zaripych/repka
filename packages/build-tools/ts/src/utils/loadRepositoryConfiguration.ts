import { dirname } from 'node:path';

import fg from 'fast-glob';

import { readMonorepoPackagesGlobs } from './readPackagesGlobs';

export async function loadRepositoryConfiguration() {
  const [{ root, packagesGlobs }] = await Promise.all([
    readMonorepoPackagesGlobs(),
  ]);

  if (packagesGlobs.length === 0) {
    return {
      root,
      packagesGlobs,
      packageLocations: [],
      type: 'single-package' as const,
    };
  }

  const packageLocations = await fg(
    packagesGlobs.map((glob) => `${glob}/package.json`),
    {
      cwd: root,
    }
  );

  return {
    root,
    packagesGlobs,
    packageLocations: packageLocations.map((location) => dirname(location)),
    type: 'multiple-packages' as const,
  };
}
