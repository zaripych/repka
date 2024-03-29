import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { SpawnController } from '@testing-tools/packages';
import { packageTestSandbox } from '@testing-tools/packages';
import { once } from '@utils/ts';

import * as keys from './keys';

jest.setTimeout(60_000 * 4);

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
    tag: `solo-fresh-init`,
    templateName: 'template-solo',
    sandboxType: 'copy',
    env: {
      NO_MD_FORMAT: '1',
    },
  })
);

beforeAll(async () => {
  await sandbox().create();
});

describe('user installs @repka-kit/ts package as devDependency, then runs repka init', () => {
  let controller: SpawnController;

  beforeAll(async () => {
    controller = await sandbox().spawnBinControllerFromPackageInstallSource(
      'repka',
      ['init'],
      {
        searchAndReplace: {
          filters: [
            {
              substring: '❯',
              replaceWith: '>',
            },
          ],
        },
      }
    );
  });

  afterAll(async () => {
    await controller.kill();
  });

  it('should initialize fresh solo repo successfully', async function test() {
    /**
     * @note the wait time is quite long on this one as we literally install
     * dependencies of the source package to ensure the source code we are
     * running doesn't change while we are running
     */
    await controller.waitForOutput('select the type of repository', 30_000);
    await controller.writeInput(keys.downKey);

    await controller.waitForOutput('>   solo - ');
    await controller.writeInput(keys.enter);

    await controller.waitForOutput('Please confirm the name of the package');
    await controller.writeInput(keys.enter);

    await controller.waitForOutput(
      'Following modifications are going to be made',
      500
    );

    await controller.writeInput(keys.enter, true);

    const errorRegex = /(\s|\W|^)error(:|\s)?/gi;

    const result = await controller.waitForResult();

    expect(result).toMatchObject({
      exitCode: 0,
      output: expect.not.stringMatching(errorRegex),
    });

    expect(await sandbox().spawnBin('repka', ['lint'])).toMatchObject({
      exitCode: 0,
      output: expect.not.stringMatching(errorRegex),
    });
    expect(await sandbox().spawnBin('repka', ['test'])).toMatchObject({
      exitCode: 0,
      output: expect.not.stringMatching(errorRegex),
    });
  });
});
