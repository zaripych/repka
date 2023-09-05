import { spawnToPromise } from '../../../child-process/index';
import { binPath } from '../../../utils/binPath';

export const prettierPath = () =>
  binPath({
    binName: 'prettier',
    binScriptPath: 'prettier/bin-prettier.js',
  });

export async function prettierWrite(paths: string[]) {
  return spawnToPromise(
    process.execPath,
    [await prettierPath(), '--write', ...paths],
    {
      exitCodes: [0],
    }
  );
}
