import { Command, createOption } from 'commander';

import { buildNodeCommand } from './buildNode';
import { declarationsCommand } from './declarations';
import { integrationCommand } from './integration';
import { lintCommand } from './lint';
import { testCommand } from './test';

export const repkaCommand = () =>
  new Command('repka')
    .enablePositionalOptions(true)
    .passThroughOptions(true)
    .addOption(
      createOption('--log-level [level]', `set log level for the CLI`)
        .choices(['debug', 'info', 'warn', 'error', 'fatal'])
        .default('info')
    )
    .addCommand(lintCommand())
    .addCommand(testCommand())
    .addCommand(integrationCommand())
    .addCommand(declarationsCommand())
    .addCommand(buildNodeCommand());

async function run() {
  await repkaCommand().parseAsync();
}

await run();
