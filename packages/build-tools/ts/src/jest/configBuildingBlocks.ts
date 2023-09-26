import { fileURLToPath } from 'node:url';

import type { Config } from 'jest';
import { defaults } from 'jest-config';

export const extensions = [
  'js',
  'cjs',
  'mjs',
  'jsx',
  'ts',
  'cts',
  'mts',
  'tsx',
];

export const ignoreDirs = ['/node_modules/', '/dist/', '/.tsc-out/'];

export const jestTransformConfigProp = (): Pick<Config, 'transform'> => {
  const esbuild = fileURLToPath(
    new URL('./esbuildJestTransform.gen.mjs', import.meta.url)
  );

  return {
    transform: {
      [`^.+\\.${extensions.join('|')}$`]: esbuild,
    },
  };
};

export const commonDefaults: Config = {
  cacheDirectory: 'node_modules/.jest-cache',
  testPathIgnorePatterns: [
    ...ignoreDirs.map((dir) => `<rootDir>${dir}`),
    '<rootDir>/.*/test-cases/',
  ],
  transformIgnorePatterns: [
    ...ignoreDirs,
    ...ignoreDirs.map((dir) => `<rootDir>${dir}`),
  ],
  coveragePathIgnorePatterns: [
    ...ignoreDirs,
    ...ignoreDirs.map((dir) => `<rootDir>${dir}`),
  ],
  modulePathIgnorePatterns: [
    ...ignoreDirs,
    ...ignoreDirs.map((dir) => `<rootDir>${dir}`),
  ],
  moduleFileExtensions: [
    ...new Set([...defaults.moduleFileExtensions, ...extensions]),
  ],
  extensionsToTreatAsEsm: ['.jsx', '.ts', '.mts', '.tsx'],
  rootDir: process.cwd(),
};

const flavorRegex = /\w+/;

export function customFlavorTestDefaults(flavor: string): Config {
  if (flavor === 'unit') {
    throw new Error('Flavor cannot be unit');
  }
  if (!flavorRegex.test(flavor)) {
    throw new Error(`Flavor should match /${flavorRegex.source}/`);
  }
  const roots = ['<rootDir>', '<rootDir>/src'];
  const flavorTestGlobs = [`__${flavor}__/**`];
  const exts = extensions.join(',');
  const flavorTestMatch = flavorTestGlobs
    .flatMap((glob) =>
      roots.map((root) => [root, glob].filter(Boolean).join('/'))
    )
    .map((glob) => [glob, `*.test.{${exts}}`].join('/'));

  return {
    testMatch: flavorTestMatch,
    testTimeout: 45_000,
    slowTestThreshold: 30_000,
    coverageDirectory: `node_modules/.coverage-${flavor}`,
    ...commonDefaults,
  };
}

export function unitTestDefaults(): Config {
  const roots = ['<rootDir>'];
  const unitTestGlobs = ['**/__tests__/**', '**'];
  const exts = extensions.join(',');
  const unitTestMatch = unitTestGlobs
    .flatMap((glob) =>
      roots.map((root) => [root, glob].filter(Boolean).join('/'))
    )
    .map((glob) => [glob, `*.test.{${exts}}`].join('/'));

  return {
    testMatch: unitTestMatch,
    coverageDirectory: 'node_modules/.coverage-unit',
    ...commonDefaults,
    testPathIgnorePatterns: [
      ...(commonDefaults.testPathIgnorePatterns || []),
      `<rootDir>/(?!__tests__)(__[a-zA-Z0-9]+__)/`,
      `<rootDir>/src/(?!__tests__)(__[a-zA-Z0-9]+__)/`,
    ],
  };
}
