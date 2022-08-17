import { stat } from 'node:fs/promises';

export async function isDirectory(path: string) {
  return stat(path)
    .then((result) => result.isDirectory())
    .catch(() => undefined);
}
