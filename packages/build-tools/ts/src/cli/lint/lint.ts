import { Command } from 'commander';
import { blue, yellow } from 'picocolors';

import { lint } from '../../lint';
import { pipeline } from '../../pipeline';

const eslint = () => yellow('eslint');

const tsc = () => blue('tsc');

export const lintCommand = () =>
  new Command('lint')
    .description(
      `Lint and check for TypeScript errors for package in current directory using ${eslint()} and ${tsc()}`
    )
    .helpOption(false)
    .addHelpText(
      'after',
      `\n${eslint()} options can be passed in and will be forwarded, otherwise default bespoke config and options are used`
    )
    .allowUnknownOption(true)
    .action(async (_opts: unknown, command: Command) => {
      if (command.args.includes('-h') || command.args.includes('--help')) {
        console.log(command.helpInformation());
      }
      await pipeline(lint({ processArgs: command.args }));
    });
