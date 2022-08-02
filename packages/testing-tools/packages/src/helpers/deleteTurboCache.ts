import { logger } from '@build-tools/ts';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { ignoreErrors } from './ignoreErrors';
import { repositoryRootPath } from './repositoryRootPath';

export async function deleteTurboCache(turboHash: string) {
  const repoRoot = await repositoryRootPath();
  const turboCacheLocation = join(
    repoRoot,
    'node_modules',
    '.cache',
    'turbo',
    turboHash
  );

  const isDirectory = await ignoreErrors(
    stat(turboCacheLocation).then((result) => result.isDirectory())
  );

  if (!isDirectory) {
    return;
  }

  logger.debug('Deleting turbo cache at', turboCacheLocation);

  await ignoreErrors(
    rm(turboCacheLocation, {
      recursive: true,
    })
  );
}
