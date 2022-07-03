import { relative } from 'node:path';

import {
  includesAnyOf,
  insertAfterAnyOf,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { monorepoRootPath } from '../utils/monorepoRootPath';
import { taskArgsPipe } from '../utils/taskArgsPipe';
import { runBin } from './runBin';

const runTurbo = async () => {
  const root = await monorepoRootPath();
  await runBin(
    'turbo',
    taskArgsPipe([
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
    ]),
    {
      cwd: root,
    }
  );
};

await runTurbo();
