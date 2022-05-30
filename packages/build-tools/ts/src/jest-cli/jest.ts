import { spawn } from 'node:child_process';

import { filterAndPrint } from '../child-processes/filterAndPrint';
import { spawnToPromise } from '../child-processes/spawnToPromise';
import { processArgsBuilder } from '../utils/processArgsBuilder';

const jestPath = () =>
  new URL('../../node_modules/.bin/jest', import.meta.url).pathname;

const jestConfigPath = () =>
  new URL('../../configs/jest/jest.config.mjs', import.meta.url).pathname;

const jest = async (args: string[]) => {
  const child = spawn(jestPath(), args, {
    stdio: 'pipe',
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_OPTIONS: `--experimental-vm-modules`,
    },
  });
  filterAndPrint(child, [
    {
      regExp:
        /\(node:\d+\) ExperimentalWarning: VM Modules is an experimental feature\./,
      replaceWith: undefined,
    },
  ]);
  await spawnToPromise(child);
};

export const jestStandardConfig = async (args: string[] = []) =>
  jest(
    processArgsBuilder(args)
      .defaultArg(
        ['--color'],
        [],
        (args) => !args.hasArg('--no-color', '--noColor')
      )
      .defaultArg(['-c', '--config'], [jestConfigPath()])
      .defaultArg(
        ['--rootDir', '--root-dir'],
        [process.cwd()],
        (args) => !args.hasArg('-c', '--config')
      )
      .buildResult()
  );
