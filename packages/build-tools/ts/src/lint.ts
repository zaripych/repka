import { stat } from 'node:fs/promises';

import { ensureEslintConfigFilesExist } from './eslint/ensureEslintConfigFilesExist';
import { eslint } from './eslint/eslint';
import { declareTask } from './tasks/declareTask';
import { ensureTsConfigExists } from './tsc/ensureTsConfigExists';
import { tscCompositeTypeCheck } from './tsc/tsc';
import { allFulfilled } from './utils/allFullfilled';
import { monorepoRootPath } from './utils/monorepoRootPath';

/**
 * Lint using eslint, no customizations possible, other than
 * via creating custom `eslint.config.mjs` in a directory.
 *
 * `Status: Minimum implemented`
 *
 * TODO: Allow specifying type of package: web app requires
 * different linting compared to a published npm package.
 */
export function lint(opts?: { processArgs: string[] }) {
  return declareTask({
    name: 'lint',
    args: undefined,
    execute: async () => {
      const root = await monorepoRootPath();
      if (root === process.cwd()) {
        const srcDir = await stat('./src').catch(() => null);
        if (!srcDir || !srcDir.isDirectory()) {
          return;
        }
      }
      await allFulfilled([
        ensureTsConfigExists().then(() => tscCompositeTypeCheck()),
        ensureEslintConfigFilesExist().then(() => eslint(opts?.processArgs)),
      ]);
    },
  });
}
