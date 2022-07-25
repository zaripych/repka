import { red } from 'kleur/colors';
import { readdir } from 'node:fs/promises';

import { logger } from '../logger/logger';
import { freshStarterSetup } from './freshStarterSetup';
import { hasGit } from './hasGit';

const isStarterContent = (contents: string[]) => {
  const ignoreFiles = [
    'package.json',
    'LICENSE.md',
    'README.md',
    'pnpm.lock',
    'yarn.lock',
    'package-lock.json',
    'node_modules',
  ];
  const filteredContents = contents.filter(
    (item) => !item.startsWith('.') && !ignoreFiles.includes(item)
  );
  return filteredContents.length === 0;
};

export async function setup() {
  const contents = await readdir(process.cwd());

  const freshStarter = isStarterContent(contents);

  if (!freshStarter) {
    const gitInitialized = await hasGit();
    if (!gitInitialized) {
      logger.warn(
        `Looks like ${red(
          'git'
        )} is not initialized for current directory. The command is going to modify a bunch of files in current directory and it is recommended to "git init" and commit all your changes before continuing.`
      );
      process.exitCode = 1;
      return;
    }
  } else {
    await freshStarterSetup();
  }
}
