import { basename } from 'path';

import { promptFactory } from './core';

export const packageNamePrompt = promptFactory(() => {
  return [
    {
      message: 'Please confirm the name of the package',
      name: 'packageName' as const,
      type: 'text',
      initial: basename(process.cwd()),
    },
  ];
});
