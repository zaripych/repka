import { stat } from 'fs/promises';

export async function hasGit() {
  return await stat('.git')
    .then((entry) => entry.isDirectory())
    .catch(() => false);
}
