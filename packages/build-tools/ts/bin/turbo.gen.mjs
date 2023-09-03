#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const isFile = async (file) => {
  return await stat(file)
    .then((result) => result.isFile())
    .catch(() => false);
};

async function* iterateNodeModules(startWith, path) {
  let current = startWith;
  while (current !== sep && current !== '~/') {
    const candidate = join(current, 'node_modules', path);
    if (await isFile(candidate)) {
      yield candidate;
    }
    if (current === dirname(current)) {
      break;
    }
    current = dirname(current);
  }
}

async function findBinScript(startWith, binScriptPath) {
  for await (const path of iterateNodeModules(startWith, binScriptPath)) {
    return path;
  }
  return undefined;
}

async function binPath(binName, binScriptPath) {
  const useShortcut = process.platform !== 'win32';
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (useShortcut) {
    const bestGuess = join(root, 'node_modules', '.bin', binName);
    if (await isFile(bestGuess)) {
      return bestGuess;
    }
  }
  const result = await findBinScript(root, binScriptPath);
  if (result) {
    return result;
  }
  throw new Error(`Cannot find bin ${binName}`);
}

const onError = (err) => {
  console.error(err);
  process.exitCode = 1;
};

binPath('tsx', 'tsx/dist/cli.js').then((result) => {
  const cp = spawn(
    process.execPath,
    [
      result,
      fileURLToPath(new URL('../src/bin/turbo.ts', import.meta.url)),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' }
  );
  cp.on('error', onError);
  cp.on('close', (code, signal) => {
    if (typeof code === 'number') {
      process.exitCode = code;
    } else if (typeof signal === 'string') {
      console.error('Failed to start', 'turbo', signal);
    }
  });
}, onError);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHVyYm8uZ2VuLm1qcyIsInNvdXJjZXMiOltdLCJzb3VyY2VzQ29udGVudCI6W10sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7In0=
