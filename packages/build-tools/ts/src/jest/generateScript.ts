import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

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

  for await (const scriptLoc of stream) {
    if (scriptLoc) {
      const root = moduleRootDirectory();
      const location = resolve(join(rootDir, scriptLoc));

      const modulePath = (input: string) =>
        process.platform === 'win32'
          ? `file://${input.replaceAll(sep, '/')}`
          : input;

      const script = `import { runTsScript } from ${JSON.stringify(
        modulePath(join(root, 'configs/jest/jestConfigHelpers.gen.mjs'))
      )};

export default async () => {
await runTsScript({
  location: ${JSON.stringify(location)}
})
}`;

      const hash = createHash('sha1')
        .update(rootDir)
        .update(flavor)
        .update(script)
        .digest()
        .toString('hex');

      const dir = join(tmpdir(), 'jest-scripts');
      const file = join(dir, `${hash}.mjs`);

      await mkdir(dir, { recursive: true });

      await writeFile(file, script);

      return file;
    }
  }

  return undefined;
}
