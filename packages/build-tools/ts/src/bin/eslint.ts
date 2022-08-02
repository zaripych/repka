import { spawnToPromise } from '../child-process';
import { ensureEslintConfigFilesExist } from '../eslint/ensureEslintConfigFilesExist';
import { eslintBinPath } from '../eslint/eslint';
import {
  cliArgsPipe,
  removeLogLevelOption,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { configFilePath } from '../utils/configFilePath';

const runEslint = async () => {
  await ensureEslintConfigFilesExist();
  await spawnToPromise(
    await eslintBinPath(),
    cliArgsPipe(
      [
        removeLogLevelOption(),
        setDefaultArgs(
          ['--ext'],
          [['.ts', '.tsx', '.js', '.jsx', '.cjs', '.json'].join(',')]
        ),
        setDefaultArgs(
          ['--config', '-c'],
          [configFilePath('./eslint/eslint-root.cjs')]
        ),
        (args) => ({
          ...args,
          // if user did not specify files to lint - default to .
          inputArgs: args.inputArgs.length === 0 ? ['.'] : args.inputArgs,
        }),
      ],
      process.argv.slice(2)
    ),
    {
      stdio: 'inherit',
      exitCodes: 'inherit',
    }
  );
};

await runEslint();
