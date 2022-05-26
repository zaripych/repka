import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { spawnToPromise } from '../child-processes/spawnToPromise';

const tscPath = () =>
  new URL('../../node_modules/.bin/tsc', import.meta.url).pathname;

const tsc = async (args: string[]) =>
  spawnToPromise(
    spawn(tscPath(), args, {
      stdio: 'inherit',
      // based on the monorepo "packages/*/*" directory structure
      // for full paths in TypeScript errors just do this:
      cwd: '../../../',
    })
  );

// building composite has an advantage of caching and incremental builds
// it has to write something to the disk though

export const tscComposite = async () =>
  tsc(['--build', join(process.cwd(), './tsconfig.json')]);
