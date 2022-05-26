import type { TodoEntry } from './entry';
import { entries } from './state';

function removeEntryGivenCondition(condition: (entry: TodoEntry) => boolean) {
  let indexOfFound = -1;
  const entry = entries.find((entry, index) => {
    if (condition(entry)) {
      indexOfFound = index;
      return true;
    }
    return false;
  });
  if (typeof indexOfFound !== 'undefined') {
    entries.splice(indexOfFound, 1);
  }
  return entry
    ? {
        removedEntry: entry,
        removedAt: indexOfFound,
      }
    : undefined;
}

export function removeEntryById(entryId: string) {
  return removeEntryGivenCondition((entry) => entry.entryId === entryId);
}

export function removeEntryByText(text: string) {
  return removeEntryGivenCondition((entry) => entry.text === text);
}
