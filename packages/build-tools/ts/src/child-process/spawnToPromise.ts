import type {
  ChildProcess,
  ChildProcessWithoutNullStreams,
} from 'child_process';

import { guessMonorepoRoot } from '../file-system/guessMonorepoRoot';

export async function spawnToPromise(
  child: ChildProcess | ChildProcessWithoutNullStreams,
  opts?: {
    exitCodes?: number[];
    cwd?: string;
  }
): Promise<void> {
  const stack = new Error().stack;
  const makeError = (err: Error) => {
    err.stack = stack;
    return err;
  };
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
          if (!exitCodes.includes(code)) {
            rej(makeError(new Error(`Process has failed with code ${code}`)));
          } else {
            res();
          }
        } else if (signal) {
          rej(makeError(new Error(`Failed to execute process: ${signal}`)));
        } else {
          throw makeError(new Error('Expected signal or error code'));
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
