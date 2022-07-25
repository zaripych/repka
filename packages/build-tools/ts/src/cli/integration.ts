import { Command } from 'commander';
import { green, white } from 'kleur/colors';

import { integrationTest } from '../integrationTest';
import { pipeline } from '../pipeline';
import { commandTemplate } from './commandTemplate';

const jest = () => green('jest');

export const integrationCommand = () =>
  new Command('integration')
    .description(
      `Run ${jest()} for a package in the current directory. Integration tests must match ${white(
        '"src/__integration__/**/*.(test|spec).(ts|tsx)".'
      )}` +
        ` Pass -i parameter to run them in band if your integration tests do not support parallel execution. Create ${white(
          'src/__integration__/setup.ts'
        )} to prepare your environment for integration tests. `
    )
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (_, command: Command) => {
      await commandTemplate({
        cliCommand: 'integration',
        needsSourceCode: true,
        command,
        run: async () => {
          await pipeline(integrationTest({ processArgs: command.args }));
        },
      });
    });
