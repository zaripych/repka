import { stat } from 'fs/promises';
import { join } from 'path';

import type { SpawnOptionsWithExtra } from './child-process';
import { spawnToPromise } from './child-process';
import { spawnWithOutputWhenFailed } from './child-process';
import type { SpawnResultOpts } from './child-process/spawnResult';
import { modulesBinPath } from './utils/modulesBinPath';
import { monorepoRootPath } from './utils/monorepoRootPath';

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

const turboPath = () => modulesBinPath('turbo');

export async function hasTurboJson(): Promise<boolean> {
  const cwd = await monorepoRootPath();
  return await stat(join(cwd, 'turbo.json'))
    .then((res) => res.isFile())
    .catch(() => false);
}

/**
 * Run turbo in the monorepo root (can only be run there) with a
 * given parameters
 */
export async function runTurbo(
  args: string[],
  spawnOpts?: Omit<SpawnOptionsWithExtra<SpawnResultOpts>, 'cwd'>
) {
  const cwd = await monorepoRootPath();
  return await spawnToPromise(turboPath(), args, {
    ...spawnOpts,
    cwd,
  });
}

/**
 * Run one of the dev pipeline tasks using Turbo for a single package
 */
export async function runTurboTasksForSinglePackage(opts: {
  tasks: [TaskTypes, ...TaskTypes[]];
  packageDir?: string;
  spawnOpts?: Omit<SpawnOptionsWithExtra<SpawnResultOpts>, 'cwd'>;
}) {
  const rootDir = opts.packageDir ?? process.cwd();
  const cwd = await monorepoRootPath();
  await spawnWithOutputWhenFailed(
    turboPath(),
    [
      'run',
      ...opts.tasks,
      '--filter=' + rootDir.replace(cwd, '.'),
      '--output-logs=new-only',
    ],
    {
      ...opts.spawnOpts,
      cwd,
    }
  );
}
