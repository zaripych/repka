import { onceAsync } from '@utils/ts';
import { dirname } from 'node:path';

import { logger } from '../logger/logger';
import { findDevDependency } from '../utils/findDevDependency';

export { readPackageJson } from '../package-json/readPackageJson';
export { loadRepositoryConfiguration } from '../utils/loadRepositoryConfiguration';
export { repositoryRootPath } from '../utils/repositoryRootPath';
export { loadAndRunGlobalHook } from './loadAndRunGlobalHook';

export const jestPluginRoot = onceAsync(async () => {
  const result = await findDevDependency({
    lookupPackageName: 'esbuild-jest',
  });
  if (!result) {
    logger.warn(
      'Jest plugins root cannot be determined. Do you have "@repka-kit/ts" in devDependencies at the monorepo root or at the local package?'
    );
  } else {
    if (logger.logLevel === 'debug') {
      logger.debug('Found jest plugins root at', dirname(result));
    }
  }
  return result ? dirname(result) : '.';
});
