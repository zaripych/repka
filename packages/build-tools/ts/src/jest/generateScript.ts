import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import fg from 'fast-glob';

import { moduleRootDirectory } from '../utils/moduleRootDirectory';

export async function generateScript(opts: {
  script: 'setup' | 'teardown';
  flavor: string;
  rootDir: string;
}) {
  const { flavor, script, rootDir } = opts;

  const stream = fg.stream(
    [`__${flavor}__/${script}.ts`, `src/__${flavor}__/${script}.ts`],
    {
      cwd: rootDir,
    }
  ) as AsyncIterable<string>;

  for await (const script of stream) {
    if (script) {
      const hash = createHash('sha1')
        .update(rootDir)
        .update(flavor)
        .update(script)
        .digest()
        .toString('hex');

      const dir = join(tmpdir(), 'jest-scripts');
      const file = join(dir, `${hash}.mjs`);

      await mkdir(dir, { recursive: true });

      const root = moduleRootDirectory();

      await writeFile(
        file,
        `import { runTsScript } from '${join(
          root,
          'configs/jest/jestConfigHelpers.gen.mjs'
        )}';

export default async () => {
  await runTsScript({
    location: '${resolve(join(rootDir, script))}'
  })
}`
      );

      return file;
    }
  }

  return undefined;
}
