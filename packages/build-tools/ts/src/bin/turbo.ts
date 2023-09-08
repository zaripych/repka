#!/usr/bin/env tsx
import { relative } from 'node:path';

import { spawnToPromise } from '../child-process';
import {
  inheritTurboForceArgFromEnv,
  passTurboForceEnv,
  turboBinPath,
} from '../turbo';
import {
  cliArgsPipe,
  includesAnyOf,
  insertAfterAnyOf,
  setDefaultArgs,
  setScript,
} from '../utils/cliArgsPipe';
import { repositoryRootPath } from '../utils/repositoryRootPath';

const runTurbo = async () => {
  const root = await repositoryRootPath();
  await spawnToPromise(
    process.execPath,
    cliArgsPipe(
      [
        setScript(await turboBinPath()),
        setDefaultArgs(
          [`--filter`],
          ['./' + relative(root, process.cwd())],
          (args) =>
            root !== process.cwd() && includesAnyOf(args.inputArgs, ['run']),
          (args, state) => ({
            ...state,
            inputArgs: insertAfterAnyOf(state.inputArgs, args, ['run']),
          })
        ),
        inheritTurboForceArgFromEnv(),
      ],
      process.argv.slice(2)
    ),
    {
      cwd: root,
      stdio: 'inherit',
      exitCodes: 'inherit',
      env: {
        ...process.env,
        ...passTurboForceEnv(process.argv),
      },
    }
  );
};

await runTurbo();
