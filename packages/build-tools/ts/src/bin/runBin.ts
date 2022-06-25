import { spawnToPromise } from '../child-process';

// NOTE: path relative to the ./bin at the root of the package where
// this file is going to reside
const binPath = (bin: string) =>
  new URL(`../node_modules/.bin/${bin}`, import.meta.url).pathname;

export async function runBin(bin: string, args = process.argv.slice(2)) {
  await spawnToPromise(binPath(bin), args, {
    stdio: 'inherit',
  });
}
