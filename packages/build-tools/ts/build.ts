import { basename, join } from 'path';

import { buildForNode, copy, pipeline } from './src';
import { buildEslintConfigHelpers } from './src/eslint/eslintConfigHelpers.build.js';
import { buildJestConfigHelpers } from './src/jest/jestConfigHelpers.build.js';
import { findTypeDependencies } from './src/utils/findTypeDependencies';

const typeDependencies = await findTypeDependencies([
  '@types/node',
  '@types/jest',
]);

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
  }),
  ...typeDependencies.map((source) =>
    copy({
      include: ['/**/*'],
      destination: join('./dist/@types', basename(source)),
      source,
    })
  )
);
