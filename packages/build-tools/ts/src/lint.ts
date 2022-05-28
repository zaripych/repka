import { spawn } from 'node:child_process';

import { spawnToPromise } from './child-processes/spawnToPromise';
import { tscComposite } from './tsc-cli/tsc';
import { allFulfilled } from './utils/allFullfilled';
import { setFunctionName } from './utils/setFunctionName';

const eslintPath = () =>
  new URL('../node_modules/.bin/eslint', import.meta.url).pathname;

const eslintConfigPath = () =>
  new URL('../configs/eslint/eslint-root.cjs', import.meta.url).pathname;

const restArgs = () => {
  const args = process.argv.slice(2);
  return args.length === 0 ? ['.'] : args;
};

const eslint = async () =>
  spawnToPromise(
    spawn(
      eslintPath(),
      [
        '--format',
        'unix',
        '--ext',
        ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.json'].join(','),
        '-c',
        eslintConfigPath(),
        '--fix',
        ...restArgs(),
      ],
      {
        stdio: 'inherit',
      }
    )
  );

export function lint(): () => Promise<void> {
  return setFunctionName('lint', async () => {
    await allFulfilled([tscComposite(), eslint()]);
  });
}
