import { addEntry, listEntries } from '@tooling-tests/todo-list-store';
import type { Command } from 'commander';
import { createCommand } from 'commander';

import { printEntries } from '../print/printEntries';
import { printEntry } from '../print/printEntry';

export const addCommand = () =>
  createCommand('add')
    .argument('<text>', 'Text of the todo entry')
    .action((_: string, __: unknown, command: Command) => {
      const fullText = command.args.join(' ');
      const newEntry = addEntry({
        done: false,
        text: fullText,
        timestamp: Date.now(),
      });
      printEntries(listEntries(), (entry) => {
        if (entry.entryId == newEntry.entryId) {
          printEntry(entry, 'added');
        } else {
          printEntry(entry);
        }
      });
    });
