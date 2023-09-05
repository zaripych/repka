import { spawnToPromise } from '../child-process';
import { tscPath } from '../tsc/tsc';
import {
  cliArgsPipe,
  removeLogLevelOption,
  setScript,
} from '../utils/cliArgsPipe';

const tsc = async () => {
  await spawnToPromise(
    process.execPath,
    cliArgsPipe(
      [setScript(await tscPath()), removeLogLevelOption()],
      process.argv.slice(2)
    ),
    {
      stdio: 'inherit',
      exitCodes: 'inherit',
    }
  );
};

await tsc();
