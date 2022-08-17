import { jestTransformConfigProp } from './common.mjs';
import { integrationTestConfig } from './commonIntegration.mjs';
import { jestPluginRoot } from './jestConfigHelpers.gen.mjs';

export default {
  ...integrationTestConfig,
  ...jestTransformConfigProp(await jestPluginRoot()),
};
