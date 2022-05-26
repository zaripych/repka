import { listEntries } from '@tooling-tests/todo-list-store';
import { createCommand } from 'commander';

import { printEntries } from '../print/printEntries';

export const listCommand = () =>
  createCommand('list').action(() => {
    const entries = listEntries();
    if (entries.length === 0) {
      console.log('[ - no entries found - ]');
    }
    printEntries(entries);
  });
