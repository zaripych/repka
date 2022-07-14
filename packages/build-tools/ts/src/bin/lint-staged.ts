import { spawnOutput, spawnOutputConditional } from '../child-process';
import { spawnResult } from '../child-process/spawnResult';
import { runBin } from '../utils/runBin';
import { taskArgsPipe } from '../utils/taskArgsPipe';

const lintStaged = async () => {
  await runBin('lint-staged', taskArgsPipe([]), {
    // this is the command we wrap
    exitCodes: 'inherit',
  });
};

const stashIncludeUntrackedKeepIndex = async () => {
  const split = (out: string) => out.split('\n').filter(Boolean);
  const [staged, modified, untracked] = await Promise.all([
    spawnOutput('git', 'diff --name-only --cached'.split(' '), {
      // fail if non-zero
      exitCodes: [0],
    }).then(split),
    spawnOutput('git', 'diff --name-only'.split(' '), {
      // fail if non-zero
      exitCodes: [0],
    }).then(split),
    spawnOutput(
      'git',
      'ls-files --others --exclude-standard --full-name'.split(' '),
      {
        // fail if non-zero
        exitCodes: [0],
      }
    ).then(split),
  ]);
  const shouldStash =
    staged.length > 0 && (modified.length > 0 || untracked.length > 0);
  if (shouldStash) {
    await spawnOutputConditional(
      'git',
      'commit --no-verify -m "lint-staged-temporary"'.split(' '),
      {
        exitCodes: [0],
      }
    );
    try {
      await spawnOutputConditional(
        'git',
        'stash push -u --message lint-staged-temporary'.split(' '),
        {
          exitCodes: [0],
        }
      );
    } finally {
      // if stashing failed, reset anyway
      await spawnOutputConditional('git', 'reset --soft HEAD~1'.split(' '), {
        exitCodes: [0],
      });
    }
  }
  return { staged, modified, untracked, didStash: shouldStash };
};

const applyStashed = async () =>
  spawnResult('git', 'stash pop'.split(' '), {
    // we handle the status later in the code
    exitCodes: [0],
  });

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
