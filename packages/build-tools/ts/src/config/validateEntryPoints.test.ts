import { describe, expect, it } from '@jest/globals';

import { validateEntryPoints } from './validateEntryPoints';

describe('validateEntryPoints', () => {
  it(`doesn't fail on empty exports`, () => {
    const result = validateEntryPoints({});
    expect(result).toEqual({
      entryPoints: [],
      ignoredEntryPoints: {},
    });
  });

  it(`fails on null (null is a valid JSON value which could be used in package.json)`, () => {
    expect(() => {
      validateEntryPoints(null);
    }).toThrowErrorMatchingInlineSnapshot(
      `"Expected "string" or "object" as exports entry - got "null""`
    );
  });

  it('works for simple string entries', () => {
    expect(validateEntryPoints('./src/index.ts')).toEqual({
      entryPoints: [
        {
          entryPoint: '.',
          sourcePath: './src/index.ts',
          chunkName: 'main',
        },
      ],
      ignoredEntryPoints: {},
    });
  });

  it('works for simple object entries', () => {
    expect(validateEntryPoints({ ['.']: './src/index.ts' })).toEqual({
      entryPoints: [
        {
          entryPoint: '.',
          sourcePath: './src/index.ts',
          chunkName: 'main',
        },
      ],
      ignoredEntryPoints: {},
    });
  });

  it('ignores null entries', () => {
    expect(
      validateEntryPoints({
        ['.']: './src/index.ts',
        ['./internal']: null,
      })
    ).toEqual({
      entryPoints: [
        {
          entryPoint: '.',
          sourcePath: './src/index.ts',
          chunkName: 'main',
        },
      ],
      ignoredEntryPoints: {
        ['./internal']: null,
      },
    });
  });

  it('works for extra object entries', () => {
    expect(
      validateEntryPoints({ ['.']: './src/index.ts', './cli': './src/cli.ts' })
    ).toEqual({
      entryPoints: [
        {
          entryPoint: '.',
          sourcePath: './src/index.ts',
          chunkName: 'main',
        },
        {
          entryPoint: './cli',
          sourcePath: './src/cli.ts',
          chunkName: 'cli',
        },
      ],
      ignoredEntryPoints: {},
    });
  });

  it(`allows glob entries`, () => {
    expect(
      validateEntryPoints({
        ['.']: './src/index.ts',
        './cli': './src/cli.ts',
        './configs/*': './configs/*',
      })
    ).toEqual({
      entryPoints: [
        {
          entryPoint: '.',
          sourcePath: './src/index.ts',
          chunkName: 'main',
        },
        {
          entryPoint: './cli',
          sourcePath: './src/cli.ts',
          chunkName: 'cli',
        },
        {
          entryPoint: './configs/*',
          sourcePath: './configs/*',
          chunkName: 'configs',
        },
      ],
      ignoredEntryPoints: {},
    });
  });

  it(`supports globs with conditions`, () => {
    expect(
      validateEntryPoints({
        ['.']: './src/index.ts',
        './cli': './src/cli.ts',
        './configs/*': {
          browser: './configs/*1',
          types: './configs/*2',
        },
      })
    ).toEqual({
      entryPoints: [
        {
          entryPoint: '.',
          sourcePath: './src/index.ts',
          chunkName: 'main',
        },
        {
          entryPoint: './cli',
          sourcePath: './src/cli.ts',
          chunkName: 'cli',
        },
        {
          entryPoint: './configs/*',
          sourcePath: './configs/*2',
          chunkName: 'configs',
        },
      ],
      ignoredEntryPoints: {},
    });
  });

  it(`supports nested conditions`, () => {
    const result = validateEntryPoints({
      ['.']: {
        node: './src/index.ts',
      },
    });
    expect(result).toEqual({
      entryPoints: [
        {
          entryPoint: '.',
          sourcePath: './src/index.ts',
          chunkName: 'main',
        },
      ],
      ignoredEntryPoints: {},
    });
  });
});

it(`throws on invalid export entries`, () => {
  expect(() =>
    validateEntryPoints({
      node: {
        ['.']: './src/index.ts',
        './cli': './src/cli.ts',
      },
    })
  ).toThrowErrorMatchingInlineSnapshot(
    `"Unexpected "exports" entry - found ".", "./cli" but expected only conditions, ie "types", "node", "browser", "default", ... etc. See https://nodejs.org/api/packages.html#conditional-exports for more information"`
  );
});
