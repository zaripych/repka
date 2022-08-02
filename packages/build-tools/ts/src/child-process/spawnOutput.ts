import { logger } from '../logger/logger';
import type { SpawnResultOpts, SpawnResultReturn } from './spawnResult';
import { spawnResult } from './spawnResult';
import type { SpawnParameterMix } from './spawnToPromise';
import { spawnWithSpawnParameters } from './spawnToPromise';

export async function spawnOutput(
  ...parameters: SpawnParameterMix<SpawnResultOpts>
): Promise<string> {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const result = await spawnResult(child, opts);
  return result.output.join('');
}

const defaultShouldOutput = (result: SpawnResultReturn) => {
  return result.error || result.status !== 0 || logger.logLevel === 'debug';
};

export async function spawnOutputConditional(
  ...parameters: SpawnParameterMix<
    SpawnResultOpts & {
      /**
       * By default will output to `stderr` when spawn result failed with an error, when
       * status code is not zero or when `Logger.logLevel` is `debug`
       */
      shouldOutput?: (result: SpawnResultReturn) => boolean;
    }
  >
) {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const result = await spawnResult(child, opts);
  const shouldOutput = opts.shouldOutput ?? defaultShouldOutput;
  if (shouldOutput(result)) {
    logger.error(result.output.join(''));
  }
  if (result.error) {
    return Promise.reject(result.error);
  }
  return Promise.resolve(result);
}
