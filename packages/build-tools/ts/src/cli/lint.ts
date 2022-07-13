import { Command } from 'commander';
import colors from 'picocolors';

import { lint } from '../lint';
import { pipeline } from '../pipeline';
import { commandTemplate } from './commandTemplate';

const eslint = () => colors.yellow('eslint');

const tsc = () => colors.blue('tsc');

export const lintCommand = () =>
  new Command('lint')
    .description(
      `Run ${eslint()} and ${tsc()} for a package in current directory.` +
        ` Arguments are forwarded to ${eslint()}, if none passed - bespoke config and options are used.`
    )
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (_opts: unknown, command: Command) => {
      await commandTemplate({
        cliCommand: 'lint',
        command,
        run: async () => {
          await pipeline(lint({ processArgs: command.args }));
        },
      });
    });
