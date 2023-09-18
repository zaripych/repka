import { line } from './line';

it('should remove line breaks and their surrounding indent', () => {
  expect(line`
    This is first line,

      the second,
      third line.
  `).toBe(`This is first line, the second, third line.`);
});
