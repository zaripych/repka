import { Command } from 'commander';
import colors from 'picocolors';

import { pipeline } from '../pipeline';
import { unitTest } from '../unitTest';
import { commandTemplate } from './commandTemplate';

const jest = () => colors.green('jest');

export const testCommand = () =>
  new Command('test')
    .description(
      `Run ${jest()} for a package in the current directory. Unit tests must match ${colors.white(
        '"src/**/*.(test|spec).(ts|tsx)"'
      )} or ${colors.white('"src/**/__tests__/*.(test|spec).(ts|tsx)"')}. `
    )
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (_, command: Command) => {
      await commandTemplate({
        cliCommand: 'test',
        command,
        run: async () => {
          await pipeline(unitTest({ processArgs: command.args }));
        },
      });
    });
