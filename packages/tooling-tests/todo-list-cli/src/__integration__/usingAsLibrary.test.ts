import { spawnOutput } from '@build-tools/ts';
import { packageTestSandbox } from '@testing-tools/packages';
import { once } from '@utils/ts';
import { spawn } from 'child_process';

const sandbox = once(() =>
  packageTestSandbox({
    tag: `usingAsLibrary`,
    copyFiles: [
      {
        source: new URL('./test-cases', import.meta.url).pathname,
        include: ['*.ts', '*.json'],
        destination: './',
      },
    ],
  })
);

beforeAll(async () => {
  await sandbox().create();
});

afterAll(async () => {
  await sandbox().cleanup();
});

it('should be able to compile test cases', async () => {
  expect(
    await spawnOutput(
      spawn('pnpm', 'exec tsc --project ./tsconfig.json'.split(' '), {
        cwd: sandbox().rootDirectory,
      }),
      {
        exitCodes: [0, 1, 2],
      }
    )
  ).toMatchInlineSnapshot(`""`);
});
