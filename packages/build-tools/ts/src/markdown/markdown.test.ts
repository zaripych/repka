import { expect, it, jest } from '@jest/globals';

import { glowFormat, glowFormat_defaultDeps } from './glowFormat';
import { glowPrint, glowPrint_defaultDeps } from './glowPrint';
import { format, markdown, print } from './markdown';

const noop = () => {
  return;
};

it('should print when glow is not in the system', async () => {
  const disableGlow = jest
    .fn(glowPrint_defaultDeps.disableGlow)
    .mockImplementation(noop);
  const write = jest.fn(glowPrint_defaultDeps.write).mockImplementation(noop);
  const glowPrintFn = jest.fn(glowPrint).mockImplementation((opts) =>
    glowPrint(
      {
        ...opts,
        command: 'non-existing-executable',
      },
      {
        write,
        disableGlow,
      }
    )
  );
  await print(markdown`> Hello world`, {
    glowPrint: glowPrintFn,
  });
  expect(write).toBeCalledWith(
    expect.stringContaining(`
  > Hello world
`)
  );
  expect(disableGlow).toBeCalledTimes(1);
});

it('should format when glow is not in the system', async () => {
  const disableGlow = jest
    .fn(glowFormat_defaultDeps.disableGlow)
    .mockImplementation(noop);
  const glowFormatFn = jest.fn(glowFormat).mockImplementation((opts) =>
    glowFormat(
      {
        ...opts,
        command: 'non-existing-executable',
      },
      {
        disableGlow,
      }
    )
  );
  expect(
    await format(markdown`Hello _world_`, {
      glowFormat: glowFormatFn,
    })
  ).toMatchInlineSnapshot(`"Hello _world_"`);
  expect(disableGlow).toBeCalledTimes(1);
});
