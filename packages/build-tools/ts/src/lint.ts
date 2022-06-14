import { spawn } from 'node:child_process';

import { spawnToPromise } from './child-process/spawnToPromise';
import { tscComposite } from './tsc-cli/tsc';
import { allFulfilled } from './utils/allFullfilled';
import { configFilePath } from './utils/configFilePath';
import { modulesBinPath } from './utils/modulesBinPath';
import { processArgsBuilder } from './utils/processArgsBuilder';
import { setFunctionName } from './utils/setFunctionName';

const eslintPath = () => modulesBinPath('eslint');

const eslintConfigPath = () => configFilePath('./eslint/eslint-root.cjs');

const restArgs = () => {
  const args = process.argv.slice(2);
  return args.length === 0 ? ['.'] : args;
};

const eslint = async () =>
  spawnToPromise(
    spawn(
      eslintPath(),
      processArgsBuilder(restArgs())
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
    ),
    {
      exitCodes: [0, 2],
    }
  );

export function lint(): () => Promise<void> {
  return setFunctionName('lint', async () => {
    await allFulfilled([tscComposite(), eslint()]);
  });
}
