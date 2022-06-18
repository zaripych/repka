import { spawn } from 'child_process';
import { join } from 'path';

import { spawnToPromise } from './child-process/spawnToPromise';
import { guessMonorepoRoot } from './file-system/guessMonorepoRoot';

export type TaskTypes = 'lint' | 'build' | 'test' | 'declarations';

const turboPath = () => join(guessMonorepoRoot(), './node_modules/.bin/turbo');

/**
 * Run one of the dev pipeline tasks using Turbo
 */
export async function runTurboTasks(opts: {
  tasks: [TaskTypes, ...TaskTypes[]];
  packageDir?: string;
}) {
  const rootDir = opts.packageDir ?? process.cwd();
  await spawnToPromise(
    spawn(
      turboPath(),
      [
        'run',
        ...opts.tasks,
        '--filter=' + rootDir.replace(guessMonorepoRoot(), '.'),
        '--output-logs=new-only',
      ],
      {
        stdio: 'inherit',
        cwd: guessMonorepoRoot(),
      }
    ),
    {
      exitCodes: [0, 1],
    }
  );
}
