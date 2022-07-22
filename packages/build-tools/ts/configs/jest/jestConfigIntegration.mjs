import { join } from 'path';

import {
  commonConfig,
  extensions,
  jestTransformConfigProp,
} from './common.mjs';
import { jestPluginRoot } from './jestConfigHelpers.gen.mjs';

const roots = [''];
const integrationTestGlobs = ['<rootDir>/src/__integration__/**'];
const exts = extensions.join(',');
const integrationTestMatch = integrationTestGlobs
  .flatMap((glob) =>
    roots.map((root) => [root, glob].filter(Boolean).join('/'))
  )
  .map((glob) => [glob, `*.test.{${exts}}`].join('/'));

export default {
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
  ...jestTransformConfigProp(await jestPluginRoot()),
};
