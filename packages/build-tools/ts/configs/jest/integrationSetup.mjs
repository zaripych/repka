import { loadAndRunGlobalHook } from './jestConfigHelpers.gen.mjs';

/**
 * @param {import('@jest/types').Config.GlobalConfig} globalConfig
 * @param {import('@jest/types').Config.ProjectConfig} projectConfig
 */
export default async function (globalConfig, projectConfig) {
  await loadAndRunGlobalHook(
    './src/__integration__/setup',
    globalConfig,
    projectConfig,
    `💡 TIP: Add "./src/__integration__/setup.ts" to setup your environment.`
  );
  console.log('');
}
