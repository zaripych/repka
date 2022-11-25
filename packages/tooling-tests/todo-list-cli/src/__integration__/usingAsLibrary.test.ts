import { packageTestSandbox } from '@testing-tools/packages';
import { once } from '@utils/ts';

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
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

it('should be able to compile test cases', async () => {
  expect(
    await sandbox().spawnBin('tsc', '--project ./tsconfig.json'.split(' '))
  ).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "output": "",
    }
  `);
});
