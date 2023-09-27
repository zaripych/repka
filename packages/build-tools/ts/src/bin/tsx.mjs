#!/usr/bin/env node
/**
 * @note This file cannot use `tsx` to execute "itself", because
 * that would lead to an infinite loop. So we have to use `node`
 * and pure JS here.
 */
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
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
  const root = fileURLToPath(new URL('../', import.meta.url));
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

binPath('tsx', 'tsx/dist/cli.mjs').then((result) => {
  const cp = spawn(process.execPath, [result, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  cp.on('error', onError);
  cp.on('close', (code, signal) => {
    if (typeof code === 'number') {
      process.exitCode = code;
    } else if (typeof signal === 'string') {
      console.error('Failed to start', result, signal);
    }
  });
}, onError);
