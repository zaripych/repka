import type {
  SpawnOptionsWithExtra,
  SpawnResultOpts,
  SpawnResultReturn,
} from '@build-tools/ts';
import { spawnResult as spawnResultCore } from '@build-tools/ts';
import { escapeRegExp } from '@utils/ts';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

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

    const waitForOutput = async (output: string | RegExp) => {
      if (!child.stdout) {
        throw new Error('There is no .stdout');
      }
      const out = child.stdout;
      out.setEncoding('utf-8');
      await new Promise<void>((res, rej) => {
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
            out.unpipe(search);
            search.destroy();
            if (event.event === 'match') {
              res();
            } else {
              rej(
                new Error(
                  `Expected output "${String(
                    output
                  )}" was not generated, got:\n${stripAnsi(combined.join(''))}`
                )
              );
            }
          },
        });
        out.pipe(search);
      });
    };

    const writeInput = async (text: string, end?: boolean) => {
      if (!child.stdin) {
        throw new Error('There is no .stdin');
      }
      const stdin = child.stdin;
      stdin.setDefaultEncoding('utf-8');
      await new Promise<void>((res, rej) => {
        stdin.write(text, (err) => {
          if (err) {
            rej(err);
          } else {
            res();
          }
        });
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

    const kill = async (signal?: NodeJS.Signals) => {
      child.kill(signal);
      await waitForResult();
    };

    return {
      outputSnapshot: () => {
        return stripAnsi(combined.join(''));
      },
      nextSnapshot: () => {
        const result = stripAnsi(combined.join(''));
        combined.splice(0, combined.length);
        return result;
      },
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
