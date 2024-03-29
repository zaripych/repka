import assert from 'assert';

import type { SpawnParameterMix, SpawnToPromiseOpts } from './spawnToPromise';
import { spawnWithSpawnParameters } from './spawnToPromise';
import { spawnToPromise } from './spawnToPromise';

export type SpawnResultOpts = {
  output?:
    | Array<'stdout' | 'stderr'>
    | ['stdout' | 'stderr', ...Array<'stdout' | 'stderr'>];
  buffers?: {
    combined?: string[];
    stdout?: string[];
    stderr?: string[];
  };
} & SpawnToPromiseOpts;

export type SpawnResultReturn = {
  pid?: number;
  output: string[];
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error | undefined;
};

export async function spawnResult(
  ...parameters: SpawnParameterMix<SpawnResultOpts>
): Promise<SpawnResultReturn> {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const combinedData: string[] = opts.buffers?.combined ?? [];
  const stdoutData: string[] = opts.buffers?.stdout ?? [];
  const stderrData: string[] = opts.buffers?.stderr ?? [];
  const output = opts.output ?? ['stdout', 'stderr'];
  if (output.includes('stdout')) {
    assert(
      !!child.stdout,
      'Expected ".stdout" to be defined, which will only be defined if child process is spawned with correct parameters'
    );
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (data: string) => {
      combinedData.push(data);
      stdoutData.push(data);
    });
  }
  if (output.includes('stderr')) {
    assert(
      !!child.stderr,
      'Expected ".stderr" to be defined, which will only be defined if child process is spawned with correct parameters'
    );
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (data: string) => {
      combinedData.push(data);
      stderrData.push(data);
    });
  }
  const [result] = await Promise.allSettled([spawnToPromise(child, opts)]);
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
