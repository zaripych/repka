import type {
  ChildProcess,
  ChildProcessWithoutNullStreams,
} from 'child_process';

import { guessMonorepoRoot } from '../file-system/guessMonorepoRoot';
import { captureStackTrace } from '../utils/stackTrace';

export async function spawnToPromise(
  child: ChildProcess | ChildProcessWithoutNullStreams,
  opts?: {
    exitCodes?: number[] | 'any';
    cwd?: string;
  }
): Promise<void> {
  const { prepareForRethrow } = captureStackTrace();
  const exitCodes = opts?.exitCodes || [0];

  const cwd = guessMonorepoRoot();
  console.log(
    ['>', child.spawnfile, ...child.spawnargs.slice(1)]
      .map((entry) => entry.replace(cwd + '/', './'))
      .join(' '),
    ...(opts?.cwd ? [`in ${opts.cwd}`] : [])
  );

  await new Promise<void>((res, rej) =>
    child
      .on('close', (code, signal) => {
        if (typeof code === 'number') {
          if (exitCodes !== 'any' && !exitCodes.includes(code)) {
            rej(
              prepareForRethrow(
                new Error(`Process has failed with code ${code}`)
              )
            );
          } else {
            res();
          }
        } else if (signal) {
          rej(
            prepareForRethrow(new Error(`Failed to execute process: ${signal}`))
          );
        } else {
          throw prepareForRethrow(new Error('Expected signal or error code'));
        }
      })
      .on('error', rej)
  );
  // inherit exit code
  if (
    typeof child.exitCode === 'number' &&
    typeof process.exitCode !== 'number'
  ) {
    process.exitCode = child.exitCode;
  }
}
