import { beforeAll, expect, it, jest } from '@jest/globals';
import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';
import { once } from '@utils/ts';

jest.setTimeout(10000);

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
    tag: `declarations`,
    templateName: 'template-solo',
    copyFiles: [
      {
        source: new URL('../test-cases/solo/declarations', import.meta.url)
          .pathname,
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
      "declarations.ts",
      "package.json",
      "src/",
      "src/index.ts",
    ]
  `);
});

it('should generate TypeScript declarations when run directly', async () => {
  expect(
    await sandbox().spawnBin('tsx', [
      './declarations.ts',
      '--log-level',
      'error',
    ])
  ).toMatchObject({
    exitCode: 0,
    output: '',
  });
});

it('should generate TypeScript declarations when run via repka', async () => {
  expect(
    await sandbox().spawnBin('repka', ['declarations', '--log-level', 'error'])
  ).toMatchObject({
    exitCode: 0,
    output: '',
  });
});
