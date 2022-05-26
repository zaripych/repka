import type { TodoEntry } from './entry';
import { entries, generateEntryId } from './state';

export function addEntry(entry: Omit<TodoEntry, 'entryId'>): TodoEntry {
  const newEntry = { ...entry, entryId: generateEntryId() };
  entries.push(newEntry);
  return newEntry;
}
