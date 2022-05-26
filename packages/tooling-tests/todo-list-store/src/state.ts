import { readFile, writeFile } from 'node:fs/promises';

import type { TodoEntry } from './entry';

export const entries: TodoEntry[] = [];

let totalEntries = -1;

export const isEntryId = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }
  const num = Number.parseInt(value);
  return Number.isFinite(num) && Number.isSafeInteger(num);
};

export const generateEntryId = () => {
  return (totalEntries += 1).toFixed(0);
};

export async function load() {
  const loaded = await readFile('./todo-list.json', {
    encoding: 'utf-8',
  })
    .then((data) => JSON.parse(data) as Array<TodoEntry>)
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        return Promise.resolve([] as Array<TodoEntry>);
      }
      return Promise.reject(err);
    });
  entries.splice(0, entries.length, ...loaded);
  totalEntries = loaded.reduce(
    (max, entry) => Math.max(max, Number.parseInt(entry.entryId)),
    0
  );
  return entries;
}

export async function save() {
  await writeFile('./todo-list.json', JSON.stringify(entries), {
    encoding: 'utf-8',
  });
}
