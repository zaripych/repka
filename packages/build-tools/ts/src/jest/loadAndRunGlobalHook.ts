import type { Config } from '@jest/types';
import { stat } from 'fs/promises';
import { join } from 'path';

import { spawnWithOutputWhenFailed } from '../child-process';
import { logger } from '../logger/logger';
import { readPackageJson } from '../package-json/readPackageJson';
import { runTurboTasksForSinglePackage } from '../turbo';

async function loadStandardGlobalHook(
  script: string,
  globalConfig: Config.GlobalConfig,
  projectConfig: Config.ProjectConfig
) {
  const hasHook = await stat(script)
    .then((result) => result.isFile())
    .catch(() => false);
  return {
    hasHook,
    execute: async () => {
      if (!hasHook) {
        return;
      }
      const location = join(process.cwd(), script);
      const result = (await import(location)) as
        | {
            default?: (
              globalConfig: Config.GlobalConfig,
              projectConfig: Config.ProjectConfig
            ) => Promise<void>;
          }
        | undefined;
      if (!result || !result.default) {
        logger.warn(`⚠️ No default export found in "${script}"`);
        return;
      }
      await Promise.resolve(result.default(globalConfig, projectConfig));
    },
  };
}

async function loadCustomGlobalHook(script: string) {
  const hasHook = await stat(script)
    .then((result) => result.isFile())
    .catch(() => false);
  return {
    hasHook,
    execute: async () => {
      if (!hasHook) {
        return;
      }
      const location = join(process.cwd(), script);
      const packageJson = await readPackageJson(
        join(process.cwd(), 'package.json')
      );
      if (
        script.endsWith('setup.ts') &&
        typeof packageJson['scripts'] === 'object' &&
        packageJson['scripts']['setup:integration'] === `tsx ${script}`
      ) {
        await runTurboTasksForSinglePackage({
          tasks: ['setup:integration'],
          spawnOpts: {
            exitCodes: [0],
            env: {
              ...process.env,
              LOG_LEVEL: logger.logLevel,
            },
          },
        });
      } else {
        await spawnWithOutputWhenFailed('tsx', [location], {
          exitCodes: [0],
          env: {
            ...process.env,
            LOG_LEVEL: logger.logLevel,
          },
        });
      }
    },
  };
}

export async function loadAndRunGlobalHook(
  script: string,
  globalConfig: Config.GlobalConfig,
  projectConfig: Config.ProjectConfig,
  tip?: string
) {
  const [standard, custom] = await Promise.all([
    loadStandardGlobalHook(`${script}.mjs`, globalConfig, projectConfig),
    loadCustomGlobalHook(`${script}.ts`),
  ]);
  if (!custom.hasHook && tip) {
    logger.tip(tip);
  }
  await standard.execute();
  await custom.execute();
}
