import type { TodoEntry } from './entry';
import { entries } from './state';

export function findEntryById(entryId: string): TodoEntry | undefined {
  return entries.find((entry) => entry.entryId === entryId);
}

export function findEntriesInRange(filter: {
  start: number;
  end: number;
}): TodoEntry[] {
  return entries.reduce(
    (arr, item) =>
      item.timestamp > filter.start && item.timestamp <= filter.end
        ? (arr.push({ ...item }), arr)
        : arr,
    [] as TodoEntry[]
  );
}

export function findCompleteEntries(): TodoEntry[] {
  return entries.reduce<TodoEntry[]>(
    (arr, item) => (item.done ? (arr.push({ ...item }), arr) : arr),
    [] as TodoEntry[]
  );
}

export function findIncompleteEntries(): TodoEntry[] {
  return entries.reduce<TodoEntry[]>(
    (arr, item) => (!item.done ? (arr.push({ ...item }), arr) : arr),
    [] as TodoEntry[]
  );
}
