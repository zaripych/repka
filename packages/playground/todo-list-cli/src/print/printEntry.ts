import type { TodoEntry } from '@playground/todo-list-store';
import { green, red, white } from 'kleur/colors';

export function printEntry(entry: TodoEntry, variant?: 'removed' | 'added') {
  switch (variant) {
    case 'added':
      console.log(green('+'), green(entry.entryId), green(entry.text));
      break;
    case 'removed':
      console.log(red('-'), red(entry.entryId), red(entry.text));
      break;
    default:
      console.log('•', green(entry.entryId), white(entry.text));
  }
}
