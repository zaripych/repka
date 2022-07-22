import type { PromiseType } from 'utility-types';

import { asyncToSync } from '../utils/async-to-sync';
import { once } from '../utils/once';
import { readMonorepoPackagesGlobs } from '../utils/readPackagesGlobs';

export const eslintConfigHelpers = async () => {
  const { root, packagesGlobs } = await readMonorepoPackagesGlobs();
  return {
    monorepoRootPath: root,
    packagesGlobs,
    tsConfigGlobs: [
      ...new Set(
        packagesGlobs.map((glob) =>
          glob !== '*' ? `${glob}/tsconfig.json` : 'tsconfig.json'
        )
      ),
    ],
  };
};

export const syncEslintConfigHelpers = once(() => {
  return asyncToSync<PromiseType<ReturnType<typeof eslintConfigHelpers>>>(
    import.meta.url,
    'eslintConfigHelpers',
    []
  );
});
