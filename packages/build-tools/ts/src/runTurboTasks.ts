import type { SpawnOptionsWithExtra } from './child-process';
import { spawnWithOutputWhenFailed } from './child-process';
import type { ExtraSpawnResultOpts } from './child-process/spawnResult';
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

/**
 * Run one of the dev pipeline tasks using Turbo
 */
export async function runTurboTasks(opts: {
  tasks: [TaskTypes, ...TaskTypes[]];
  packageDir?: string;
  spawnOpts?: Omit<SpawnOptionsWithExtra<ExtraSpawnResultOpts>, 'cwd'>;
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
