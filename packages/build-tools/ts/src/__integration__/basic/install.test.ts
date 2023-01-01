import { beforeAll, describe, expect, it } from '@jest/globals';
import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';
import { once } from '@utils/ts';

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
    tag: `install`,
    templateName: 'template-solo',
  })
);

beforeAll(async () => {
  await sandbox().create();
});

describe('user installs @repka-kit/ts package as devDependency', () => {
  it('gets installed in a directory without source code', async () => {
    const { sandboxDirectory } = await sandbox().props();
    expect(await sortedDirectoryContents(sandboxDirectory)).toMatchObject(
      expect.arrayContaining(['package.json', 'pnpm-lock.yaml'])
    );
    expect(await sortedDirectoryContents(sandboxDirectory)).not.toMatchObject(
      expect.arrayContaining([expect.stringMatching(/.*\.ts/)])
    );
  });

  it('suggests to start by running "repka init" when running "repka lint"', async () => {
    expect(await sandbox().spawnBin('repka', ['lint'])).toMatchObject({
      exitCode: 0,
      output: expect.stringContaining(
        `There is nothing to lint here it seems. Use "repka init" to start.`
      ),
    });
  });

  it('suggests to start by running "repka init" when running "repka test"', async () => {
    expect(await sandbox().spawnBin('repka', ['test'])).toMatchObject({
      exitCode: 0,
      output: expect.stringContaining(
        `There is nothing to test here it seems. Use "repka init" to start.`
      ),
    });
  });

  it('suggests to start by running "repka init" when running "repka build:node"', async () => {
    expect(await sandbox().spawnBin('repka', ['build:node'])).toMatchObject({
      exitCode: 0,
      output: expect.stringContaining(
        `There is nothing to build here it seems. Use "repka init" to start.`
      ),
    });
  });
});
