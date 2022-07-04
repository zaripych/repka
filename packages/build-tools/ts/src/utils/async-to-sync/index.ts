import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { randomText } from '../randomText';

/**
 * Top level hackery which allows us to use async functions where only sync
 * code would have been allowed due to framework limitations (e.g. eslint and
 * sync JS configs).
 *
 * This works via `spawnSync`, loading a module dynamically in a separate process,
 * serializing input via env var and output via stdout.
 *
 * NOTE: There might be a limit on env var value sizes - tread carefully
 *
 * @param module Module to load dynamically in the spawned process
 * @param fn A named function to execute that should be exported in the module
 * @param args Arguments to pass to the function, should be JSON serializable
 * @returns Result returned by the function, should be JSON serializable
 */
export function asyncToSync<T>(module: string, fn: string, args: unknown[]) {
  const key = randomText(8);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), key],
    {
      stdio: 'pipe',
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        [key]: JSON.stringify({
          module: fileURLToPath(module),
          fn,
          args,
        }),
      },
    }
  );
  if (result.status !== 0) {
    throw new Error(`${fn} failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim()) as unknown as T;
}

const passedKey = process.argv[2];
const serializedConfig = passedKey && process.env[passedKey];

if (passedKey && serializedConfig) {
  const noop = () => {
    return;
  };
  console.log = noop.bind(console);
  console.error = noop.bind(console);
  const config = JSON.parse(serializedConfig) as {
    module: string;
    fn: string;
    args: unknown[];
  };
  import(config.module)
    .then(async (result: Record<string, (...args: unknown[]) => unknown>) => {
      const fn = result[config.fn];
      if (!fn) {
        throw new Error(`${config.fn} not found in ${config.module}`);
      }
      const data = await Promise.resolve(fn(...config.args));
      process.stdout.setEncoding('utf-8');
      process.stdout.write(JSON.stringify(data));
      process.exitCode = 0;
    })
    .catch((err) => {
      process.stderr.setEncoding('utf-8');
      process.stderr.write(String(err));
      process.exitCode = 1;
    });
}
