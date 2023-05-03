import assert from 'node:assert';

import {
  listEntries,
  removeEntryById,
  removeEntryByText,
} from '@tooling-tests/todo-list-store';
import { isEntryId } from '@tooling-tests/todo-list-store';
import { createCommand } from 'commander';

import { printEntries } from '../print/printEntries';
import { printEntry } from '../print/printEntry';

export const removeCommand = () =>
  createCommand('remove')
    .argument('<id-or-text>', "Id of the entry or it's text")
    .action((idOrText: string) => {
      assert(typeof idOrText === 'string', 'Text argument expected');
      const entries = listEntries();
      let result: ReturnType<typeof removeEntryById>;
      if (isEntryId(idOrText)) {
        result = removeEntryById(idOrText);
        if (!result) {
          result = removeEntryByText(idOrText);
        }
      } else {
        result = removeEntryByText(idOrText);
      }
      if (result) {
        printEntries(entries, (entry) => {
          if (result?.removedEntry.entryId === entry.entryId) {
            printEntry(result.removedEntry, 'removed');
          } else {
            printEntry(entry);
          }
        });
      } else {
        console.log('[ - entry not found - ]');
      }
    });
