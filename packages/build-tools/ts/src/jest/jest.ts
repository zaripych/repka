import { spawn } from 'node:child_process';

import { filterAndPrint } from '../child-process/filterAndPrint';
import { spawnToPromise } from '../child-process/spawnToPromise';
import { logger } from '../logger/logger';
import { includesAnyOf, setDefaultArgs } from '../utils/cliArgsPipe';
import { configFilePath } from '../utils/configFilePath';
import { modulesBinPath } from '../utils/modulesBinPath';
import { taskArgsPipe } from '../utils/taskArgsPipe';

const jestPath = () => modulesBinPath('jest');

const jestRootDir = () => './src';

const jest = async (args: string[]) => {
  const child = spawn(jestPath(), args, {
    stdio: 'pipe',
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_OPTIONS: `--experimental-vm-modules`,
      LOG_LEVEL: logger.logLevel,
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

const jestArgsPipe = (configFilePath: string, args?: string[]) =>
  taskArgsPipe(
    [
      setDefaultArgs(
        ['--color', '--colors'],
        [],
        (args) => !includesAnyOf(args.inputArgs, ['--no-color', '--noColor'])
      ),
      setDefaultArgs(['-c', '--config'], [configFilePath]),
      setDefaultArgs(
        ['--rootDir', '--root-dir'],
        [jestRootDir()],
        (args) => !includesAnyOf(args.inputArgs, ['-c', '--config'])
      ),
    ],
    args
  );

export const jestUnitTests = async (args?: string[]) =>
  jest(jestArgsPipe(jestUnitTestConfigPath(), args));

const jestIntegrationTestConfigPath = () =>
  configFilePath('./jest/jest.integration.config.mjs');

export const jestIntegrationTests = async (args?: string[]) =>
  jest(jestArgsPipe(jestIntegrationTestConfigPath(), args));
