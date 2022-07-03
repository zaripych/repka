import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';
import { dirname } from 'path';

import { getMonorepoRootViaDirectoryScan } from '../utils/monorepoRootPath';
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

it('should build', async () => {
  const { runBin, rootDirectory } = sandbox();
  expect(await getMonorepoRootViaDirectoryScan(rootDirectory)).toBe(
    rootDirectory
  );
  expect(await sortedDirectoryContents(rootDirectory)).toMatchInlineSnapshot(`
    Array [
      "build.ts",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "src/",
      "src/index.ts",
    ]
  `);
  expect(sanitize(await runBin('tsx', './build.ts', '--log-level', 'error')))
    .toMatchInlineSnapshot(`
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
  expect(await sortedDirectoryContents(rootDirectory)).toMatchInlineSnapshot(`
    Array [
      "build.ts",
      "dist/",
      "dist/dist/",
      "dist/dist/main.es.js",
      "dist/package.json",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "src/",
      "src/index.ts",
    ]
  `);
});
