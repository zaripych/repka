import { logger } from '../logger/logger';
import type { SpawnResultOpts } from './spawnResult';
import { spawnResult } from './spawnResult';
import type { SpawnParameterMix } from './spawnToPromise';
import { spawnWithSpawnParameters } from './spawnToPromise';

export async function spawnOutput(
  ...parameters: SpawnParameterMix<SpawnResultOpts>
): Promise<string> {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const result = await spawnResult(child, {
    ...opts,
    exitCodes: opts?.exitCodes ?? [0],
  });
  return result.output.join('');
}

export async function spawnWithOutputWhenFailed(
  ...parameters: SpawnParameterMix<
    SpawnResultOpts & {
      outputWhenExitCodesNotIn?: number[];
    }
  >
) {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const result = await spawnResult(child, {
    ...opts,
  });
  if (result.error) {
    logger.error(result.output.join(''));
    return Promise.reject(result.error);
  } else if (
    opts?.outputWhenExitCodesNotIn &&
    typeof result.status === 'number' &&
    !opts.outputWhenExitCodesNotIn.includes(result.status)
  ) {
    logger.error(result.output.join(''));
    return Promise.resolve(result);
  }
  return Promise.resolve(result);
}
