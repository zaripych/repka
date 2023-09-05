import { describe, expect, it } from '@jest/globals';
import { normalize } from 'path';
import { fileURLToPath } from 'url';

import { getModuleRootDirectoryForImportMetaUrl } from './moduleRootDirectory';

describe('getModuleRootDirectoryForImportMetaUrl', () => {
  const monoRoot =
    process.platform === 'win32'
      ? normalize('C://home/rz/projects/startup-repo')
      : normalize('/home/rz/projects/startup-repo');

  it('works after bundling', () => {
    const importMetaUrl = normalize(
      `file://${monoRoot}/packages/xxx/yyy/node_modules/@repka-kit/ts/dist/chunk.94a64047.js`
    );
    const modulesBinPathResult = normalize(
      `${monoRoot}/packages/xxx/yyy/node_modules/@repka-kit/ts/`
    );
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
