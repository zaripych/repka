import { buildForNode, run } from './src';

await run(
  buildForNode({
    externals: ['typescript', 'eslint'],
    copy: [
      {
        sourceDir: './configs',
        globs: ['**/*'],
      },
    ],
  })
);
