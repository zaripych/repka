import { loadAndRunGlobalHook } from './jestConfigHelpers.gen.mjs';

/**
 * @param {import('@jest/types').Config.GlobalConfig} globalConfig
 * @param {import('@jest/types').Config.ProjectConfig} projectConfig
 */
export default async function (globalConfig, projectConfig) {
  console.log('');
  await loadAndRunGlobalHook(
    './src/__integration__/teardown.mjs',
    globalConfig,
    projectConfig,
    `💡 TIP: Add "./src/__integration__/teardown.ts" to teardown your environment.`
  );
}
