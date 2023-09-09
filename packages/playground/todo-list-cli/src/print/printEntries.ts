import type { TodoEntry } from '@playground/todo-list-store';

import { printEntry } from './printEntry';

export function printEntries(
  entries: TodoEntry[],
  printEntryFn: (entry: TodoEntry) => void = (entry) => printEntry(entry)
) {
  entries.forEach(printEntryFn);
}
