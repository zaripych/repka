import { spawnToPromise } from '../child-process';
import {
  includesAnyOf,
  removeInputArgs,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { configFilePath } from '../utils/configFilePath';
import { modulesBinPath } from '../utils/modulesBinPath';
import { monorepoRootPath } from '../utils/monorepoRootPath';
import { taskArgsPipe } from '../utils/taskArgsPipe';

const eslintPath = () => modulesBinPath('eslint');

const eslintConfigPath = () => configFilePath('./eslint/eslint-root.cjs');

export const eslint = async (processArgs?: string[]) =>
  spawnToPromise(
    eslintPath(),
    taskArgsPipe(
      [
        setDefaultArgs(['--format'], ['unix']),
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
          [await monorepoRootPath()]
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
