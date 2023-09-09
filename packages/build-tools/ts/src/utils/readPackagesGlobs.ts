import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { onceAsync } from '@utils/ts';
import { load } from 'js-yaml';

import { readPackageJson } from './findDevDependency';
import { repositoryRootPath } from './repositoryRootPath';

async function tryReadingPnpmWorkspaceYaml(monorepoRoot: string) {
  const text = await readFile(
    join(monorepoRoot, 'pnpm-workspace.yaml'),
    'utf-8'
  );
  const rootPath = load(text) as {
    packages?: string[];
  };
  return Array.isArray(rootPath.packages) && rootPath.packages.length > 0
    ? rootPath.packages
    : undefined;
}

async function tryReadingPackageJsonWorkspaces(monorepoRoot: string) {
  const packageJson = await readPackageJson(join(monorepoRoot, 'package.json'));
  const workspaces = packageJson['workspaces'];
  return Array.isArray(workspaces) && workspaces.length > 0
    ? workspaces.flatMap((entry) => (typeof entry === 'string' ? [entry] : []))
    : undefined;
}

const readPackagesGlobsAt = async (monorepoRoot: string) => {
  const [pnpmWorkspaces, packageJsonWorkspaces] = await Promise.all([
    tryReadingPnpmWorkspaceYaml(monorepoRoot).catch(() => undefined),
    tryReadingPackageJsonWorkspaces(monorepoRoot).catch(() => undefined),
  ]);
  return pnpmWorkspaces || packageJsonWorkspaces || [];
};

/**
 * Determine monorepo packages glob by reading one of the supported
 * files
 *
 * NOTE: only pnpm is supported at the moment
 */
export const readMonorepoPackagesGlobs = onceAsync(async () => {
  const root = await repositoryRootPath();
  const packagesGlobs = await readPackagesGlobsAt(root);
  return {
    root,
    packagesGlobs,
  };
});
