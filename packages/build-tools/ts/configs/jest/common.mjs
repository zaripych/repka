export const extensions = ['js', 'jsx', 'ts', 'tsx'];
export const ignoreDirs = [
  '/node_modules/',
  '/dist/',
  '/.tsc-out/',
  '/.integration/',
  '/.jest-cache/',
  '/.coverage-integration/',
  '/.coverage-unit/',
];

export const commonConfig = {
  cacheDirectory: '../.jest-cache',
  testPathIgnorePatterns: [...ignoreDirs],
  transformIgnorePatterns: [...ignoreDirs],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/__integration__/',
    '/__tests__/',
    '**/*.test.(ts,tsx)',
  ],
  extensionsToTreatAsEsm: extensions
    .filter((entry) => !['js'].includes(entry))
    .map((ext) => `.${ext}`),
  transform: {
    '^.+\\.tsx?$': [
      'esbuild-jest',
      {
        target: 'node16',
        format: 'esm',
        sourcemap: true,
      },
    ],
  },
};
