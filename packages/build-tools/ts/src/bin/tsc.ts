import { spawnToPromise } from '../child-process';
import { tscPath } from '../tsc/tsc';
import { cliArgsPipe, removeLogLevelOption } from '../utils/cliArgsPipe';

const tsc = async () => {
  await spawnToPromise(
    await tscPath(),
    cliArgsPipe([removeLogLevelOption()], process.argv.slice(2)),
    {
      stdio: 'inherit',
      exitCodes: 'inherit',
    }
  );
};

await tsc();
