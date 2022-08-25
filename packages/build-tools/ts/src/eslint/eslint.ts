import { spawnToPromise } from '../child-process';
import { binPath } from '../utils/binPath';
import {
  cliArgsPipe,
  includesAnyOf,
  removeInputArgs,
  removeLogLevelOption,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { configFilePath } from '../utils/configFilePath';

export const eslintBinPath = () =>
  binPath({
    binName: 'eslint',
    binScriptPath: 'eslint/bin/eslint.js',
  });

const eslintConfigPath = () => configFilePath('./eslint/eslint-root.cjs');

export const eslint = async (processArgs: string[]) => {
  return spawnToPromise(
    await eslintBinPath(),
    cliArgsPipe(
      [
        removeLogLevelOption(),
        setDefaultArgs(
          ['--ext'],
          [['.ts', '.tsx', '.js', '.jsx', '.cjs', '.json'].join(',')]
        ),
        setDefaultArgs(['--config', '-c'], [eslintConfigPath()]),
        setDefaultArgs(
          ['--fix'],
          [],
          (args) => !includesAnyOf(args.inputArgs, ['--no-fix'])
        ),
        setDefaultArgs(
          ['--resolve-plugins-relative-to'],
          [process.cwd()],
          (state) => !includesAnyOf(state.inputArgs, ['-c', '--config'])
        ),
        // remove non-standard --no-fix parameter
        removeInputArgs(['--no-fix']),
        (args) => ({
          ...args,
          // if user did not specify files to lint - default to .
          inputArgs: args.inputArgs.length === 0 ? ['.'] : args.inputArgs,
        }),
      ],
      processArgs
    ),
    {
      stdio: 'inherit',
      exitCodes: 'inherit',
    }
  );
};
