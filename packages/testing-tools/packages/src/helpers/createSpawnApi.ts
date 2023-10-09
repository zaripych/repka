import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Transform } from 'node:stream';

import type {
  SpawnOptionsWithExtra,
  SpawnResultOpts,
  SpawnResultReturn,
} from '@utils/child-process';
import { spawnResult as spawnResultCore } from '@utils/child-process';
import { captureStackTrace, escapeRegExp } from '@utils/ts';

import { searchAndReplaceTextTransform } from './replaceTextInFiles';
import { stripAnsi } from './stripAnsi';

export type SpawnTestApi = ReturnType<typeof createTestSpawnApi>;

export type SpawnController = Awaited<
  ReturnType<SpawnTestApi['spawnController']>
>;

export function createTestSpawnApi(
  opts: () => Promise<{
    cwd: string;
    packageInstallSource: string;
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
    spawnOpts?: SpawnOptionsWithExtra<Partial<SpawnResultOpts>>
  ) => {
    const { cwd, env } = await opts();

    const result = await spawnResultCore(executable, args, {
      shell: process.platform === 'win32',
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
    spawnOpts?: SpawnOptionsWithExtra<Partial<SpawnResultOpts>> & {
      searchAndReplace?: Parameters<typeof searchAndReplaceTextTransform>[0];
    }
  ) => {
    const { cwd, env } = await opts();

    const activeOpts = {
      shell: process.platform === 'win32',
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

    const stripAnsiTransform = new Transform({
      transform(this, chunk: Buffer, _, callback) {
        this.push(stripAnsi(chunk.toString('utf8')));
        callback();
      },
    });

    const combined: string[] = [];

    const collectOutput = (data: Buffer | string) => {
      combined.push(data instanceof Buffer ? data.toString('utf8') : data);
    };

    const userReplace = spawnOpts?.searchAndReplace
      ? searchAndReplaceTextTransform(spawnOpts.searchAndReplace)
      : undefined;

    const subscribe = () => {
      const out = child.stdout;
      const err = child.stderr;

      if (!out && !err) {
        return {
          combinedOutput: undefined,
          unsubscribe: () => {},
        };
      }

      if (out) {
        out.pipe(stripAnsiTransform, { end: false });
      }
      if (err) {
        err.pipe(stripAnsiTransform, { end: false });
      }
      if (userReplace) {
        stripAnsiTransform.pipe(userReplace, { end: false });
      }

      const combinedOutput = userReplace ? userReplace : stripAnsiTransform;

      combinedOutput.on('data', collectOutput);
      combinedOutput.on('error', (err) => {
        console.log(err);
      });

      const unpause = () => {
        if (out) {
          if (out.isPaused()) {
            out.resume();
          }
        }

        if (err) {
          if (err.isPaused()) {
            err.resume();
          }
        }

        if (combinedOutput.isPaused()) {
          combinedOutput.resume();
        }
      };

      return {
        combinedOutput,
        unpause,
        unsubscribe: () => {
          combinedOutput.off('data', collectOutput);

          if (userReplace) {
            stripAnsiTransform.unpipe(userReplace);
          }

          if (out) {
            out.unpipe(stripAnsiTransform);
          }

          if (err) {
            err.unpipe(stripAnsiTransform);
          }

          unpause();
        },
      };
    };

    const { unsubscribe, unpause, combinedOutput } = subscribe();

    const resultPromise = spawnResultCore(child, {
      exitCodes: 'any',
      ...activeOpts,
      output: [],
    });

    const waitForResult = async () => {
      try {
        const result = await resultPromise;
        return {
          ...spawnResultConvert(result),
          output: combined.join(''),
        };
      } finally {
        unsubscribe();
      }
    };

    const waitForOutput = async (
      output: string | RegExp,
      timeoutMs: number | 'no-timeout' = 500
    ) => {
      if (!combinedOutput) {
        throw new Error('There is no .stdout or .stderr');
      }

      return new Promise<void>((res, rej) => {
        let timer: NodeJS.Timeout | undefined;
        const stop = () => {
          combinedOutput.unpipe(search);
          unpause();
          if (timer) {
            clearTimeout(timer);
            timer = undefined;
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
                  )}" was not generated, got:\n${combined.join('')}`
                )
              );
            } else {
              res();
            }
          },
        });

        if (timeoutMs !== 'no-timeout') {
          const timeout = timeoutMs;
          timer = setTimeout(() => {
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

        combinedOutput.pipe(search, { end: false });
        unpause();
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

    const nextSnapshot = () => {
      const result = combined.join('');
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
        let timer: NodeJS.Timeout | undefined;

        const cleanup = () => {
          stdout.removeListener('data', onData);
          stdout.removeListener('error', onError);
          stdout.removeListener('end', onData);

          stderr.removeListener('data', onData);
          stderr.removeListener('error', onError);
          stderr.removeListener('end', onData);

          if (timer) {
            clearTimeout(timer);
            timer = undefined;
          }
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
          timer = setTimeout(() => {
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
        return combined.join('');
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
      spawnOpts?: SpawnOptionsWithExtra<Partial<SpawnResultOpts>>
    ) => {
      const path = join('./node_modules/.bin/', bin);
      return await spawnResult(path, args, spawnOpts);
    },
    spawnBinController: async (
      bin: string,
      args: string[],
      spawnOpts?: SpawnOptionsWithExtra<Partial<SpawnResultOpts>> & {
        searchAndReplace?: Parameters<typeof searchAndReplaceTextTransform>[0];
      }
    ) => {
      const path = join('./node_modules/.bin/', bin);
      return await spawnController(path, args, spawnOpts);
    },
    spawnBinControllerFromPackageInstallSource: async (
      bin: string,
      args: string[],
      spawnOpts?: SpawnOptionsWithExtra<Partial<SpawnResultOpts>> & {
        searchAndReplace?: Parameters<typeof searchAndReplaceTextTransform>[0];
      }
    ) => {
      const { packageInstallSource } = await opts();
      return await spawnController(
        'npx',
        ['--package', packageInstallSource, '-y', '--', bin].concat(args),
        spawnOpts
      );
    },
  };
}
