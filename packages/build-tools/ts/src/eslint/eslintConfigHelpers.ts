import { once } from '@utils/ts';
import { resolveConfig } from 'prettier';

import { asyncToSync } from '../utils/async-to-sync';
import { readMonorepoPackagesGlobs } from '../utils/readPackagesGlobs';

export const getIndentForTemplateIndentRule = async (root: string) => {
  const prettierConfig = await resolveConfig(root);
  const useTabs = prettierConfig?.useTabs ?? false;
  const tabWidth = prettierConfig?.tabWidth ?? 2;
  const indent = useTabs ? '\t'.repeat(tabWidth) : ' '.repeat(tabWidth);

  return indent;
};

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
    indent: await getIndentForTemplateIndentRule(root),
  };
};

export const syncEslintConfigHelpers = once(() => {
  return asyncToSync<Awaited<ReturnType<typeof eslintConfigHelpers>>>(
    import.meta.url,
    'eslintConfigHelpers',
    []
  );
});
