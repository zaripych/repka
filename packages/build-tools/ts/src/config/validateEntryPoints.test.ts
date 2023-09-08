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

  it(`doesn't support globs`, () => {
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
      ],
      ignoredEntryPoints: {
        './configs/*': './configs/*',
      },
    });
  });

  it(`doesn't support conditions`, () => {
    expect(
      validateEntryPoints({
        node: {
          ['.']: './src/index.ts',
          './cli': './src/cli.ts',
        },
      })
    ).toEqual({
      entryPoints: [],
      ignoredEntryPoints: {
        node: {
          ['.']: './src/index.ts',
          './cli': './src/cli.ts',
        },
      },
    });
  });

  it(`doesn't support nested conditions`, () => {
    const result = validateEntryPoints({
      ['.']: {
        node: './src/index.ts',
      },
    });
    expect(result).toEqual({
      entryPoints: [],
      ignoredEntryPoints: {
        ['.']: {
          node: './src/index.ts',
        },
      },
    });
  });
});
