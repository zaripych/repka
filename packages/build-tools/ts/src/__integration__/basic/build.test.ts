import { beforeAll, expect, it } from '@jest/globals';
import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';
import { once } from '@utils/ts';

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
    tag: `build`,
    templateName: 'template-solo',
    copyFiles: [
      {
        source: new URL('../test-cases/solo/build', import.meta.url).pathname,
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
      "build.ts",
      "package.json",
      "src/",
      "src/index.ts",
    ]
  `);
});

it('should build via tsx', async () => {
  const { sandboxDirectory } = await sandbox().props();
  expect(
    await sandbox().spawnBin('tsx', ['./build.ts', '--log-level', 'error'])
  ).toMatchObject({
    exitCode: 0,
    output: '',
  });
  expect(
    await sortedDirectoryContents(sandboxDirectory, {
      exclude: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'],
    })
  ).toMatchInlineSnapshot(`
    [
      "build.ts",
      "dist/",
      "dist/dist/",
      "dist/dist/main.js",
      "dist/package.json",
      "package.json",
      "src/",
      "src/index.ts",
    ]
  `);
});

it('should build via repka', async () => {
  const { sandboxDirectory } = await sandbox().props();
  expect(
    await sandbox().spawnBin('repka', ['build:node', '--log-level', 'error'])
  ).toMatchObject({
    exitCode: 0,
    output: '',
  });
  expect(
    await sortedDirectoryContents(sandboxDirectory, {
      exclude: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'],
    })
  ).toMatchInlineSnapshot(`
    [
      "build.ts",
      "dist/",
      "dist/dist/",
      "dist/dist/main.js",
      "dist/package.json",
      "package.json",
      "src/",
      "src/index.ts",
    ]
  `);
});
