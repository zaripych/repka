import { logger } from '../logger/logger';
import type { ExtraSpawnResultOpts } from './spawnResult';
import { spawnResult } from './spawnResult';
import type { SpawnParameterMix } from './spawnToPromise';
import { spawnWithSpawnParameters } from './spawnToPromise';

export async function spawnOutput(
  ...parameters: SpawnParameterMix<ExtraSpawnResultOpts>
): Promise<string> {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const result = await spawnResult(child, {
    ...opts,
    exitCodes: opts?.exitCodes ?? [0],
  });
  return result.output.join('');
}

export async function spawnWithOutputWhenFailed(
  ...parameters: SpawnParameterMix<ExtraSpawnResultOpts>
) {
  const result = await spawnResult(...parameters);
  if (result.error) {
    logger.error(result.output.join(''));
    return Promise.reject(result.error);
  }
  return Promise.resolve(result);
}
