import { dirname } from 'node:path';

import { spawnToPromise } from '../child-process';
import {
  cliArgsPipe,
  includesAnyOf,
  removeInputArgs,
  removeLogLevelOption,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { configFilePath } from '../utils/configFilePath';
import { findDevDependency } from '../utils/findDevDependency';
import { modulesBinPath } from '../utils/modulesBinPath';
import { repositoryRootPath } from '../utils/repositoryRootPath';

const eslintPath = () => modulesBinPath('eslint');

const eslintConfigPath = () => configFilePath('./eslint/eslint-root.cjs');

export const eslint = async (processArgs: string[]) => {
  const dependency = await findDevDependency({
    lookupPackageName: '@typescript-eslint/eslint-plugin',
  });
  return spawnToPromise(
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
          [
            dependency
              ? dirname(dirname(dependency))
              : await repositoryRootPath(),
          ]
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
