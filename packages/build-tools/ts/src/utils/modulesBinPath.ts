import { join } from 'node:path';

import { moduleRootDirectory } from './moduleRootDirectory';

export function modulesBinPath(bin: string) {
  return join(moduleRootDirectory(), `./node_modules/.bin/${bin}`);
}
