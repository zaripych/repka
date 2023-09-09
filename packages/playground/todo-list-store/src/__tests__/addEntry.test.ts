import { addEntry } from '../addEntry';
import { listEntries } from '../listEntries';

it('adds entry', () => {
  const timestamp = Date.now();

  addEntry({
    text: 'hello world',
    timestamp,
    done: false,
  });

  expect(listEntries()).toMatchObject([
    {
      text: 'hello world',
      timestamp,
      done: false,
    },
  ]);
});
