import { buildForNode, copy, pipeline } from './src';
import { buildBinsBundleConfig } from './src/bin/buildBinsBundleConfig';
import { rollupBuild } from './src/rollup/rollupBuild';
import { allFulfilled } from './src/utils/allFullfilled';

await pipeline(
  async () =>
    buildBinsBundleConfig().then((configs) =>
      allFulfilled(configs.map((config) => rollupBuild(config)))
    ),
  buildForNode({
    externals: ['typescript', 'eslint'],
  }),
  copy({
    include: ['configs/**/*', 'bin/**/*'],
    destination: './dist/',
  })
);
