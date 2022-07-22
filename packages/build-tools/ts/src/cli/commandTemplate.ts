import type { Command } from 'commander';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import colors from 'picocolors';

import { logger } from '../logger/logger';
import { cliArgsPipe } from '../utils/cliArgsPipe';
import { loadRepositoryConfiguration } from '../utils/loadRepositoryConfiguration';
import { runBin } from '../utils/runBin';

function argsToTurboArgs(opts: { cliCommand: string; turboTask?: string }) {
  return cliArgsPipe(
    [
      (args) => {
        const task = opts.turboTask ?? opts.cliCommand;
        const index = args.inputArgs.findIndex(
          (arg) => arg === opts.cliCommand
        );
        const after = args.inputArgs.slice(0, index);
        const afterAfter = args.inputArgs.slice(index + 1);
        const rest = [...after, ...afterAfter].filter(
          (entry) => entry !== '--'
        );
        return {
          ...args,
          inputArgs: rest.length > 0 ? [task, '--', ...rest] : [task],
        };
      },
    ],
    process.argv.slice(2)
  ).join(' ');
}

export async function commandTemplate(opts: {
  cliCommand: string;
  turboTask?: string;
  command: Command;
  run: (opts: { help: boolean }) => Promise<void>;
}) {
  const { root, type } = await loadRepositoryConfiguration();
  if (type === 'multiple-packages' && process.cwd() === root) {
    logger.error(
      `Running this command in the monorepo root is not supported - try using "turbo": \n\n﹥ ${colors.bold(
        colors.bgBlack(
          colors.white(
            `turbo run ${argsToTurboArgs({
              cliCommand: opts.cliCommand,
              turboTask: opts.turboTask,
            })}`
          )
        )
      )}\n`
    );
    process.exitCode = 2;
    return;
  }
  const task = opts.turboTask ?? opts.cliCommand;
  const configLocation = resolve(`${task}.ts`);
  const config = await stat(configLocation).catch(() => null);

  const runUsingConfig = async () => {
    logger.debug(`Found a "${configLocation}", running it with "tsx": `);
    await runBin('tsx', [configLocation, ...process.argv.slice(2)], {
      stdio: 'inherit',
      exitCodes: 'inherit',
    });
  };

  const help =
    opts.command.args.includes('--help') || opts.command.args.includes('-h');

  if (help) {
    opts.command.outputHelp();
  }

  if (!config || !config.isFile()) {
    await opts.run({ help });
  } else {
    await runUsingConfig();
  }
}
