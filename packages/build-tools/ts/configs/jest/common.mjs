export const extensions = ['js', 'jsx', 'ts', 'tsx'];
export const ignoreDirs = ['/node_modules/', '/dist/', '/.tsc-out/'];

export const commonConfig = {
  cacheDirectory: '../.jest-cache',
  testPathIgnorePatterns: [...ignoreDirs],
  transformIgnorePatterns: [...ignoreDirs],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/',
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
