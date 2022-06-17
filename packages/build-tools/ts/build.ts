import type { InputOption, RollupWatchOptions } from 'rollup';

import { buildForNode, copy, pipeline } from './src';
import { generateBinsPlugin } from './src/bin/generateBinsPlugin';
import { rollupBuild } from './src/rollup/rollupBuild';
import { rollupNodeConfig } from './src/rollup/rollupNodeConfig';

const mjsConfig = async (opts: {
  outDir: string;
  input: InputOption;
}): Promise<RollupWatchOptions> => {
  const standard = await rollupNodeConfig({
    outDir: opts.outDir,
    input: opts.input,
    minify: false,
  });
  return {
    ...standard,
    output: {
      ...standard.output,
      entryFileNames: `[name].gen.mjs`,
      chunkFileNames: `[name].gen.mjs`,
      banner: `// This file is bundled up from './src/*' and needs to be committed`,
    },
  };
};

const binBundleConfig = async () => {
  const { input, generateModulesPlugin: plugin } = await generateBinsPlugin();
  const config = await mjsConfig({
    outDir: './bin/',
    input,
  });
  return {
    ...config,
    plugins: [plugin, ...(config.plugins ? config.plugins : [])],
  };
};

await pipeline(
  async () => rollupBuild(await binBundleConfig()),
  buildForNode({
    externals: ['typescript', 'eslint'],
  }),
  copy({
    include: ['configs/**/*', 'bin/**/*'],
    destination: './dist/',
  })
);
