import { Command } from 'commander';
import colors from 'picocolors';

import { declarations } from '../declarations';
import { pipeline } from '../pipeline';
import { commandTemplate } from './commandTemplate';

const generator = () => colors.blue('dts-bundle-generator');

export const declarationsCommand = () =>
  new Command('declarations')
    .description(
      `Run ${generator()} for a package in the current directory. TypeScript declarations will be generated and put into ${colors.white(
        'dist'
      )} directory. This is optional if your package is never published or never used as a library.`
    )
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (_, command: Command) => {
      await commandTemplate({
        cliCommand: 'declarations',
        command,
        run: async () => {
          await pipeline(declarations());
        },
      });
    });
