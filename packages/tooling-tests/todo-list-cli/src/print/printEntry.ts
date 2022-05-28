import type { TodoEntry } from '@tooling-tests/todo-list-store';
import pico from 'picocolors';

export function printEntry(entry: TodoEntry, variant?: 'removed' | 'added') {
  switch (variant) {
    case 'added':
      console.log(
        pico.green('+'),
        pico.green(entry.entryId),
        pico.green(entry.text)
      );
      break;
    case 'removed':
      console.log(pico.red('-'), pico.red(entry.entryId), pico.red(entry.text));
      break;
    default:
      console.log('•', pico.green(entry.entryId), pico.white(entry.text));
  }
}
