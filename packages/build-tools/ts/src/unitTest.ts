import { stat } from 'node:fs/promises';

import { jestUnitTests } from './jest/jest';
import { logger } from './logger/logger';
import { declareTask } from './tasks/declareTask';

export function unitTest(opts?: { processArgs: string[] }) {
  return declareTask({
    name: 'test',
    args: undefined,
    execute: async () => {
      const args = opts?.processArgs ?? process.argv.slice(2);
      const isHelpMode = args.includes('-h') || args.includes('--help');
      if (isHelpMode) {
        await jestUnitTests(args);
        return;
      }
      const srcDir = await stat('./src').catch(() => null);
      if (!srcDir || !srcDir.isDirectory()) {
        logger.info(
          `There is nothing to test here it seems, ` +
            `source code is expected in "./src" directory`
        );
        return;
      }
      await jestUnitTests(args);
    },
  });
}
