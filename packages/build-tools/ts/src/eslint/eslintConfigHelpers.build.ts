import type { RollupWatchOptions } from 'rollup';

import type { RollupOptionsBuilderOpts } from '../rollup/standardRollupConfig';

export const buildEslintConfigHelpers = ({
  defaultConfig,
}: RollupOptionsBuilderOpts): RollupWatchOptions => {
  const standard = defaultConfig();
  return {
    ...standard,
    output: {
      ...standard.output,
      format: 'commonjs',
      dir: './configs/eslint/',
      entryFileNames: `[name].gen.cjs`,
      chunkFileNames: `[name].gen.cjs`,
      banner: `// This file is bundled up from './src/*' and needs to be committed`,
    },
    input: {
      eslintConfigHelpers: './src/eslint/eslintConfigHelpers.ts',
    },
  };
};