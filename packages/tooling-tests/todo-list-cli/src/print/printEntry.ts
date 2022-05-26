import type { TodoEntry } from '@tooling-tests/todo-list-store';
import chalk from 'chalk';

export function printEntry(entry: TodoEntry, variant?: 'removed' | 'added') {
  switch (variant) {
    case 'added':
      console.log(
        chalk.greenBright('+'),
        chalk.greenBright(entry.entryId),
        chalk.greenBright(entry.text)
      );
      break;
    case 'removed':
      console.log(
        chalk.redBright('-'),
        chalk.redBright(entry.entryId),
        chalk.redBright(entry.text)
      );
      break;
    default:
      console.log(
        '•',
        chalk.greenBright(entry.entryId),
        chalk.whiteBright(entry.text)
      );
  }
}
