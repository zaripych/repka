import { spawnOutputConditional } from '../child-process';

export async function hasUntrackedChanges() {
  const result = await spawnOutputConditional(
    'git',
    ['ls-files', '--other', '--directory', '--exclude-standard'],
    {
      exitCodes: [0],
    }
  );
  console.log(result);
  return result.stdout.trim().length > 0;
}
