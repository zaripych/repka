import { allFulfilled } from '@utils/ts';

import { ensureEslintConfigFilesExist } from './eslint/ensureEslintConfigFilesExist';
import { eslint } from './eslint/eslint';
import { declareTask } from './tasks/declareTask';
import { ensureTsConfigExists } from './tsc/ensureTsConfigExists';
import { tscCompositeTypeCheck } from './tsc/tsc';

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
      const args = opts?.processArgs ?? process.argv.slice(2);
      const isEslintHelpMode = args.includes('-h') || args.includes('--help');
      if (isEslintHelpMode) {
        await eslint(['--help']);
        return;
      }
      await allFulfilled([
        ensureTsConfigExists().then(() => tscCompositeTypeCheck()),
        ensureEslintConfigFilesExist().then(() => eslint(args)),
      ]);
    },
  });
}
