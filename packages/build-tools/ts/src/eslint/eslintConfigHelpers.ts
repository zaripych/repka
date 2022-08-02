import type { PromiseType } from 'utility-types';

import { asyncToSync } from '../utils/async-to-sync';
import { once } from '../utils/once';
import { readMonorepoPackagesGlobs } from '../utils/readPackagesGlobs';

export const eslintConfigHelpers = async () => {
  const { root, packagesGlobs } = await readMonorepoPackagesGlobs();
  const globs = new Set(
    packagesGlobs.map((glob) =>
      glob !== '*' ? `${glob}/tsconfig.json` : 'tsconfig.json'
    )
  );
  return {
    monorepoRootPath: root,
    packagesGlobs,
    tsConfigGlobs: globs.size === 0 ? ['tsconfig.json'] : [...globs],
  };
};

export const syncEslintConfigHelpers = once(() => {
  return asyncToSync<PromiseType<ReturnType<typeof eslintConfigHelpers>>>(
    import.meta.url,
    'eslintConfigHelpers',
    []
  );
});
