import type {
  SpawnOptionsWithExtra,
  SpawnToPromiseOpts,
} from '../child-process';
import { spawnToPromise } from '../child-process';
import { modulesBinPath } from './modulesBinPath';

export async function runBin(
  bin: string,
  args: string[],
  spawnOpts: SpawnOptionsWithExtra<SpawnToPromiseOpts>
) {
  await spawnToPromise(modulesBinPath(bin), args, {
    ...spawnOpts,
    stdio: 'inherit',
  });
}
