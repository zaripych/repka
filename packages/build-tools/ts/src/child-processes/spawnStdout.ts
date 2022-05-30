import type {
  ChildProcess,
  ChildProcessWithoutNullStreams,
} from 'child_process';
import { assert } from 'console';

import { spawnToPromise } from './spawnToPromise';

export async function spawnToStdout(
  child: ChildProcess | ChildProcessWithoutNullStreams,
  opts?: {
    exitCodes?: number[];
  }
): Promise<string> {
  const stdoutData: string[] = [];
  assert(
    !!child.stdout,
    'Expected ".stdout" to be defined, which will only be defined if child process is spawned with correct parameters'
  );
  child.stdout?.setEncoding('utf-8');
  child.stdout?.on('data', (data: string) => {
    stdoutData.push(data);
  });
  await spawnToPromise(child, opts);
  return stdoutData.join('');
}
