import { Command } from 'commander';
import { green, white } from 'kleur/colors';

import { pipeline } from '../pipeline';
import { unitTest } from '../unitTest';
import { commandTemplate } from './commandTemplate';

const jest = () => green('jest');

export const testCommand = () =>
  new Command('test')
    .description(
      `Run ${jest()} for a package in the current directory. Unit tests must match ${white(
        '"src/**/*.(test|spec).(ts|tsx)"'
      )} or ${white('"src/**/__tests__/*.(test|spec).(ts|tsx)"')}. `
    )
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (_, command: Command) => {
      await commandTemplate({
        cliCommand: 'test',
        needsSourceCode: true,
        command,
        run: async () => {
          await pipeline(unitTest({ processArgs: command.args }));
        },
      });
    });
