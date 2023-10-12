#!/usr/bin/env tsx
import { spawnOutputConditional, spawnToPromise } from '@utils/child-process';
import { line } from '@utils/text';

async function run() {
  const dryRun = !process.argv.includes('--no-dry-run');

  const spawn = async (command: string, args: string[]) => {
    return await spawnOutputConditional(command, args, {
      stdio: 'pipe',
      exitCodes: [0],
    });
  };

  await spawn('git', ['add', '.']);

  console.log(`creating a git stash with changes:\n`);

  const stashResult = await spawn('git', ['stash', '-k', '-u', '-m', 'backup']);
  try {
    await spawnOutputConditional(
      'pnpm',
      ['changeset', 'version', '--snapshot', 'snap'],
      {
        stdio: 'pipe',
        exitCodes: [0],
        env: {
          ...process.env,
          CHANGESETS_VERSION: '1',
        },
      }
    );

    console.log(`git status before publish:\n`);

    await spawnToPromise('git', ['status'], {
      stdio: 'inherit',
      exitCodes: [0],
    });

    console.log();

    await spawnToPromise(
      'git',
      ['--no-pager', 'diff', '--', '**/CHANGELOG.md'],
      {
        stdio: 'inherit',
        exitCodes: [0],
      }
    );

    console.log();

    console.log(`building...\n`);

    await spawn('pnpm', ['-r', '/build:tools|declarations/']);

    console.log(`publishing ... ${dryRun ? '(dry-run)' : ''}\n`);

    await spawnToPromise(
      'pnpm',
      [
        'publish',
        '-r',
        '--tag',
        'snap',
        '--access',
        'public',
        '--no-git-checks',
        dryRun ? '--dry-run' : '',
      ],
      {
        stdio: 'inherit',
        exitCodes: [0],
      }
    );

    if (dryRun) {
      console.log();
      console.log(
        line`
          successfully published in dry-run mode, pass --no-dry-run to
          publish for real
        `
      );
      console.log();
    }
  } finally {
    await spawn('git', ['reset', '--hard']);
    if (!stashResult.stdout.includes('No local changes to save')) {
      await spawn('git', ['stash', 'pop']);
    }
  }
}

run().catch((err) => {
  console.error(err);
});
