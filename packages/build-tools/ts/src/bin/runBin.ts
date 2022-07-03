import type {
  SpawnOptionsWithExtra,
  SpawnToPromiseOpts,
} from '../child-process';
import { spawnToPromise } from '../child-process';
import { taskArgsPipe } from '../utils/taskArgsPipe';

// NOTE: path relative to the ./bin at the root of the package where
// this file is going to reside
const binPath = (bin: string) =>
  new URL(`../node_modules/.bin/${bin}`, import.meta.url).pathname;

export async function runBin(
  bin: string,
  args = taskArgsPipe([]),
  opts?: SpawnOptionsWithExtra<SpawnToPromiseOpts>
) {
  await spawnToPromise(binPath(bin), args, {
    ...opts,
    stdio: 'inherit',
  });
}
