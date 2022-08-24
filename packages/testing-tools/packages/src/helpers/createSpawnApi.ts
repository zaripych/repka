import type {
  SpawnOptionsWithExtra,
  SpawnResultOpts,
  SpawnResultReturn,
} from '@build-tools/ts';
import { spawnResult as spawnResultCore } from '@build-tools/ts';
import { escapeRegExp } from '@utils/ts';
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

    const stripAnsiTransform = new Transform({
      transform(this, chunk: Buffer, _, callback) {
        this.push(stripAnsi(chunk.toString('utf8')));
        callback();
      },
    });

    const waitForOutput = async (
      output: string | RegExp,
      timeoutMs: number | 'no-timeout' = 500
    ) => {
      if (!child.stdout) {
        throw new Error('There is no .stdout');
      }
      const out = child.stdout;

      return new Promise<void>((res, rej) => {
        const stop = () => {
          out.unpipe(stripAnsiTransform);
          stripAnsiTransform.unpipe(search);
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
        stripAnsiTransform.pipe(search, { end: false });
      });
    };

    const writeInput = async (text: string, end?: boolean) => {
      if (!child.stdin) {
        throw new Error('There is no .stdin');
      }
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
      }).then(() => {
        if (end) {
          return new Promise<void>((res) => stdin.end(res));
        }
        return;
      });
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
      if (!child.stdout) {
        throw new Error('There is no .stdout');
      }
      const out = child.stdout;
      if (combined.length > 0) {
        return nextSnapshot();
      }
      if (child.killed) {
        throw new Error('Process has already finished');
      }
      return await new Promise<string>((res, rej) => {
        const cleanup = () => {
          out.removeListener('data', onData);
          out.removeListener('error', onError);
          out.removeListener('end', onData);
        };

        const onData = () => {
          cleanup();
          res(nextSnapshot());
        };
        const onError = (err: unknown) => {
          cleanup();
          rej(err);
        };

        out.addListener('data', onData);
        out.addListener('error', onError);
        out.addListener('end', onData);

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
