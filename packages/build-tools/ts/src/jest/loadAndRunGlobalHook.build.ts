import type { RollupWatchOptions } from 'rollup';

import type { RollupOptionsBuilderOpts } from '../rollup/standardRollupConfig';

export const buildLoadAndRunGlobalHookConfig = ({
  defaultConfig,
}: RollupOptionsBuilderOpts): RollupWatchOptions => {
  const standard = defaultConfig();
  return {
    ...standard,
    output: {
      ...standard.output,
      dir: './configs/jest/',
      entryFileNames: `[name].gen.mjs`,
      chunkFileNames: `[name].gen.mjs`,
      banner: `// This file is bundled up from './src/*' and needs to be committed`,
    },
    input: {
      loadAndRunGlobalHook: './src/jest/loadAndRunGlobalHook.ts',
    },
  };
};
