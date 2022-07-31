import { iteratePackageRootDirectories } from './iteratePackageRootDirectories';

export async function findPackageRootDir(startWith: string) {
  for await (const directory of iteratePackageRootDirectories(startWith)) {
    return directory;
  }
  return undefined;
}
