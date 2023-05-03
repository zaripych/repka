import { writeFile } from 'node:fs/promises';

import { join } from 'path';

export async function writePnpmWorkspaceYaml(directory: string) {
  await writeFile(
    join(directory, 'pnpm-workspace.yaml'),
    `packages:
  - '*'
`,
    {
      encoding: 'utf-8',
    }
  );
}
