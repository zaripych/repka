import { commonConfig, extensions } from './common.mjs';

const roots = [''];
const unitTestGlobs = ['<rootDir>/**/__tests__/**', '<rootDir>/**'];
const exts = extensions.join(',');
const unitTestMatch = unitTestGlobs
  .flatMap((glob) =>
    roots.map((root) => [root, glob].filter(Boolean).join('/'))
  )
  .map((glob) => [glob, `*.test.{${exts}}`].join('/'));

export default {
  testMatch: [...unitTestMatch, '!**/__integration__/**'],
  coverageDirectory: '../.coverage-unit',
  ...commonConfig,
};
