import { load } from 'js-yaml';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '../logger/logger';
import { onceAsync } from './onceAsync';
import { repositoryRootPath } from './repositoryRootPath';

const readPackagesGlobsAt = async (monorepoRoot: string) => {
  try {
    const text = await readFile(
      join(monorepoRoot, 'pnpm-workspace.yaml'),
      'utf-8'
    );
    const rootPath = load(text) as {
      packages?: string[];
    };
    return rootPath.packages ?? [];
  } catch (err) {
    logger.debug(err);
    return [];
  }
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
