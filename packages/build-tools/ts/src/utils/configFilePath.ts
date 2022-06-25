import { join } from 'path';

import { moduleRootDirectory } from './moduleRootDirectory';

export function configFilePath(pathRelativeToConfigDir: string) {
  return join(moduleRootDirectory(), `./configs/${pathRelativeToConfigDir}`);
}
