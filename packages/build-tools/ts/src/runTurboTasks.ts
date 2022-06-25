import { spawnToPromise } from './child-process/spawnToPromise';
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
}) {
  const rootDir = opts.packageDir ?? process.cwd();
  const root = await monorepoRootPath();
  await spawnToPromise(
    turboPath(),
    [
      'run',
      ...opts.tasks,
      '--filter=' + rootDir.replace(root, '.'),
      '--output-logs=new-only',
    ],
    {
      stdio: 'inherit',
      cwd: root,
    }
  );
}
