import { sortedDirectoryContents } from '@testing-tools/packages';

import { once } from '../utils/once';
import { buildToolsTestSandbox } from './buildToolsTestSandbox';

const sandbox = once(() =>
  buildToolsTestSandbox({
    tag: 'user-journey-test-bare',
  })
);

beforeAll(async () => {
  await sandbox().create();
});

describe('user installs @repka-kit/ts package as devDependency', () => {
  it('gets installed', async () => {
    expect(await sortedDirectoryContents(sandbox().rootDirectory))
      .toMatchInlineSnapshot(`
      Array [
        "README.md",
        "package.json",
      ]
    `);
  });

  it('suggests to start by running "repka init" when running "repka lint"', async () => {
    expect(await sandbox().runBin('repka', 'lint')).toMatchInlineSnapshot(`
      Object {
        "exitCode": 0,
        "output": "There is nothing to lint here it seems. Use \\"repka init\\" to start.
      ",
      }
    `);
  });

  it('suggests to start by running "repka init" when running "repka test"', async () => {
    expect(await sandbox().runBin('repka', 'test')).toMatchInlineSnapshot(`
      Object {
        "exitCode": 0,
        "output": "There is nothing to test here it seems. Use \\"repka init\\" to start.
      ",
      }
    `);
  });

  it('suggests to start by running "repka init" when running "repka build:node"', async () => {
    expect(await sandbox().runBin('repka', 'build:node'))
      .toMatchInlineSnapshot(`
      Object {
        "exitCode": 0,
        "output": "There is nothing to build here it seems. Use \\"repka init\\" to start.
      ",
      }
    `);
  });
});
