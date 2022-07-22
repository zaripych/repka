import { relative } from 'node:path';

import { inheritTurboForceArgFromEnv, passTurboForceEnv } from '../turbo';
import {
  cliArgsPipe,
  includesAnyOf,
  insertAfterAnyOf,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { repositoryRootPath } from '../utils/repositoryRootPath';
import { runBin } from '../utils/runBin';

const runTurbo = async () => {
  const root = await repositoryRootPath();
  await runBin(
    'turbo',
    cliArgsPipe(
      [
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
      exitCodes: 'inherit',
      env: {
        ...process.env,
        ...passTurboForceEnv(process.argv),
      },
    }
  );
};

await runTurbo();
