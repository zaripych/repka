import { buildForNode, copy, pipeline } from './src';
import { dtsBundleGeneratorBuildPlugins } from './src/bin/dtsBundleGeneratorBuildPlugins';

await pipeline(
  buildForNode({
    plugins: [...dtsBundleGeneratorBuildPlugins()],
  }),
  copy({
    include: ['configs/**/*', 'bin/**/*'],
    destination: './dist/',
  })
);
