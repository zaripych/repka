import { ensureEslintConfigFilesExist } from './eslint/ensureEslintConfigFilesExist';
import { eslint } from './eslint/eslint';
import { declareTask } from './tasks/declareTask';
import { tscCompositeTypeCheck } from './tsc-cli/tsc';
import { allFulfilled } from './utils/allFullfilled';

/**
 * Lint using eslint, no customizations possible, other than
 * via creating custom `eslint.config.mjs` in a directory.
 *
 * `Status: Minimum implemented`
 *
 * TODO: Allow specifying type of package: web app requires
 * different linting compared to a published npm package.
 */
export function lint() {
  return declareTask({
    name: 'lint',
    args: undefined,
    execute: async () => {
      await allFulfilled([
        tscCompositeTypeCheck(),
        ensureEslintConfigFilesExist().then(() => eslint()),
      ]);
    },
  });
}
