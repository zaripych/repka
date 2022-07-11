import type {
  SpawnOptionsWithExtra,
  SpawnToPromiseOpts,
} from '../child-process';
import { spawnToPromise } from '../child-process';
import { modulesBinPath } from './modulesBinPath';
import { taskArgsPipe } from './taskArgsPipe';

export async function runBin(
  bin: string,
  args = taskArgsPipe([]),
  opts?: SpawnOptionsWithExtra<SpawnToPromiseOpts>
) {
  await spawnToPromise(modulesBinPath(bin), args, {
    ...opts,
    stdio: 'inherit',
  });
}
