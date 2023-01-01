import { beforeAll, describe, expect, it } from '@jest/globals';
import type { SpawnController } from '@testing-tools/packages';
import { packageTestSandbox } from '@testing-tools/packages';
import { once } from '@utils/ts';

import * as keys from './keys';

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
    controller = await sandbox().spawnBinController('repka', ['init']);
  });

  afterAll(async () => {
    await controller.kill();
  });

  it('should initialize fresh solo repo successfully', async function test() {
    await controller.waitForOutput('select the type of repository', 1000);
    await controller.writeInput(keys.downKey);
    await controller.waitForOutput('❯   solo - ');
    await controller.writeInput(keys.enter);

    await controller.waitForOutput('Please confirm the name of the package');
    await controller.writeInput(keys.enter);

    await controller.waitForOutput(
      'Following modifications are going to be made',
      500
    );

    // let output = controller.nextSnapshot();
    // while (!output.includes('◉   install - Install using')) {
    //   await controller.writeInput(keys.downKey);
    //   output = await controller.readOutput(100);
    // }

    // await controller.writeInput(keys.space);
    // await controller.waitForOutput('◯   install - Install using', 500);
    await controller.writeInput(keys.enter, true);

    controller.nextSnapshot();

    const result = await controller.waitForResult();
    expect(result).toMatchObject({
      exitCode: 0,
      output: expect.not.stringMatching(/\serror(:|\s)?/gi),
    });

    expect(await sandbox().spawnBin('repka', ['lint'])).toMatchObject({
      exitCode: 0,
    });
    expect(await sandbox().spawnBin('repka', ['test'])).toMatchObject({
      exitCode: 0,
    });
  });
});
