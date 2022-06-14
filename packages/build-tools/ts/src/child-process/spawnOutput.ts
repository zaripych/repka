import type {
  ChildProcess,
  ChildProcessWithoutNullStreams,
} from 'child_process';
import { assert } from 'console';

import { spawnToPromise } from './spawnToPromise';

export async function spawnOutput(
  child: ChildProcess | ChildProcessWithoutNullStreams,
  opts?: {
    exitCodes?: number[];
    output?: ['stdout' | 'stderr', ...Array<'stdout' | 'stderr'>];
  }
): Promise<string> {
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
  await spawnToPromise(child, opts);
  return combinedData.join('');
}
