import fg from 'fast-glob';
import { dirname } from 'node:path';

import { readPackageJson, writePackageJson } from './writePackageJson';

export async function transformPackageJsonInWorkspace(opts: {
  directory: string;
  exclude?: string[];
  packageJson: (
    entries: Record<string, unknown>,
    path: string
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}) {
  const packageJsonFiles = fg.stream('**/package.json', {
    cwd: opts.directory,
    absolute: true,
    ignore: opts.exclude || ['node_modules', '**/node_modules'],
  }) as AsyncIterable<string>;

  for await (const filePath of packageJsonFiles) {
    const json = await readPackageJson(dirname(filePath));
    const initial = JSON.stringify(json);
    const result = await opts.packageJson(json, filePath);

    if (initial !== JSON.stringify(result)) {
      await writePackageJson(dirname(filePath), result);
    }
  }
}
