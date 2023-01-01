import { dump } from 'js-yaml';
import { join } from 'path';

import { taskFactory } from './core/definition';

export const pnpmWorkspaceYaml = taskFactory(
  (opts?: { directory?: string; packagesGlobs?: string[] }) => {
    const directory = opts?.directory ?? process.cwd();
    const packageGlobs = opts?.packagesGlobs ?? [];
    return {
      name: 'pnpm-workspace.yaml',
      description: `Create pnpm-workspace.yaml`,

      async execute({ writeFile }) {
        if (packageGlobs.length === 0) {
          return;
        }
        const yaml = dump({
          packages: packageGlobs,
        });
        await writeFile(join(directory, 'pnpm-workspace.yaml'), yaml);
      },
    };
  }
);
