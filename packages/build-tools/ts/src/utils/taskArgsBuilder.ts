import { processArgsBuilder } from './processArgsBuilder';

export function taskArgsBuilder(processArgs = process.argv.slice(2)) {
  return processArgsBuilder(processArgs).removeArgs(['--verbosity'], {
    numValues: 1,
  });
}
