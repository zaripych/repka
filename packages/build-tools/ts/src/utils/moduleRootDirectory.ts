import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { once } from './once';

export const getModuleRootDirectoryForImportMetaUrl = (opts: {
  importMetaUrl: string;
}) => {
  // this is highly dependent on the output directory structure
  // and the context in which this function is run (bundled code vs tsx ./src/tsfile.ts)
  const __fileName = fileURLToPath(new URL(opts.importMetaUrl));
  const parent = dirname(__fileName);
  const superParent = dirname(parent);

  const isBundledInDist = () => parent.endsWith('/dist');
  const isBundledInBin = () =>
    parent.endsWith('/bin') && !superParent.endsWith('/src');

  if (isBundledInDist() || isBundledInBin()) {
    return fileURLToPath(new URL(`../`, opts.importMetaUrl));
  }

  // run via tsx to build the @build-tools/ts itself
  return fileURLToPath(new URL(`../../`, opts.importMetaUrl));
};

export const moduleRootDirectory = once(() =>
  getModuleRootDirectoryForImportMetaUrl({ importMetaUrl: import.meta.url })
);
