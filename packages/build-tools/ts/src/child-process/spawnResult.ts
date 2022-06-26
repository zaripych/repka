import { assert } from 'console';

import type { SpawnParameterMix, SpawnToPromiseExtra } from './spawnToPromise';
import { spawnWithSpawnParameters } from './spawnToPromise';
import { spawnToPromise } from './spawnToPromise';

export type ExtraSpawnResultOpts = {
  output?: ['stdout' | 'stderr', ...Array<'stdout' | 'stderr'>];
} & SpawnToPromiseExtra;

type SpawnResultReturn = {
  pid?: number;
  output: string[];
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error | undefined;
};

export async function spawnResult(
  ...parameters: SpawnParameterMix<ExtraSpawnResultOpts>
): Promise<SpawnResultReturn> {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const combinedData: string[] = [];
  const stdoutData: string[] = [];
  const stderrData: string[] = [];
  const output = opts?.output ?? ['stdout', 'stderr'];
  if (output.includes('stdout')) {
    assert(
      !!child.stdout,
      'Expected ".stdout" to be defined, which will only be defined if child process is spawned with correct parameters'
    );
    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (data: string) => {
      combinedData.push(data);
      stdoutData.push(data);
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
      stderrData.push(data);
    });
  }
  const [result] = await Promise.allSettled([
    spawnToPromise(child, {
      exitCodes: opts?.exitCodes ?? 'any',
      cwd: opts?.cwd,
    }),
  ]);
  return {
    pid: child.pid,
    signal: child.signalCode,
    status: child.exitCode,
    get output() {
      return combinedData;
    },
    get stderr() {
      return stderrData.join('');
    },
    get stdout() {
      return stdoutData.join('');
    },
    get error() {
      return result.status === 'rejected'
        ? (result.reason as Error)
        : undefined;
    },
  };
}
