import { join } from 'path';

export function configFilePath(pathRelativeToConfigDir: string) {
  return join(
    new URL(`../../configs`, import.meta.url).pathname,
    pathRelativeToConfigDir
  );
}
