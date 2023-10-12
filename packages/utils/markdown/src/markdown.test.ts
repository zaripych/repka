import { expect, it, jest } from '@jest/globals';

import { glowFormat, glowFormatDefaultDeps } from './glowFormat';
import { glowPrint, glowPrintDefaultDeps } from './glowPrint';
import { formatMarkdown, markdown, printMarkdown } from './markdown';

const noop = () => {
  return;
};

it('should print when glow is not in the system', async () => {
  const disableGlow = jest
    .fn(glowPrintDefaultDeps.disableGlow)
    .mockImplementation(noop);
  const write = jest.fn(glowPrintDefaultDeps.write).mockImplementation(noop);

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

  const text = markdown`
    Hello _world_

    # Header
  `;

  await printMarkdown(text, {
    glowPrint: glowPrintFn,
  });

  expect(disableGlow).toBeCalledTimes(1);
  expect(write).toBeCalledWith(expect.stringContaining(`Hello _world_`));
});

it('should format when glow is not in the system', async () => {
  const disableGlow = jest
    .fn(glowFormatDefaultDeps.disableGlow)
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
    await formatMarkdown(
      markdown`
        Hello _world_

        # Header
      `,
      {
        glowFormat: glowFormatFn,
      }
    )
  ).toBe(`Hello _world_

# Header`);

  expect(disableGlow).toBeCalledTimes(1);
});
