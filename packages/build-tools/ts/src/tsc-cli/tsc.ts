import { spawn } from 'node:child_process';
import { join, relative } from 'node:path';

import { spawnToPromise } from '../child-process/spawnToPromise';
import { guessMonorepoRoot } from '../file-system/guessMonorepoRoot';
import { modulesBinPath } from '../utils/modulesBinPath';

const tscPath = () => modulesBinPath('tsc');

const tsc = async (args: string[]) =>
  spawnToPromise(
    spawn(tscPath(), args, {
      stdio: 'inherit',
      // based on the monorepo "packages/*/*" directory structure
      // for full paths in TypeScript errors just do this:
      cwd: relative(process.cwd(), guessMonorepoRoot()),
    })
  );

// building composite has an advantage of caching and incremental builds
// it has to write something to the disk though

export const tscComposite = async () =>
  tsc(['--build', join(process.cwd(), './tsconfig.json')]);
