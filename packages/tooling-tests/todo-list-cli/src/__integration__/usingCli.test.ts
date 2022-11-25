import { packageTestSandbox } from '@testing-tools/packages';
import { once } from '@utils/ts';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';

const sandbox = once(() =>
  packageTestSandbox({
    importMetaUrl: import.meta.url,
    tag: `usingCli`,
  })
);

beforeAll(async () => {
  await sandbox().create();
});

async function spawnMain(args?: string[]) {
  const { packageUnderTest, sandboxDirectory } = await sandbox().props();
  const path = await realpath(
    join(sandboxDirectory, 'node_modules', packageUnderTest)
  );
  return sandbox().spawnResult(process.execPath, [path, ...(args || [])]);
}

it('should add, list and remove entries', async () => {
  expect(await spawnMain()).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "output": "[ - no entries found - ]
    ",
    }
  `);
  expect(await spawnMain(['add', 'my first todo entry']))
    .toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "output": "+ 1 my first todo entry
    ",
    }
  `);
  expect(await spawnMain(['add', 'my second todo entry']))
    .toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "output": "• 1 my first todo entry
    + 2 my second todo entry
    ",
    }
  `);
  expect(await spawnMain(['list'])).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "output": "• 1 my first todo entry
    • 2 my second todo entry
    ",
    }
  `);
  expect(await spawnMain(['add', 'third todo entry'])).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "output": "• 1 my first todo entry
    • 2 my second todo entry
    + 3 third todo entry
    ",
    }
  `);
  expect(await spawnMain(['remove', '2'])).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "output": "• 1 my first todo entry
    - 2 my second todo entry
    • 3 third todo entry
    ",
    }
  `);
  expect(await spawnMain(['list'])).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "output": "• 1 my first todo entry
    • 3 third todo entry
    ",
    }
  `);
});
