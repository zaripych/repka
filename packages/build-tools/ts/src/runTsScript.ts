import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { spawnOutputConditional } from './child-process';
import { logger } from './logger/logger';
import { binPath } from './utils/binPath';

export async function runTsScript(opts: {
  location: string;
  importMetaUrl?: URL;
  args?: string[];
}) {
  const started = performance.now();
  try {
    const location = opts.importMetaUrl
      ? fileURLToPath(new URL(opts.location, opts.importMetaUrl))
      : opts.location;

    if (logger.logLevel !== 'debug') {
      logger.log(`Running "${location}"`);
    }

    return await spawnOutputConditional(
      process.execPath,
      [
        await binPath({
          binName: 'tsx',
          binScriptPath: 'tsx/dist/cli.js',
        }),
        location,
        ...(opts.args || []),
      ],
      {
        exitCodes: [0],
        ...(logger.logLevel === 'debug' && {
          stdio: 'inherit',
          output: [],
        }),
        env: {
          ...process.env,
          LOG_LEVEL: logger.logLevel,
        },
      }
    );
  } finally {
    if (logger.logLevel !== 'debug') {
      logger.log(
        `Finished in ${((performance.now() - started) / 1000).toFixed(2)}s`
      );
    }
  }
}
