import { beforeAll, expect, it } from '@jest/globals';
import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';
import { once } from '@utils/ts';

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
    tag: `test`,
    templateName: 'template-solo',
    copyFiles: [
      {
        source: new URL('../test-cases/solo/test', import.meta.url).pathname,
        include: ['**/*'],
      },
    ],
    packageJson: (packageJson) => {
      packageJson['types'] = './src/index.ts';
      packageJson['exports'] = './src/index.ts';
      return packageJson;
    },
  })
);

beforeAll(async () => {
  await sandbox().create();
  const { sandboxDirectory } = await sandbox().props();
  expect(
    await sortedDirectoryContents(sandboxDirectory, {
      exclude: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'],
    })
  ).toMatchInlineSnapshot(`
    [
      "package.json",
      "src/",
      "src/index.ts",
      "src/sum.test.ts",
      "src/sum.ts",
      "test.ts",
    ]
  `);
});

it('should test via tsx', async () => {
  expect(
    await sandbox().spawnBin('tsx', ['./test.ts', '--log-level', 'error'])
  ).toMatchObject({
    exitCode: 0,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    output: expect.stringContaining('PASS'),
  });
});

it('should test via jest', async () => {
  expect(
    await sandbox().spawnBin('jest', ['--log-level', 'error'])
  ).toMatchObject({
    exitCode: 0,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    output: expect.stringContaining('PASS'),
  });
});
