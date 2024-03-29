import { describe, expect, it } from '@jest/globals';
import { searchTextInFiles } from '@testing-tools/packages';

import { binPath, determineBinScriptPath } from './binPath';
import { moduleRootDirectory } from './moduleRootDirectory';

const allUsagesOfBinPath = async () => {
  return [
    ...(
      await searchTextInFiles({
        target: moduleRootDirectory(),
        include: ['src/**/*.ts'],
        exclude: ['node_modules', 'dist', '.tsc-out'],
        filters: [
          {
            regExp:
              /binPath\({\s*binName\s*:\s*'([^']+)'\s*,\s*binScriptPath\s*:\s*'([^']+)',?\s*}\)/gm,
          },
        ],
        maxMatchLength: 200,
      })
    ).entries(),
  ]
    .flatMap(([key, entry]) =>
      entry.map((value) => ({ ...value, fileName: key }))
    )
    .map((value) => ({
      fileName: value.fileName,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      binName: value.match[1]!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      binScriptPath: value.match[2]!,
    }));
};

describe('all usages of binPath', () => {
  it('should work', async () => {
    const usages = await allUsagesOfBinPath();
    expect(usages.length).toBeGreaterThan(0);

    await expect(
      Promise.all(
        usages.map(async (entry) => {
          const binScriptPath = await determineBinScriptPath({
            binName: entry.binName,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            binPackageName: entry.binScriptPath.split('/')[0]!,
          });
          return {
            fileName: entry.fileName,
            binName: entry.binName,
            binScriptPath,
          };
        })
      )
    ).resolves.toMatchObject(
      usages.map(({ binName, binScriptPath, fileName }) => ({
        fileName,
        binName,
        binScriptPath,
      }))
    );

    await expect(
      Promise.all(
        usages.map((entry) =>
          binPath({
            binName: entry.binName,
            binScriptPath: entry.binScriptPath,
          }).catch((err: Error) =>
            Promise.reject(new Error(`${err.message} in ${entry.fileName}`))
          )
        )
      )
    ).resolves.toBeTruthy();
  });
});
