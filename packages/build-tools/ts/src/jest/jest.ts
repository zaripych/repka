import { spawn } from 'node:child_process';

import { filterAndPrint } from '../child-process/filterAndPrint';
import { spawnToPromise } from '../child-process/spawnToPromise';
import { configFilePath } from '../utils/configFilePath';
import { modulesBinPath } from '../utils/modulesBinPath';
import { processArgsBuilder } from '../utils/processArgsBuilder';

const jestPath = () => modulesBinPath('jest');

const jestRootDir = () => './src';

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

const jestUnitTestConfigPath = () =>
  configFilePath('./jest/jest.unit.config.mjs');

export const jestUnitTests = async (args: string[] = []) =>
  jest(
    processArgsBuilder(args)
      .defaultArg(
        ['--color', '--colors'],
        [],
        (args) => !args.hasArg('--no-color', '--noColor')
      )
      .defaultArg(['-c', '--config'], [jestUnitTestConfigPath()])
      .defaultArg(
        ['--rootDir', '--root-dir'],
        [jestRootDir()],
        (args) => !args.hasArg('-c', '--config')
      )
      .buildResult()
  );

const jestIntegrationTestConfigPath = () =>
  configFilePath('./jest/jest.integration.config.mjs');

export const jestIntegrationTests = async (args: string[] = []) =>
  jest(
    processArgsBuilder(args)
      .defaultArg(
        ['--color', '--colors'],
        [],
        (args) => !args.hasArg('--no-color', '--noColor')
      )
      .defaultArg(['-c', '--config'], [jestIntegrationTestConfigPath()])
      .defaultArg(
        ['--rootDir', '--root-dir'],
        [jestRootDir()],
        (args) => !args.hasArg('-c', '--config')
      )
      .buildResult()
  );
