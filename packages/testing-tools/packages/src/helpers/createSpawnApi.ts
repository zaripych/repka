import type {
  SpawnOptionsWithExtra,
  SpawnResultOpts,
  SpawnResultReturn,
} from '@build-tools/ts';
import { spawnResult as spawnResultCore } from '@build-tools/ts';
import { captureStackTrace, escapeRegExp } from '@utils/ts';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Transform } from 'node:stream';

import { searchAndReplaceTextTransform } from './replaceTextInFiles';
import { stripAnsi } from './stripAnsi';

export type SpawnTestApi = ReturnType<typeof createTestSpawnApi>;

export type SpawnController = Awaited<
  ReturnType<SpawnTestApi['spawnController']>
>;

export function createTestSpawnApi(
  opts: () => Promise<{
    cwd: string;
    env?: Record<string, string>;
  }>
) {
  const spawnResultConvert = (result: SpawnResultReturn) => ({
    output: stripAnsi(result.output.join('')),
    ...(result.error && {
      error: result.error,
    }),
    ...(typeof result.status === 'number' && {
      exitCode: result.status,
    }),
    ...(result.signal && {
      signalCode: result.signal,
    }),
  });

  const spawnResult = async (
    executable: string,
    args: string[],
    spawnOpts?: SpawnOptionsWithExtra<SpawnResultOpts>
  ) => {
    const { cwd, env } = await opts();

    const result = await spawnResultCore(executable, args, {
      cwd,
      exitCodes: 'any',
      ...(env && {
        env: {
          ...process.env,
          ...env,
        },
      }),
      ...spawnOpts,
    });

    return spawnResultConvert(result);
  };

  const spawnController = async (
    executable: string,
    args: string[],
    spawnOpts?: SpawnOptionsWithExtra<SpawnResultOpts>
  ) => {
    const { cwd, env } = await opts();

    const activeOpts = {
      cwd,
      ...(env && {
        env: {
          ...process.env,
          ...env,
        },
      }),
      ...spawnOpts,
    };

    const child = spawn(executable, args, activeOpts);

    const combined: string[] = [];

    const resultPromise = spawnResultCore(child, {
      exitCodes: 'any',
      ...activeOpts,
      buffers: {
        combined,
      },
    });

    const waitForOutput = async (
      output: string | RegExp,
      timeoutMs: number | 'no-timeout' = 500
    ) => {
      if (!child.stdout || !child.stderr) {
        throw new Error('There is no .stdout');
      }
      const out = child.stdout;
      const err = child.stderr;

      const stripAnsiTransform = new Transform({
        transform(this, chunk: Buffer, _, callback) {
          this.push(stripAnsi(chunk.toString('utf8')));
          callback();
        },
      });

      return new Promise<void>((res, rej) => {
        const stop = () => {
          out.unpipe(stripAnsiTransform);
          err.unpipe(stripAnsiTransform);
          stripAnsiTransform.unpipe(search);
          if (out.isPaused() && out.listenerCount('data') > 0) {
            out.resume();
          }
          if (err.isPaused() && err.listenerCount('data') > 0) {
            err.resume();
          }
        };

        const search = searchAndReplaceTextTransform({
          filters: [
            {
              regExp:
                typeof output === 'string'
                  ? new RegExp(escapeRegExp(output))
                  : output,
            },
          ],
          maxMatchLength: typeof output === 'string' ? output.length : 200,
          onEvent: (event) => {
            stop();
            if (event.event !== 'match') {
              rej(
                new Error(
                  `Expected output "${String(
                    output
                  )}" was not generated, got:\n${stripAnsi(combined.join(''))}`
                )
              );
            } else {
              res();
            }
          },
        });

        if (timeoutMs !== 'no-timeout') {
          const timeout = timeoutMs;
          setTimeout(() => {
            stop();
            rej(
              new Error(
                `Expected output "${String(output)}" within ${(
                  timeout / 1000
                ).toFixed(2)}s was not generated, got:\n${stripAnsi(
                  combined.join('')
                )}`
              )
            );
          }, timeout);
        }

        out.pipe(stripAnsiTransform, { end: false });
        err.pipe(stripAnsiTransform, { end: false });
        stripAnsiTransform.pipe(search, { end: false });
      });
    };

    const writeInput = async (text: string, end?: boolean) => {
      if (!child.stdin) {
        throw new Error('There is no .stdin');
      }
      const { rethrow } = captureStackTrace();
      const stdin = child.stdin;
      stdin.setDefaultEncoding('utf-8');
      await new Promise<void>((res, rej) => {
        const flushed = stdin.write(text, (err) => {
          if (err) {
            rej(err);
          }
        });
        if (flushed) {
          res();
        } else {
          stdin.once('drain', () => {
            res();
          });
        }
      })
        .then(() => {
          if (end) {
            return new Promise<void>((res) => stdin.end(res));
          }
          return;
        })
        .catch(rethrow);
    };

    const waitForResult = async () => {
      const result = await resultPromise;
      return spawnResultConvert(result);
    };

    const nextSnapshot = () => {
      const result = stripAnsi(combined.join(''));
      combined.splice(0, combined.length);
      return result;
    };

    const readOutput = async (timeoutMs: number | 'no-timeout' = 500) => {
      if (!child.stdout || !child.stderr) {
        throw new Error('There is no .stdout');
      }
      if (combined.length > 0) {
        return nextSnapshot();
      }
      if (child.killed) {
        throw new Error('Process has already finished');
      }
      const stdout = child.stdout;
      const stderr = child.stderr;
      return await new Promise<string>((res, rej) => {
        const cleanup = () => {
          stdout.removeListener('data', onData);
          stdout.removeListener('error', onError);
          stdout.removeListener('end', onData);

          stderr.removeListener('data', onData);
          stderr.removeListener('error', onError);
          stderr.removeListener('end', onData);
        };

        const onData = () => {
          cleanup();
          res(nextSnapshot());
        };

        const onError = (err: unknown) => {
          cleanup();
          rej(err);
        };

        stdout.addListener('data', onData);
        stdout.addListener('error', onError);
        stdout.addListener('end', onData);

        stderr.addListener('data', onData);
        stderr.addListener('error', onError);
        stderr.addListener('end', onData);

        if (typeof timeoutMs === 'number') {
          setTimeout(() => {
            cleanup();
            rej(
              new Error(
                `Expected any output within ${(timeoutMs / 1000).toFixed(
                  2
                )}s was not generated`
              )
            );
          }, timeoutMs);
        }
      });
    };

    const kill = async (signal?: NodeJS.Signals) => {
      child.kill(signal);
      await waitForResult();
    };

    return {
      outputSnapshot: () => {
        return stripAnsi(combined.join(''));
      },
      readOutput,
      nextSnapshot,
      waitForOutput,
      writeInput,
      waitForResult,
      kill,
    };
  };

  return {
    spawnResult,
    spawnController,
    spawnBin: async (
      bin: string,
      args: string[],
      spawnOpts?: SpawnOptionsWithExtra<SpawnResultOpts>
    ) => {
      const path = join('./node_modules/.bin/', bin);
      return await spawnResult(path, args, spawnOpts);
    },
    spawnBinController: async (
      bin: string,
      args: string[],
      spawnOpts?: SpawnOptionsWithExtra<SpawnResultOpts>
    ) => {
      const path = join('./node_modules/.bin/', bin);
      return await spawnController(path, args, spawnOpts);
    },
  };
}
