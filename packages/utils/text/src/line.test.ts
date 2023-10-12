import { expect, it } from '@jest/globals';

import { line } from './line';

it('replaces newlines with spaces', () => {
  expect(line`
    This is an example of how the line function operates and it is
    intended to be used for parameters passed as Error messages or
    places where a single unbroken line is required.
  `).toBe(
    'This is an example of how the line function operates and it is intended to be used for parameters passed as Error messages or places where a single unbroken line is required.'
  );
});

it('should remove line breaks and their surrounding indent', () => {
  expect(line`
    This is first line,

      the second,
      third line.
  `).toBe(`This is first line, the second, third line.`);
});
