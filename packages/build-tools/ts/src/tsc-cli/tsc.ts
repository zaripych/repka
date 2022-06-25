import { join, relative } from 'node:path';

import { spawnToPromise } from '../child-process/spawnToPromise';
import { modulesBinPath } from '../utils/modulesBinPath';
import { monorepoRootPath } from '../utils/monorepoRootPath';
import { taskArgsBuilder } from '../utils/taskArgsBuilder';

const tscPath = () => modulesBinPath('tsc');

const tsc = async (args: string[]) =>
  spawnToPromise(tscPath(), args, {
    stdio: 'inherit',
    // based on the monorepo "packages/*/*" directory structure
    // for full paths in TypeScript errors just do this:
    cwd: relative(process.cwd(), await monorepoRootPath()),
  });

// building composite has an advantage of caching and incremental builds
// it has to write something to the disk though

export const tscCompositeTypeCheck = async () =>
  tsc(
    taskArgsBuilder([])
      .addArgs(['--build', join(process.cwd(), './tsconfig.json')])
      .buildResult()
  );
