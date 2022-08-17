import { commonConfig, extensions } from './common.mjs';

const roots = [''];
const unitTestGlobs = ['<rootDir>/**/__tests__/**', '<rootDir>/**'];
const exts = extensions.join(',');
const unitTestMatch = unitTestGlobs
  .flatMap((glob) =>
    roots.map((root) => [root, glob].filter(Boolean).join('/'))
  )
  .map((glob) => [glob, `*.test.{${exts}}`].join('/'));

export const unitTestConfig = {
  testMatch: unitTestMatch,
  coverageDirectory: '.coverage-unit',
  ...commonConfig,
  testPathIgnorePatterns: [
    ...commonConfig.testPathIgnorePatterns,
    '<rootDir>/(?!__tests__)__\\w+__/',
    '<rootDir>/src/(?!__tests__)__\\w+__/',
  ],
};
