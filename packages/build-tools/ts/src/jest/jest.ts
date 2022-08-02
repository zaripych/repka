import { filterAndPrint } from '../child-process/filterAndPrint';
import type {
  SpawnOptionsWithExtra,
  SpawnToPromiseOpts,
} from '../child-process/spawnToPromise';
import { spawnWithSpawnParameters } from '../child-process/spawnToPromise';
import { spawnToPromise } from '../child-process/spawnToPromise';
import { logger } from '../logger/logger';
import { binPath } from '../utils/binPath';
import {
  cliArgsPipe,
  includesAnyOf,
  removeLogLevelOption,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { configFilePath } from '../utils/configFilePath';
import { isTruthy } from '../utils/isTruthy';

const jestPath = () =>
  binPath({
    binName: 'jest',
    binScriptPath: 'eslint/bin/eslint.js',
  });

export const jest = async (
  args: string[],
  spawnOpts: SpawnOptionsWithExtra<SpawnToPromiseOpts>
) => {
  const canUseStdioPipeToFilterOutput = !includesAnyOf(args, ['--watch']);
  const { child } = spawnWithSpawnParameters([
    await jestPath(),
    cliArgsPipe(
      [
        removeLogLevelOption(),
        // when stdio is "pipe" pass --color option:
        canUseStdioPipeToFilterOutput &&
          setDefaultArgs(
            [`--color`, '--colors'],
            [],
            (state) =>
              !includesAnyOf(state.inputArgs, ['--no-color', '--noColor']) &&
              !process.env['CI']
          ),
      ].filter(isTruthy),
      args
    ),
    {
      ...spawnOpts,
      stdio: canUseStdioPipeToFilterOutput ? 'pipe' : 'inherit',
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: `--experimental-vm-modules`,
        LOG_LEVEL: logger.logLevel,
      },
    },
  ]);
  if (canUseStdioPipeToFilterOutput) {
    filterAndPrint(child, [
      {
        regExp:
          /\(node:\d+\) ExperimentalWarning: VM Modules is an experimental feature\./,
        replaceWith: undefined,
      },
    ]);
  }
  await spawnToPromise(child, spawnOpts);
};

const jestUnitTestConfigPath = () =>
  configFilePath('./jest/jestConfigUnit.mjs');

const jestArgsPipe = (configFilePath: string, args: string[]) =>
  cliArgsPipe([setDefaultArgs(['-c', '--config'], [configFilePath])], args);

export const jestUnitTests = async (args: string[]) =>
  jest(jestArgsPipe(jestUnitTestConfigPath(), args), { exitCodes: 'inherit' });

const jestIntegrationTestConfigPath = () =>
  configFilePath('./jest/jestConfigIntegration.mjs');

export const jestIntegrationTests = async (args: string[]) =>
  jest(jestArgsPipe(jestIntegrationTestConfigPath(), args), {
    exitCodes: 'inherit',
  });
