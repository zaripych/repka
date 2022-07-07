import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';
import { dirname } from 'path';

import { getMonorepoRootViaDirectoryScan } from '../utils/monorepoRootPath';
import { once } from '../utils/once';

const sandbox = once(() =>
  packageTestSandbox({
    tag: `declarations`,
    copyFiles: [
      {
        source: new URL('./test-cases/declarations', import.meta.url).pathname,
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

it('should generate TypeScript declarations', async () => {
  const { runBin, rootDirectory } = sandbox();
  expect(await getMonorepoRootViaDirectoryScan(rootDirectory)).toBe(
    rootDirectory
  );
  expect(await sortedDirectoryContents(rootDirectory)).toMatchInlineSnapshot(`
    Array [
      "declarations.ts",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "src/",
      "src/index.ts",
    ]
  `);
  expect(
    sanitize(await runBin('tsx', './declarations.ts', '--log-level', 'error'))
  ).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "",
    }
  `);
  expect(await sortedDirectoryContents(rootDirectory)).toMatchInlineSnapshot(`
    Array [
      ".tsc-out/",
      ".tsc-out/.tsbuildinfo",
      ".tsc-out/src/",
      ".tsc-out/src/index.d.ts",
      ".tsc-out/src/index.js",
      "declarations.ts",
      "dist/",
      "dist/dist/",
      "dist/dist/main.es.d.ts",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "src/",
      "src/index.ts",
      "tsconfig.json",
    ]
  `);
});
