import { buildForNode, pipeline } from './src';

await pipeline(
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
