#!/usr/bin/env tsx
import { spawn } from 'node:child_process';

import { binPath } from '../utils/binPath';

const onError = (err: unknown) => {
  console.error(err);
  process.exitCode = 1;
};

binPath({
  binName: 'prettier',
  binScriptPath: 'prettier/bin/prettier.cjs',
}).then((result) => {
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
