import { spawnOutput, spawnToPromise } from '../child-process';
import { runBin } from './runBin';

const lintStaged = async () => {
  await runBin(
    'lint-staged',
    process.argv.slice(2).filter((arg) => arg !== '--dry-run')
  );
};

const stashIncludeUntrackedKeepIndex = async () => {
  const stagedOut = await spawnOutput(
    'git',
    'diff --name-only --cached'.split(' ')
  );
  const staged = new Set(stagedOut.split('\n').filter(Boolean));
  await spawnToPromise(
    'git',
    'commit --quiet --no-verify -m "lint-staged-temporary"'.split(' '),
    {
      exitCodes: [0],
    }
  );
  await spawnToPromise('git', 'stash -u'.split(' '), {
    exitCodes: [0],
  });
  await spawnToPromise('git', 'reset --quiet --soft HEAD~1'.split(' '), {
    exitCodes: [0],
  });
  return [...staged];
};

const applyStashed = async () => {
  await spawnToPromise('git', 'stash pop'.split(' '), {
    exitCodes: [0],
    stdio: 'inherit',
  });
};

const run = async () => {
  const staged = await stashIncludeUntrackedKeepIndex();
  try {
    await lintStaged();
  } finally {
    await applyStashed().catch((err) => {
      console.error(err);
      console.log(
        'To at least restore list of staged files after resolution, try this: \n\n',
        `git reset && git add ${staged
          .map((file) => `'${file}'`)
          .join(' ')} \n\n`
      );
      return Promise.resolve();
    });
  }
};

await run();
