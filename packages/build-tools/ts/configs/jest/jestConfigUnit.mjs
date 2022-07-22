import { jestTransformConfigProp } from './common.mjs';
import { unitTestConfig } from './commonUnit.mjs';
import { jestPluginRoot } from './jestConfigHelpers.gen.mjs';

export default {
  ...unitTestConfig,
  ...jestTransformConfigProp(await jestPluginRoot()),
};
