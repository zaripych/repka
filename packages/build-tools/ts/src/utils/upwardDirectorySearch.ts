import { dirname, join } from 'path';

type UpwardDirectoryWalkOpts = {
  start: string;
  stops?: string[];
  appendPath?: string;
  test: (path: string) => Promise<boolean | string | undefined>;
};

export async function* upwardDirectoryWalk(opts: UpwardDirectoryWalkOpts) {
  let current = opts.start;
  while (
    current !== '/' &&
    current !== '~/' &&
    !(opts.stops?.includes(current) ?? false)
  ) {
    const path = opts.appendPath ? join(current, opts.appendPath) : current;
    const candidate = await opts.test(path);
    if (candidate) {
      yield typeof candidate === 'string' ? candidate : path;
    }
    current = dirname(current);
  }
}

export async function upwardDirectorySearch(opts: UpwardDirectoryWalkOpts) {
  const walk = upwardDirectoryWalk(opts);
  for await (const dir of walk) {
    return dir;
  }
  return undefined;
}
