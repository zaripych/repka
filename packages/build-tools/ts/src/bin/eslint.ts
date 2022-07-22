import { ensureEslintConfigFilesExist } from '../eslint/ensureEslintConfigFilesExist';
import {
  cliArgsPipe,
  removeLogLevelOption,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { configFilePath } from '../utils/configFilePath';
import { runBin } from '../utils/runBin';

const eslintConfigPath = () => configFilePath('./eslint/eslint-root.cjs');

const runEslint = async () => {
  await ensureEslintConfigFilesExist();
  await runBin(
    'eslint',
    cliArgsPipe(
      [
        removeLogLevelOption(),
        setDefaultArgs(
          ['--ext'],
          [['.ts', '.tsx', '.js', '.jsx', '.cjs', '.json'].join(',')]
        ),
        setDefaultArgs(['--config', '-c'], [eslintConfigPath()]),
        (args) => ({
          ...args,
          // if user did not specify files to lint - default to .
          inputArgs: args.inputArgs.length === 0 ? ['.'] : args.inputArgs,
        }),
      ],
      process.argv.slice(2)
    ),
    {
      exitCodes: 'inherit',
    }
  );
};

await runEslint();
