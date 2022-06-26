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
