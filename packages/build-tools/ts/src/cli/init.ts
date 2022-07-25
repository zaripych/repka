import { Command } from 'commander';

import { setup } from '../setup/setup';

export const initCommand = () =>
  new Command('init')
    .description(`Initialize the repository`)
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async () => {
      await setup();
    });
