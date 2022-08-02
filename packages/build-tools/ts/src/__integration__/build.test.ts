import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';

import { once } from '../utils/once';

const sandbox = once(() =>
  packageTestSandbox({
    tag: `build`,
    copyFiles: [
      {
        source: new URL('./test-cases/build', import.meta.url).pathname,
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
});

function sanitize(
  result: { output: string; exitCode?: number },
  sandboxDirectory: string
) {
  return {
    ...result,
    ...(result.output && {
      output: result.output.replaceAll(sandboxDirectory + '/', './'),
    }),
  };
}

it('should build', async () => {
  const { sandboxDirectory } = await sandbox().props();
  expect(
    await sortedDirectoryContents(sandboxDirectory, {
      exclude: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'],
    })
  ).toMatchInlineSnapshot(`
    Array [
      "build.ts",
      "package.json",
      "src/",
      "src/index.ts",
    ]
  `);
  expect(
    sanitize(
      await sandbox().runBin('tsx', './build.ts', '--log-level', 'error'),
      sandboxDirectory
    )
  ).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "-----------------------------
    Rollup File Analysis
    -----------------------------
    bundle size:    38 Bytes
    original size:  78 Bytes
    code reduction: 51.28 %
    module count:   1

    /src/index.ts
    ██████████████████████████████████████████████████ 100 % (38 Bytes)

    ",
    }
  `);
  expect(
    await sortedDirectoryContents(sandboxDirectory, {
      exclude: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'],
    })
  ).toMatchInlineSnapshot(`
    Array [
      "build.ts",
      "dist/",
      "dist/dist/",
      "dist/dist/main.es.js",
      "dist/package.json",
      "package.json",
      "src/",
      "src/index.ts",
    ]
  `);
});
