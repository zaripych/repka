import { beforeAll, expect, it } from '@jest/globals';
import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';
import { once } from '@utils/ts';

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
    tag: `lint`,
    templateName: 'template-solo',
    copyFiles: [
      {
        source: new URL('../test-cases/solo/lint', import.meta.url).pathname,
        include: ['**/*'],
      },
    ],
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
      "lint.ts",
      "package.json",
      "src/",
      "src/index.ts",
    ]
  `);
});

it('should lint via direct tsx execution', async () => {
  expect(
    await sandbox().spawnBin('tsx', [
      './lint.ts',
      '--cache',
      '--log-level',
      'error',
    ])
  ).toMatchObject({
    exitCode: 0,
    output: '',
  });
});

it('should lint via repka', async () => {
  expect(
    await sandbox().spawnBin('repka', [
      'lint',
      '--cache',
      '--log-level',
      'error',
    ])
  ).toMatchObject({
    exitCode: 0,
    output: '',
  });
});

it('should lint via eslint', async () => {
  expect(
    await sandbox().spawnBin('eslint', [
      '.',
      '--cache',
      '--fix',
      '--log-level',
      'error',
    ])
  ).toMatchObject({
    exitCode: 0,
    output: '',
  });
});

it('should lint via pnpm exec eslint', async () => {
  expect(
    await sandbox().spawnResult('pnpm', [
      'exec',
      'eslint',
      '.',
      '--fix',
      '--cache',
      '--log-level',
      'error',
    ])
  ).toMatchObject({
    exitCode: 0,
    output: '',
  });
});
