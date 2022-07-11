import { relative } from 'node:path';

import {
  cliArgsPipe,
  includesAnyOf,
  insertAfterAnyOf,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { monorepoRootPath } from '../utils/monorepoRootPath';
import { runBin } from '../utils/runBin';

const runTurbo = async () => {
  const root = await monorepoRootPath();
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
      ],
      process.argv.slice(2)
    ),
    {
      cwd: root,
    }
  );
};

await runTurbo();
