import { join, relative } from 'node:path';

import { spawnToPromise } from '../child-process/spawnToPromise';
import { binPath } from '../utils/binPath';
import { repositoryRootPath } from '../utils/repositoryRootPath';

export const tscPath = () =>
  binPath({
    binName: 'tsc',
    binScriptPath: 'typescript/bin/tsc',
  });

const tsc = async (args: string[]) =>
  spawnToPromise(await tscPath(), args, {
    stdio: 'inherit',
    // based on the monorepo "packages/*/*" directory structure
    // for full paths in TypeScript errors just do this:
    cwd: relative(process.cwd(), await repositoryRootPath()),
    exitCodes: 'inherit',
  });

// building composite has an advantage of caching and incremental builds
// it has to write something to the disk though

export const tscCompositeTypeCheckAt = async (packageDirectory: string) =>
  tsc(['--build', join(packageDirectory, './tsconfig.json'), '--pretty']);

export const tscCompositeTypeCheck = async () =>
  tscCompositeTypeCheckAt(process.cwd());
