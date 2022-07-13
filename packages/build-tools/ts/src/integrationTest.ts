import { stat } from 'node:fs/promises';

import { jestIntegrationTests } from './jest/jest';
import { logger } from './logger/logger';
import { declareTask } from './tasks/declareTask';

export function integrationTest(opts?: { processArgs?: string[] }) {
  return declareTask({
    name: 'integration',
    args: undefined,
    execute: async () => {
      const args = opts?.processArgs ?? process.argv.slice(2);
      const isHelpMode = args.includes('-h') || args.includes('--help');
      if (isHelpMode) {
        await jestIntegrationTests(args);
        return;
      }
      const testsDir = await stat('./src/__integration__').catch(() => null);
      if (!testsDir || !testsDir.isDirectory()) {
        logger.info(
          `There is nothing to test here it seems, ` +
            `integrations tests are expected in "./src/__integration__" directory`
        );
        return;
      }
      await jestIntegrationTests(args);
    },
  });
}
