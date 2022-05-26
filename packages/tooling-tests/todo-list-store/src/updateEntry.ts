import type { TodoEntry, TodoEntryUpdateShape } from './entry';
import { entries } from './state';

export function updateEntry(
  entry: TodoEntryUpdateShape
): TodoEntry | undefined {
  const toUpdate = entries.find((item) => item.entryId === entry.entryId);
  if (!toUpdate) {
    return;
  }
  if (typeof entry.done !== 'undefined') {
    toUpdate.done = entry.done;
  }
  if (typeof entry.text !== 'undefined') {
    toUpdate.text = entry.text;
  }
  if (typeof entry.timestamp != 'undefined') {
    toUpdate.timestamp = entry.timestamp;
  }
  return toUpdate;
}
