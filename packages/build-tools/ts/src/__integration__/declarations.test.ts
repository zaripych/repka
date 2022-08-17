import {
  packageTestSandbox,
  sortedDirectoryContents,
} from '@testing-tools/packages';
import { once } from '@utils/ts';

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

it('should generate TypeScript declarations', async () => {
  const { sandboxDirectory } = await sandbox().props();
  expect(
    await sortedDirectoryContents(sandboxDirectory, {
      exclude: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'],
    })
  ).toMatchInlineSnapshot(`
    Array [
      "declarations.ts",
      "package.json",
      "src/",
      "src/index.ts",
    ]
  `);
  expect(
    sanitize(
      await sandbox().runBin(
        'tsx',
        './declarations.ts',
        '--log-level',
        'error'
      ),
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
      "src/",
      "src/index.ts",
      "tsconfig.json",
    ]
  `);
});
