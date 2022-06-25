import { assert } from 'console';

import type { SpawnParameterMix, SpawnToPromiseExtra } from './spawnToPromise';
import { spawnWithSpawnParameters } from './spawnToPromise';
import { spawnToPromise } from './spawnToPromise';

type ExtraSpawnOutputOpts = {
  output?: ['stdout' | 'stderr', ...Array<'stdout' | 'stderr'>];
} & SpawnToPromiseExtra;

export async function spawnOutput(
  ...parameters: SpawnParameterMix<ExtraSpawnOutputOpts>
): Promise<string> {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const combinedData: string[] = [];
  const output = opts?.output ?? ['stdout', 'stderr'];
  if (output.includes('stdout')) {
    assert(
      !!child.stdout,
      'Expected ".stdout" to be defined, which will only be defined if child process is spawned with correct parameters'
    );
    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (data: string) => {
      combinedData.push(data);
    });
  }
  if (output.includes('stderr')) {
    assert(
      !!child.stderr,
      'Expected ".stderr" to be defined, which will only be defined if child process is spawned with correct parameters'
    );
    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', (data: string) => {
      combinedData.push(data);
    });
  }
  await spawnToPromise(child, {
    // since we expect an output, we should double check
    // that we are only interpreting output if the child process
    // is done successfully
    exitCodes: opts?.exitCodes ?? [0],
    cwd: opts?.cwd,
  });
  return combinedData.join('');
}
