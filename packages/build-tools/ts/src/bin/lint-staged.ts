import { spawn } from 'child_process';
import { appendFile, rm } from 'fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'os';

import { spawnOutput } from '../child-process';
import { copyFiles } from '../file-system/copyFiles';
import { randomText } from '../utils/randomText';
import { runBin } from './runBin';

const getDeps = (dryRun: boolean) => {
  const deps = {
    copyFiles,
    appendFile,
    rm,
  };
  const dryRunDeps = {
    copyFiles: async (...[opts]: Parameters<typeof copyFiles>) => {
      await copyFiles({
        ...opts,
        options: {
          ...opts.options,
          dryRun: true,
        },
      });
    },
    appendFile: async (...[filePath, data]: Parameters<typeof appendFile>) => {
      console.log('appendFile', {
        filePath,
        data,
      });
      return Promise.resolve();
    },
    rm: async (...[path]: Parameters<typeof rm>) => {
      console.log('rm', {
        path,
      });
      return Promise.resolve();
    },
  };
  return dryRun ? dryRunDeps : deps;
};

const saveUntracked = async () => {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('Running in DRY RUN mode');
  }

  const output = await spawnOutput(
    spawn('git', 'ls-files --others --exclude-standard --full-name'.split(' '))
  );
  const files = output.split('\n').filter(Boolean);
  const id = randomText(8);
  const root = join(tmpdir(), 'lint-staged-backup');
  const backupPath = join(root, id);

  const deps = getDeps(dryRun);

  const restoreUntracked = async () => {
    if (files.length === 0) {
      return;
    }
    try {
      await deps.copyFiles({
        source: backupPath,
        files,
        destination: process.cwd(),
      });
      await deps.appendFile(join(root, 'history.txt'), 'copied ' + id + '\n', {
        encoding: 'utf-8',
      });
      await deps.rm(backupPath, {
        recursive: true,
      });
      await deps.appendFile(join(root, 'history.txt'), 'cleaned ' + id + '\n', {
        encoding: 'utf-8',
      });
    } catch (err) {
      console.log(
        'Failed to restore from backup',
        backupPath,
        `Try running "rsync -r ${backupPath} ." to restore manually?`
      );
      throw err;
    }
  };

  try {
    if (files.length > 0) {
      await deps.copyFiles({
        files,
        destination: backupPath,
      });
      await deps.appendFile(join(root, 'history.txt'), 'added ' + id + '\n', {
        encoding: 'utf-8',
      });
      await Promise.all(
        files.map((file) => deps.rm(file, { recursive: true }))
      );
    }
  } catch (err) {
    console.log(
      'Failed to cleanup',
      {
        files,
      },
      `Try running "rsync -r ${backupPath} ." to restore them?`
    );
    await restoreUntracked();
    throw err;
  }

  return {
    restoreUntracked,
  };
};

const lintStaged = async () => {
  await runBin(
    'lint-staged',
    process.argv.slice(2).filter((arg) => arg !== '--dry-run')
  );
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
