import { Command } from 'commander';
import { red } from 'kleur/colors';

import { buildForNode } from '../buildForNode';
import { pipeline } from '../pipeline';
import { commandTemplate } from './commandTemplate';

const rollup = () => red('rollup');

export const buildNodeCommand = () =>
  new Command('build:node')
    .description(
      `Run ${rollup()} to bundle a package in current directory assuming Node.js v16 as target.`
    )
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (_opts: unknown, command: Command) => {
      await commandTemplate({
        cliCommand: 'build:node',
        turboTask: 'build',
        needsSourceCode: true,
        command,
        run: async () => {
          await pipeline(buildForNode());
        },
      });
    });
