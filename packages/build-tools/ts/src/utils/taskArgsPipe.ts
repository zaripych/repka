import type { CliArgsTransform } from './cliArgsPipe';
import { removeInputArgs } from './cliArgsPipe';
import { cliArgsPipe } from './cliArgsPipe';

export function taskArgsPipe(
  transforms: CliArgsTransform[],
  inputArgs: string[] = process.argv.slice(2)
) {
  return cliArgsPipe(
    [
      // remove --log-level as that is consumed by our logger
      removeInputArgs(['--log-level'], { numValues: 1 }),
      ...transforms,
    ],
    inputArgs
  );
}
