import { spawnToPromise } from '../child-process';
import {
  cliArgsPipe,
  includesAnyOf,
  removeInputArgs,
  removeLogLevelOption,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { configFilePath } from '../utils/configFilePath';
import { modulesBinPath } from '../utils/modulesBinPath';
import { repositoryRootPath } from '../utils/repositoryRootPath';

const eslintPath = () => modulesBinPath('eslint');

const eslintConfigPath = () => configFilePath('./eslint/eslint-root.cjs');

export const eslint = async (processArgs: string[]) =>
  spawnToPromise(
    eslintPath(),
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
          [await repositoryRootPath()]
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
