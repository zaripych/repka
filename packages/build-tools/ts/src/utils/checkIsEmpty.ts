import fg from 'fast-glob';

export async function checkIsEmpty(root?: string) {
  const glob = '**/*.(ts|tsx)';
  const search = fg.stream(glob, {
    cwd: root,
    ignore: [`**/node_modules`, `node_modules`],
  });
  for await (const entry of search) {
    if (entry) {
      // early return will destroy the stream via async iterator
      return false;
    }
  }
  return true;
}
