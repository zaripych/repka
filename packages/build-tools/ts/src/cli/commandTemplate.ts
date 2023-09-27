import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Command } from 'commander';
import { bgBlack, bold, white } from 'kleur/colors';

import { spawnToPromise } from '../child-process';
import { logger } from '../logger/logger';
import { binPath } from '../utils/binPath';
import { checkIsEmpty } from '../utils/checkIsEmpty';
import { determinePackageManager } from '../utils/determinePackageManager';
import { loadRepositoryConfiguration } from '../utils/loadRepositoryConfiguration';

export async function commandTemplate(opts: {
  cliCommand: string;
  needsSourceCode: boolean;
  npmScriptsTask?: string;
  command: Command;
  run: (opts: { help: boolean }) => Promise<void>;
}) {
  const { root, type } = await loadRepositoryConfiguration();
  const cwd = opts.command.parent?.opts<{ cwd?: string }>()?.cwd;
  if (cwd) {
    process.chdir(cwd);
  }

  if (type === 'multiple-packages' && process.cwd() === root) {
    const packageManager = await determinePackageManager({
      directory: root,
    });

    let command = '';
    switch (packageManager) {
      case 'npm':
        command = `npm run ${
          opts.npmScriptsTask ?? opts.cliCommand
        } --workspaces`;
        break;
      case 'pnpm':
        command = `pnpm -r ${opts.npmScriptsTask ?? opts.cliCommand}`;
        break;
      case 'yarn':
        command = `yarn workspaces run ${
          opts.npmScriptsTask ?? opts.cliCommand
        }`;
        break;
    }

    logger.error(
      `Running this command in the monorepo root is not supported - try using ${packageManager}: \n\n﹥ ${bold(
        bgBlack(white(command))
      )}\n`
    );

    process.exitCode = 2;
    return;
  }
  const task = opts.npmScriptsTask ?? opts.cliCommand;
  const configLocation = resolve(`${task}.ts`);
  const config = await stat(configLocation).catch(() => null);

  const runUsingConfig = async () => {
    logger.debug(`Found a "${configLocation}", running it with "tsx": `);
    await spawnToPromise(
      process.execPath,
      [
        await binPath({
          binName: 'tsx',
          binScriptPath: 'tsx/dist/cli.mjs',
        }),
        configLocation,
        ...opts.command.args,
      ],
      {
        stdio: 'inherit',
        exitCodes: 'inherit',
      }
    );
  };

  const help =
    opts.command.args.includes('--help') || opts.command.args.includes('-h');

  if (help) {
    opts.command.outputHelp();
  }

  if (opts.needsSourceCode) {
    const isEmpty = await checkIsEmpty();
    if (isEmpty) {
      logger.info(
        `There is nothing to ${
          opts.npmScriptsTask ?? task
        } here it seems. Use "repka init" to start.`
      );
      return;
    }
  }

  if (!config || !config.isFile()) {
    await opts.run({ help });
  } else {
    await runUsingConfig();
  }
}
