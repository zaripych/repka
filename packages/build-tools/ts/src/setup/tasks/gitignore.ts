import { join } from 'node:path';

import { taskFactory } from './core/definition';

export const gitignore = taskFactory((opts: { directory?: string } = {}) => {
  const { directory = process.cwd() } = opts;
  const path = join(directory, '.gitignore');

  return {
    name: '.gitignore',
    description: `Create .gitignore`,

    async execute({ writeFile, readOriginalFile }) {
      const existing = await readOriginalFile(path).catch(() => '');
      const candidate = `.idea/
.vscode/
node_modules/
.DS_Store
*.tgz
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.npm/
.tsc-out
.temporary
dist
.log
`;
      const existingArr = existing.split('\n');

      const candidateSet = new Set(
        candidate
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      );

      existingArr.forEach((existing) => {
        candidateSet.delete(existing.trim());
        candidateSet.delete(existing.trim() + '/');
      });

      await writeFile(path, [...existingArr, ...candidateSet].join('\n'));
    },
  };
});
