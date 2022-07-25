import { runBin } from '../../utils/runBin';

export async function prettierWrite(path: string) {
  return runBin('prettier', ['--write', path], {
    exitCodes: [0],
  });
}
