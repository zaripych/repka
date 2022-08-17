import { join } from 'node:path';

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

export const jestTransformConfigProp = (jestPluginRoot) => {
  return {
    transform: {
      '^.+\\.tsx?$': [
        jestPluginRoot ? join(jestPluginRoot, 'esbuild-jest') : 'esbuild-jest',
        {
          target: 'node16',
          format: 'esm',
          sourcemap: true,
        },
      ],
    },
  };
};

export const commonConfig = {
  cacheDirectory: '.jest-cache',
  testPathIgnorePatterns: [
    ...ignoreDirs.map((dir) => `<rootDir>${dir}`),
    '<rootDir>/.*/test-cases/',
  ],
  transformIgnorePatterns: [...ignoreDirs.map((dir) => `<rootDir>${dir}`)],
  coveragePathIgnorePatterns: [...ignoreDirs.map((dir) => `<rootDir>${dir}`)],
  modulePathIgnorePatterns: [...ignoreDirs.map((dir) => `<rootDir>${dir}`)],
  extensionsToTreatAsEsm: extensions
    .filter((entry) => !['js'].includes(entry))
    .map((ext) => `.${ext}`),
  rootDir: process.cwd(),
  ...jestTransformConfigProp(),
};
