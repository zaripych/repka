import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function emptyDir(dir: string) {
  let items;
  try {
    items = await readdir(dir);
  } catch {
    return mkdir(dir, { recursive: true });
  }

  return Promise.all(
    items.map((item) => rm(join(dir, item), { recursive: true }))
  );
}
