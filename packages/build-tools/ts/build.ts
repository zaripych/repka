import { buildForNode, copy, pipeline } from './src';
import { dtsBundleGeneratorBuildPlugins } from './src/bin/dtsBundleGeneratorBuildPlugins';
import { buildEslintConfigHelpers } from './src/eslint/eslintConfigHelpers.build.js';
import { buildLoadAndRunGlobalHookConfig } from './src/jest/loadAndRunGlobalHook.build.js';

await pipeline(
  buildForNode({
    plugins: [...dtsBundleGeneratorBuildPlugins()],
    extraRollupConfigs: (opts) => [
      buildLoadAndRunGlobalHookConfig(opts),
      buildEslintConfigHelpers(opts),
    ],
  }),
  copy({
    include: ['configs/**/*', 'bin/**/*'],
    destination: './dist/',
  })
);
