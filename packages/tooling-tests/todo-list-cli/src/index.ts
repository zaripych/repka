import { load, save } from '@tooling-tests/todo-list-store';
import { program } from 'commander';

import { addCommand } from './add/command';
import { listCommand } from './list/command';
import { removeCommand } from './remove/command';

async function run() {
  await load();
  await program
    .addCommand(listCommand(), {
      isDefault: true,
    })
    .addCommand(addCommand())
    .addCommand(removeCommand())
    .parseAsync();
  await save();
}

await run();
