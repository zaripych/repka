import { load } from 'js-yaml';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '../logger/logger';
import { monorepoRootPath } from './monorepoRootPath';
import { onceAsync } from './onceAsync';

/**
 * Determine monorepo packages glob by reading one of the supported
 * files
 *
 * NOTE: only pnpm is supported at the moment
 */
export const readPackagesGlobs = async (monorepoRoot: string) => {
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
    logger.error(err);
    return [];
  }
};

export const readMonorepoPackagesGlobs = onceAsync(async () => {
  const root = await monorepoRootPath();
  const packagesGlobs = await readPackagesGlobs(root);
  return {
    root,
    packagesGlobs,
  };
});
