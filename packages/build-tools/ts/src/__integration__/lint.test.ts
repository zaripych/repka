import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';
import { once } from '@utils/ts';

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
    templateName: 'solo-template',
    tag: `lint`,
    copyFiles: [
      {
        source: new URL('./test-cases/solo/lint', import.meta.url).pathname,
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
    Array [
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
  ).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "",
    }
  `);
});

it('should lint via repka', async () => {
  expect(
    await sandbox().spawnBin('repka', [
      'lint',
      '--cache',
      '--log-level',
      'error',
    ])
  ).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "",
    }
  `);
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
  ).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "",
    }
  `);
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
  ).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "",
    }
  `);
});
