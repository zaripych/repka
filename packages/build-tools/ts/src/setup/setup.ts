import { readdir } from 'node:fs/promises';

import { markdown, print } from '../markdown/markdown';
import { freshStarterSetup } from './freshStarterSetup';
import { hasGit } from './hasGit';

const isStarterContent = (contents: string[]) => {
  const ignoreFiles = [
    'package.json',
    'LICENSE.md',
    'README.md',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'node_modules',
  ];
  const filteredContents = contents.filter(
    (item) => !item.startsWith('.') && !ignoreFiles.includes(item)
  );
  return filteredContents.length === 0;
};

const needGit = markdown`
  Looks like \`git\` is not initialized in current directory.

  The command is going to modify a bunch of files and it is recommended to
  \`git init\` and commit your changes before continuing. Alternatively, try
  \`--force\` option to override.
`;

export async function setup(opts: { force: boolean }) {
  const contents = await readdir(process.cwd());

  const freshStarter = isStarterContent(contents);

  if (freshStarter) {
    await freshStarterSetup();
  } else {
    const gitInitialized = await hasGit();
    if (!gitInitialized && !opts.force) {
      await print(needGit);
      process.exitCode = 1;
      return;
    }
    await freshStarterSetup();
  }
}
