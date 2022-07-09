import { Command } from 'commander';

import { lintCommand } from './lint/lint';

export const repkaCommand = () =>
  new Command('repka').passThroughOptions(true).addCommand(lintCommand());

async function run() {
  await repkaCommand().parseAsync();
}

await run();
