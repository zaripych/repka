import type { PromiseType } from 'utility-types';

import { asyncToSync } from '../utils/async-to-sync';
import { monorepoRootPath } from '../utils/monorepoRootPath';
import { once } from '../utils/once';
import { readPackagesGlobs } from '../utils/readPackagesGlobs';

export const eslintConfigHelpers = async () => {
  const root = await monorepoRootPath();
  const globs = await readPackagesGlobs(root);
  return {
    monorepoRootPath: root,
    packagesGlobs: globs,
    tsConfigGlobs: [
      ...new Set(
        globs.map((glob) =>
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
