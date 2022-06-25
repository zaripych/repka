import { spawnToPromise } from '../child-process';
import { configFilePath } from '../utils/configFilePath';
import { modulesBinPath } from '../utils/modulesBinPath';
import { taskArgsBuilder } from '../utils/taskArgsBuilder';

const eslintPath = () => modulesBinPath('eslint');

const eslintConfigPath = () => configFilePath('./eslint/eslint-root.cjs');

const restArgs = () => {
  const args = process.argv.slice(2);
  return args.length === 0 ? ['.'] : args;
};

export const eslint = async () =>
  spawnToPromise(
    eslintPath(),
    taskArgsBuilder(restArgs())
      .defaultArg(['--format'], ['unix'])
      .defaultArg(
        ['--ext'],
        [['.ts', '.tsx', '.js', '.jsx', '.cjs', '.json'].join(',')]
      )
      .defaultArg(['--config', '-c'], [eslintConfigPath()])
      .defaultArg(['--fix'], [], (args) => !args.hasArg('--no-fix'))
      .removeArgs(['--no-fix'])
      .buildResult(),
    {
      stdio: 'inherit',
    }
  );
