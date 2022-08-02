import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';

import { once } from '../utils/once';

const sandbox = once(() =>
  packageTestSandbox({
    tag: `lint`,
    copyFiles: [
      {
        source: new URL('./test-cases/lint', import.meta.url).pathname,
        include: ['**/*'],
      },
    ],
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

it('should lint', async () => {
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
  expect(
    sanitize(
      await sandbox().runBin('tsx', './lint.ts', '--log-level', 'error'),
      sandboxDirectory
    )
  ).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "",
    }
  `);
  expect(
    await sortedDirectoryContents(sandboxDirectory, {
      exclude: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'],
    })
  ).toMatchInlineSnapshot(`
    Array [
      ".eslintrc.cjs",
      ".tsc-out/",
      ".tsc-out/.tsbuildinfo",
      ".tsc-out/src/",
      ".tsc-out/src/index.d.ts",
      ".tsc-out/src/index.js",
      "lint.ts",
      "package.json",
      "src/",
      "src/index.ts",
      "tsconfig.eslint.json",
      "tsconfig.json",
    ]
  `);
});
