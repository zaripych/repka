import { beforeAll, expect, it } from '@jest/globals';
import { packageTestSandbox } from '@testing-tools/packages';
import { once } from '@utils/ts';

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
    tag: `usingTheBin`,
  })
);

beforeAll(async () => {
  await sandbox().create();
});

it('should console log', async () => {
  expect(await sandbox().spawnBin('bin-only', [])).toEqual({
    exitCode: 0,
    output: 'Hello, world!\n',
  });
});
