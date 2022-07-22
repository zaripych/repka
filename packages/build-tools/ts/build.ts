import { buildForNode, copy, pipeline } from './src';
import { buildEslintConfigHelpers } from './src/eslint/eslintConfigHelpers.build.js';
import { buildJestConfigHelpers } from './src/jest/jestConfigHelpers.build.js';

await pipeline(
  buildForNode({
    extraRollupConfigs: (opts) => [
      buildJestConfigHelpers(opts),
      buildEslintConfigHelpers(opts),
    ],
  }),
  copy({
    include: ['configs/**/*'],
    destination: './dist/',
  })
);
