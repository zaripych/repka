import {
  spawnOutput,
  spawnOutputConditional,
  spawnToPromise,
} from '../child-process';
import { spawnResult } from '../child-process/spawnResult';
import { logger } from '../logger/logger';
import { binPath } from '../utils/binPath';
import {
  cliArgsPipe,
  includesAnyOf,
  removeLogLevelOption,
} from '../utils/cliArgsPipe';

const lintStaged = async () => {
  await spawnToPromise(
    await binPath({
      binName: 'lint-staged',
      binScriptPath: 'lint-staged/bin/lint-staged.js',
    }),
    cliArgsPipe([removeLogLevelOption()], process.argv.slice(2)),
    {
      stdio: 'inherit',
      exitCodes: 'inherit',
    }
  );
};

const stashIncludeUntrackedKeepIndex = async () => {
  const isHelpMode = includesAnyOf(process.argv, ['--help', '-h']);
  const split = (out: string) => out.split('\n').filter(Boolean);
  const listStaged = () =>
    spawnOutput('git', 'diff --name-only --cached'.split(' '), {
      // fail if non-zero
      exitCodes: [0],
    }).then(split);
  const listModified = () =>
    spawnOutput('git', 'diff --name-only'.split(' '), {
      // fail if non-zero
      exitCodes: [0],
    }).then(split);
  const listUntracked = () =>
    spawnOutput(
      'git',
      'ls-files --others --exclude-standard --full-name'.split(' '),
      {
        // fail if non-zero
        exitCodes: [0],
      }
    ).then(split);
  const listStashContents = () =>
    spawnOutput('git', 'stash show stash@{0} --name-only'.split(' '), {
      exitCodes: [0],
    }).then(split);
  const [staged, modified, untracked] = await Promise.all([
    listStaged(),
    listModified(),
    listUntracked(),
  ]);
  if (logger.logLevel === 'debug') {
    logger.debug({
      staged,
      modified,
      untracked,
    });
  }
  const shouldStash =
    !isHelpMode &&
    staged.length > 0 &&
    (modified.length > 0 || untracked.length > 0);
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
      await new Promise((res) => setTimeout(res, 1000));
      // --
      // Weird edge cases when stashing sometimes doesn't fully clean the repository
      // and leaves a couple of files in a modified state, this would lead to conflicts
      // when popping.
      // To workaround the issue we double check that those modified leftovers are in the
      // stash and if so - just do git reset --hard
      const [modifiedAfterStashing, stashedContents] = await Promise.all([
        listModified(),
        listStashContents(),
      ]);
      if (logger.logLevel === 'debug') {
        logger.debug({
          modifiedAfterStashing,
          stashedContents,
        });
      }
      if (
        modifiedAfterStashing.length > 0 &&
        modifiedAfterStashing.every((file) => stashedContents.includes(file))
      ) {
        await spawnOutputConditional('git', 'reset --hard'.split(' '), {
          exitCodes: [0],
        });
      } else if (modifiedAfterStashing.length > 0) {
        console.error(
          'WARNING: Found modified files after stashing, this might lead to conflicts'
        );
        console.error(modifiedAfterStashing.join('\n'));
      }
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
      const statusResult = await spawnOutput('git', ['status'], {
        exitCodes: 'any',
      });
      await applyStashed().then((result) => {
        if (result.error) {
          console.error('git status before error:');
          console.error(statusResult);
          console.error(result.error.message);
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
