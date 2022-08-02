import { packageTestSandbox } from '@testing-tools/packages';
import { once } from '@utils/ts';

const sandbox = once(() =>
  packageTestSandbox({
    tag: `usingCli`,
  })
);

beforeAll(async () => {
  await sandbox().create();
});

it('should add, list and remove entries', async () => {
  const { runMain } = sandbox();
  expect(await runMain()).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "[ - no entries found - ]
    ",
    }
  `);
  expect(await runMain('add', 'my first todo entry')).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "[32m+[39m [32m1[39m [32mmy first todo entry[39m
    ",
    }
  `);
  expect(await runMain('add', 'my second todo entry')).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "• [32m1[39m [37mmy first todo entry[39m
    [32m+[39m [32m2[39m [32mmy second todo entry[39m
    ",
    }
  `);
  expect(await runMain('list')).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "• [32m1[39m [37mmy first todo entry[39m
    • [32m2[39m [37mmy second todo entry[39m
    ",
    }
  `);
  expect(await runMain('add', 'third todo entry')).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "• [32m1[39m [37mmy first todo entry[39m
    • [32m2[39m [37mmy second todo entry[39m
    [32m+[39m [32m3[39m [32mthird todo entry[39m
    ",
    }
  `);
  expect(await runMain('remove', '2')).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "• [32m1[39m [37mmy first todo entry[39m
    [31m-[39m [31m2[39m [31mmy second todo entry[39m
    • [32m3[39m [37mthird todo entry[39m
    ",
    }
  `);
  expect(await runMain('list')).toMatchInlineSnapshot(`
    Object {
      "exitCode": 0,
      "output": "• [32m1[39m [37mmy first todo entry[39m
    • [32m3[39m [37mthird todo entry[39m
    ",
    }
  `);
});
