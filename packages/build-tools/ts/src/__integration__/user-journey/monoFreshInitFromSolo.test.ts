import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { SpawnController } from '@testing-tools/packages';
import { packageTestSandbox } from '@testing-tools/packages';
import { once } from '@utils/ts';

import * as keys from './keys';

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
    tag: `mono-fresh-init-from-solo`,
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

  it('should initialize fresh mono repo successfully', async () => {
    await controller.waitForOutput('select the type of repository', 30_000);
    await controller.writeInput(keys.enter);

    await controller.waitForOutput('Please confirm the name of the package');
    await controller.writeInput(keys.enter);

    await controller.waitForOutput(
      'Following modifications are going to be made',
      500
    );

    await controller.writeInput(keys.enter, true);

    controller.nextSnapshot();

    const errorRegex = /\serror(:|\s)?/gi;

    const result = await controller.waitForResult();
    expect(result).toMatchObject({
      exitCode: 0,
      output: expect.not.stringMatching(errorRegex),
    });

    expect(await sandbox().spawnBin('eslint', ['.'])).toMatchObject({
      exitCode: 0,
      output: expect.not.stringMatching(errorRegex),
    });
    expect(await sandbox().spawnBin('jest', [])).toMatchObject({
      exitCode: 0,
      output: expect.not.stringMatching(errorRegex),
    });
  });
});
