import type { Config } from 'jest';
import { join } from 'node:path';

export const extensions = ['js', 'jsx', 'ts', 'tsx'];

export const ignoreDirs = ['/node_modules/', '/dist/', '/.tsc-out/'];

export const jestTransformConfigProp = (
  jestPluginRoot?: string
): Pick<Config, 'transform'> => {
  return {
    transform: {
      '^.+\\.tsx?$': [
        jestPluginRoot ? join(jestPluginRoot, 'esbuild-jest') : 'esbuild-jest',
        {
          target: `node${process.versions.node}`,
          format: 'esm',
          sourcemap: true,
        },
      ],
    },
  };
};

export const commonDefaults: Config = {
  cacheDirectory: 'node_modules/.jest-cache',
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
      `<rootDir>/(?!__tests__)__${flavorRegex.source}__/`,
      `<rootDir>/src/(?!__tests__)__${flavorRegex.source}__/`,
    ],
  };
}
