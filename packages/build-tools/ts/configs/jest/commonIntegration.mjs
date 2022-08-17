import { join } from 'path';

import { commonConfig, extensions } from './common.mjs';

const roots = [''];
const integrationTestGlobs = [
  '<rootDir>/src/__integration__/**',
  '<rootDir>/__integration__/**',
];
const exts = extensions.join(',');
const integrationTestMatch = integrationTestGlobs
  .flatMap((glob) =>
    roots.map((root) => [root, glob].filter(Boolean).join('/'))
  )
  .map((glob) => [glob, `*.test.{${exts}}`].join('/'));

export const integrationTestConfig = {
  testMatch: integrationTestMatch,
  testTimeout: 1_000 * 60 * 5,
  coverageDirectory: '.coverage-integration',
  globalSetup: join(
    new URL('.', import.meta.url).pathname,
    './integrationSetup.mjs'
  ),
  globalTeardown: join(
    new URL('.', import.meta.url).pathname,
    './integrationTeardown.mjs'
  ),
  ...commonConfig,
};
