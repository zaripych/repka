import { Command } from 'commander';

import { setup } from '../setup/setup';

export const initCommand = () =>
  new Command('init')
    .description(`Initialize the repository`)
    .helpOption(true)
    .allowUnknownOption(true)
    .option('--force', 'Force setting up repository despite warnings', false)
    .action(async ({ force }: { force: boolean }) => {
      await setup({ force });
    });
