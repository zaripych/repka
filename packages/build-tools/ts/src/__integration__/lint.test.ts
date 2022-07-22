import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';
import { dirname } from 'path';

import { once } from '../utils/once';
import { repositoryRootPathViaDirectoryScan } from '../utils/repositoryRootPath';

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

function sanitize(result: { output: string; exitCode: number | null }) {
  return {
    ...result,
    ...(result.output && {
      output: result.output.replaceAll(
        dirname(sandbox().rootDirectory) + '/',
        './'
      ),
    }),
  };
}

it('should lint', async () => {
  const { runBin, rootDirectory } = sandbox();
  expect(await repositoryRootPathViaDirectoryScan(rootDirectory)).toBe(
    rootDirectory
  );
  expect(await sortedDirectoryContents(rootDirectory)).toMatchInlineSnapshot(`
    Array [
      "lint.ts",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "src/",
      "src/index.ts",
    ]
  `);
  expect(sanitize(await runBin('tsx', './lint.ts', '--log-level', 'error')))
    .toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "",
    }
  `);
  expect(await sortedDirectoryContents(rootDirectory)).toMatchInlineSnapshot(`
    Array [
      ".eslintrc.cjs",
      ".tsc-out/",
      ".tsc-out/.tsbuildinfo",
      ".tsc-out/src/",
      ".tsc-out/src/index.d.ts",
      ".tsc-out/src/index.js",
      "lint.ts",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "src/",
      "src/index.ts",
      "tsconfig.eslint.json",
      "tsconfig.json",
    ]
  `);
});
