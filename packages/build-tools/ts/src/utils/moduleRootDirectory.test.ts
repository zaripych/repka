import { fileURLToPath } from 'url';

import { getModuleRootDirectoryForImportMetaUrl } from './moduleRootDirectory';

describe('getModuleRootDirectoryForImportMetaUrl', () => {
  const monoRoot = '/home/rz/projects/startup-repo';

  it('works after bundling', () => {
    const importMetaUrl = `file://${monoRoot}/packages/xxx/yyy/node_modules/@build-tools/ts/dist/chunk.94a64047.js`;
    const modulesBinPathResult = `${monoRoot}/packages/xxx/yyy/node_modules/@build-tools/ts/`;
    expect(
      getModuleRootDirectoryForImportMetaUrl({
        importMetaUrl,
      })
    ).toBe(modulesBinPathResult);
  });

  it('works when run via tsx', () => {
    const importMetaUrl = new URL('./modulesBinPath.ts', import.meta.url).href;
    const modulesBinPathResult = fileURLToPath(
      new URL(`../../`, importMetaUrl)
    );
    expect(
      getModuleRootDirectoryForImportMetaUrl({
        importMetaUrl,
      })
    ).toBe(modulesBinPathResult);
  });
});
