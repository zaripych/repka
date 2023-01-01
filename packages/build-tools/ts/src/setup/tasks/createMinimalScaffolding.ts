import { join } from 'node:path';

import { taskFactory } from './core/definition';

export const createMinimalScaffolding = taskFactory(
  (
    opts: {
      directory?: string;
    } = {}
  ) => {
    const { directory = process.cwd() } = opts;

    return {
      name: 'scaffolding',
      description: `Create minimal directory structure for your project`,

      async execute({ writeFile }) {
        const sum = join(directory, './src/sum.ts');
        const sumTest = join(directory, './src/sum.test.ts');
        const index = join(directory, './src/index.ts');
        await writeFile(
          sum,
          `export function sum(a: number, b: number) { return a + b; }`
        );
        await writeFile(
          sumTest,
          `import { it, expect } from '@jest/globals';
import { sum } from './sum';

it('should work', () => { expect(sum(1, 2)).toBe(3); })`
        );
        await writeFile(index, `export * from './sum';`);
      },
    };
  }
);
