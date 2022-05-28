import { spawn } from 'node:child_process';

import { spawnToPromise } from './child-processes/spawnToPromise';
import { tscComposite } from './tsc-cli/tsc';
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
    const tscTask = tscComposite();
    const eslintTask = eslint();
    const [tscResult, eslintResult] = await Promise.allSettled([
      tscTask,
      eslintTask,
    ]);
    if (
      tscResult.status !== 'fulfilled' ||
      eslintResult.status !== 'fulfilled'
    ) {
      throw new Error(`Failed to lint`);
    }
  });
}
