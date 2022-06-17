import { spawn } from 'child_process';
import { appendFile, rm, unlink } from 'fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'os';

import { spawnOutput } from '../child-process';
import { copyFiles } from '../file-system/copyFiles';
import { randomText } from '../utils/randomText';
import { runBin } from './runBin';

const saveUntracked = async () => {
  const output = await spawnOutput(
    spawn('git', 'ls-files --others --exclude-standard --full-name'.split(' '))
  );
  const files = output.split('\n').filter(Boolean);
  const id = randomText(8);
  const root = join(tmpdir(), 'lint-staged-backup');
  const backupPath = join(root, id);
  await copyFiles({
    files,
    destination: backupPath,
  });
  await appendFile(join(root, 'history.txt'), 'added ' + id + '\n', {
    encoding: 'utf-8',
  });
  await Promise.all(files.map((file) => unlink(file)));
  return {
    restoreUntracked: async () => {
      try {
        await copyFiles({
          source: backupPath,
          files,
          destination: process.cwd(),
        });
        await rm(backupPath, {
          recursive: true,
        });
        await appendFile(join(root, 'history.txt'), 'cleaned ' + id + '\n', {
          encoding: 'utf-8',
        });
      } catch (err) {
        console.log(
          'Failed to restore from backup',
          backupPath,
          `Try running "cp -r ${backupPath} ." to restore manually?`
        );
        throw err;
      }
    },
  };
};

const lintStaged = async () => {
  await runBin('lint-staged');
};

const run = async () => {
  const { restoreUntracked } = await saveUntracked();
  try {
    await lintStaged();
  } finally {
    await restoreUntracked();
  }
};

await run();
