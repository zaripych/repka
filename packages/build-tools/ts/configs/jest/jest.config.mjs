const extensions = ['js', 'jsx', 'ts', 'tsx'];
const roots = ['<rootDir>/src'];
const globs = ['**/__tests__/**', '**'];
const exts = extensions.join(',');
const unitTestMatch = globs
  .flatMap((glob) =>
    roots.map((root) => [root, glob].filter(Boolean).join('/'))
  )
  .map((glob) => [glob, `*.test.{${exts}}`].join('/'));

export default {
  testMatch: unitTestMatch,
  testPathIgnorePatterns: ['/node_modules/', 'dist', '.tsc-out'],
  extensionsToTreatAsEsm: extensions
    .filter((entry) => !['js'].includes(entry))
    .map((ext) => `.${ext}`),
  transform: {
    '^.+\\.tsx?$': [
      'esbuild-jest',
      {
        target: 'node16',
        format: 'esm',
      },
    ],
  },
};
