import { load, save } from '@playground/todo-list-store';
import { program } from 'commander';

import { addCommand } from './add/command';
import { listCommand } from './list/command';
import { removeCommand } from './remove/command';

export async function run() {
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
