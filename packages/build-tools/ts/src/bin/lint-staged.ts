import { spawnOutput, spawnWithOutputWhenFailed } from '../child-process';
import { spawnResult } from '../child-process/spawnResult';
import { runBin } from '../utils/runBin';

const lintStaged = async () => {
  await runBin('lint-staged');
};

const stashIncludeUntrackedKeepIndex = async () => {
  const split = (out: string) => out.split('\n').filter(Boolean);
  const [staged, modified, untracked] = await Promise.all([
    spawnOutput('git', 'diff --name-only --cached'.split(' ')).then(split),
    spawnOutput('git', 'diff --name-only'.split(' ')).then(split),
    spawnOutput(
      'git',
      'ls-files --others --exclude-standard --full-name'.split(' ')
    ).then(split),
  ]);
  const shouldStash =
    staged.length > 0 && (modified.length > 0 || untracked.length > 0);
  if (shouldStash) {
    await spawnWithOutputWhenFailed(
      'git',
      'commit --no-verify -m "lint-staged-temporary"'.split(' '),
      {
        exitCodes: [0],
      }
    );
    try {
      await spawnWithOutputWhenFailed(
        'git',
        'stash push -u --message lint-staged-temporary'.split(' '),
        {
          exitCodes: [0],
        }
      );
    } finally {
      // if stashing failed, reset anyway
      await spawnWithOutputWhenFailed('git', 'reset --soft HEAD~1'.split(' '), {
        exitCodes: [0],
      });
    }
  }
  return { staged, modified, untracked, didStash: shouldStash };
};

const applyStashed = async () => spawnResult('git', 'stash pop'.split(' '));

const run = async () => {
  const { didStash, staged } = await stashIncludeUntrackedKeepIndex();
  try {
    await lintStaged();
  } finally {
    if (didStash) {
      await applyStashed().then((result) => {
        if (result.error) {
          console.error(result.error);
        }
        if (result.status !== 0) {
          console.error(result.output.join(''));
          console.log(
            '\nTo at least restore list of staged files after resolution, try this: \n\n',
            `git reset && git add ${staged
              .map((file) => `'${file}'`)
              .join(' ')} \n\n`
          );
        }
        return Promise.resolve();
      });
    }
  }
};

await run();
