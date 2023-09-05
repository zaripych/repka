import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { once } from '@utils/ts';

export const getModuleRootDirectoryForImportMetaUrl = (opts: {
  importMetaUrl: string;
}) => {
  // this is highly dependent on the output directory structure
  // and the context in which this function is run (bundled code vs tsx ./src/tsfile.ts)
  const __fileName = fileURLToPath(new URL(opts.importMetaUrl));
  const parent = dirname(__fileName);
  const superParent = dirname(parent);

  const isBundledInDist = () => parent.endsWith(sep + 'dist');
  const isBundledInBin = () =>
    parent.endsWith(sep + 'bin') && !superParent.endsWith(sep + 'src');

  if (isBundledInDist() || isBundledInBin()) {
    return fileURLToPath(new URL(`../`, opts.importMetaUrl));
  }

  // run via tsx to build the @repka-kit/ts itself
  return fileURLToPath(new URL(`../../`, opts.importMetaUrl));
};

export const moduleRootDirectory = once(() =>
  getModuleRootDirectoryForImportMetaUrl({ importMetaUrl: import.meta.url })
);
