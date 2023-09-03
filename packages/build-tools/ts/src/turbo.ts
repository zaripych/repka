import { stat } from 'fs/promises';
import { join } from 'path';

import type { SpawnOptionsWithExtra } from './child-process';
import { spawnOutputConditional } from './child-process';
import type { SpawnResultOpts } from './child-process/spawnResult';
import { binPath } from './utils/binPath';
import type { CliArgs } from './utils/cliArgsPipe';
import { setScript } from './utils/cliArgsPipe';
import { cliArgsPipe } from './utils/cliArgsPipe';
import { insertAfterAnyOf } from './utils/cliArgsPipe';
import { includesAnyOf } from './utils/cliArgsPipe';
import { repositoryRootPath } from './utils/repositoryRootPath';

export type TaskTypes =
  | 'lint'
  | 'build'
  | 'test'
  | 'declarations'
  | 'integration'
  | 'setup:integration'
  | (string & {
      _allowStrings?: undefined;
    });

export const turboBinPath = () =>
  binPath({
    binName: 'turbo',
    binScriptPath: 'turbo/bin/turbo',
  });

export async function hasTurboJson(): Promise<boolean> {
  const cwd = await repositoryRootPath();
  return await stat(join(cwd, 'turbo.json'))
    .then((res) => res.isFile())
    .catch(() => false);
}

export function passTurboForceEnv(args: string[]) {
  return includesAnyOf(args, ['run']) && includesAnyOf(args, ['--force'])
    ? {
        TURBO_FORCE: '1',
      }
    : undefined;
}

export function inheritTurboForceArgFromEnv() {
  return (state: CliArgs) => ({
    ...state,
    inputArgs:
      includesAnyOf(state.inputArgs, ['run']) &&
      !includesAnyOf(state.inputArgs, ['--force']) &&
      process.env['TURBO_FORCE']
        ? insertAfterAnyOf(state.inputArgs, ['--force'], ['run'])
        : state.inputArgs,
  });
}

/**
 * Run one of the dev pipeline tasks using Turbo for a single package
 */
export async function runTurboTasksForSinglePackage(opts: {
  tasks: [TaskTypes, ...TaskTypes[]];
  packageDir?: string;
  spawnOpts: Omit<SpawnOptionsWithExtra<SpawnResultOpts>, 'cwd'>;
}) {
  const rootDir = opts.packageDir ?? process.cwd();
  const cwd = await repositoryRootPath();
  return await spawnOutputConditional(
    process.execPath,
    cliArgsPipe(
      [setScript(await turboBinPath()), inheritTurboForceArgFromEnv()],
      [
        'run',
        ...opts.tasks,
        '--filter=' + rootDir.replace(cwd, '.'),
        '--output-logs=new-only',
        '--color',
      ]
    ),
    {
      ...opts.spawnOpts,
      cwd,
    }
  );
}
