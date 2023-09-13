import { expect, it, jest } from '@jest/globals';

import { validateEntryPoints } from './validateEntryPoints';

it(`doesn't fail on empty exports`, async () => {
  expect(
    await validateEntryPoints(
      {
        exportEntry: {},
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn: jest.fn(),
      }
    )
  ).toEqual({
    entryPoints: [],
    ignoredEntryPoints: {},
  });
});

it(`doesn't fail on null`, async () => {
  expect(
    await validateEntryPoints(
      {
        exportEntry: null,
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn: jest.fn(),
      }
    )
  ).toEqual({
    entryPoints: [],
    ignoredEntryPoints: {},
  });
});

it('works for simple string entries and converts ./src to ./dist', async () => {
  expect(
    await validateEntryPoints(
      {
        exportEntry: './src/index.ts',
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn: jest.fn(),
      }
    )
  ).toEqual({
    entryPoints: [
      {
        entryPoint: '.',
        sourcePath: './src/index.ts',
        outputPath: './dist/index.js',
        chunkName: 'main',
      },
    ],
    ignoredEntryPoints: {},
  });
});

it('fails when input and output are equal', async () => {
  const warn = jest.fn();
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          bundle: './dist/index.js',
          default: './dist/index.js',
        },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn,
      }
    )
  ).toEqual({
    entryPoints: [],
    ignoredEntryPoints: {
      bundle: './dist/index.js',
      default: './dist/index.js',
    },
  });
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "The "exports" entry "." has both the input source file path and the output path resolve to the same file at "./dist/index.js". Ignoring.",
      ],
    ]
  `);
});

it('works for simple object entries', async () => {
  expect(
    await validateEntryPoints(
      {
        exportEntry: { ['./entry']: './src/index.ts' },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn: jest.fn(),
      }
    )
  ).toEqual({
    entryPoints: [
      {
        entryPoint: './entry',
        sourcePath: './src/index.ts',
        outputPath: './dist/index.js',
        chunkName: 'entry',
      },
    ],
    ignoredEntryPoints: {},
  });
});

it('allows controlling the input via bundle and output via default conditions', async () => {
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          ['./entry']: {
            bundle: './src/index.ts',
            default: './dist/custom.js',
          },
        },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn: jest.fn(),
      }
    )
  ).toEqual({
    entryPoints: [
      {
        entryPoint: './entry',
        sourcePath: './src/index.ts',
        outputPath: './dist/custom.js',
        chunkName: 'entry',
      },
    ],
    ignoredEntryPoints: {},
  });
});

it('ignores null entries', async () => {
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          ['.']: './src/index.ts',
          ['./internal']: null,
        },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn: jest.fn(),
      }
    )
  ).toEqual({
    entryPoints: [
      {
        entryPoint: '.',
        sourcePath: './src/index.ts',
        outputPath: './dist/index.js',
        chunkName: 'main',
      },
    ],
    ignoredEntryPoints: {
      ['./internal']: null,
    },
  });
});

it('works for extra object entries', async () => {
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          //
          ['.']: './src/index.ts',
          './cli': './src/cli.ts',
        },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn: jest.fn(),
      }
    )
  ).toEqual({
    entryPoints: [
      {
        entryPoint: '.',
        sourcePath: './src/index.ts',
        outputPath: './dist/index.js',
        chunkName: 'main',
      },
      {
        entryPoint: './cli',
        sourcePath: './src/cli.ts',
        outputPath: './dist/cli.js',
        chunkName: 'cli',
      },
    ],
    ignoredEntryPoints: {},
  });
});

it(`doesn't allow output to ./src`, async () => {
  const warn = jest.fn();
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          //
          ['.']: {
            bundle: './src/index.ts',
            default: './src/src/index.ts',
          },
        },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn,
      }
    )
  ).toEqual({
    entryPoints: [],
    ignoredEntryPoints: {
      ['.']: {
        bundle: './src/index.ts',
        default: './src/src/index.ts',
      },
    },
  });
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "The "exports" entry "." output path "./src/src/index.ts" points to the "./src/" directory. Ignoring.",
      ],
    ]
  `);
});

it(`ignores glob entries which do not match any files`, async () => {
  const warn = jest.fn();
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          './configs/*': './configs/*',
        },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn,
      }
    )
  ).toEqual({
    entryPoints: [],
    ignoredEntryPoints: {
      './configs/*': './configs/*',
    },
  });
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "The "exports" entry "./configs/*" doesn't match any files that can be bundled by the bundler.",
      ],
    ]
  `);
});

it(`warns about files that match the glob but cannot be bundled`, async () => {
  const warn = jest.fn();
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          './configs/*': './configs/*',
        },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve(['./configs/one.yaml']),
        warn,
      }
    )
  ).toEqual({
    entryPoints: [],
    ignoredEntryPoints: {
      './configs/*': './configs/*',
    },
  });
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "The "exports" entry "./configs/*" matches files that might fail to bundle:
      - ./configs/one.yaml",
      ],
    ]
  `);
});

it(`warns about non-string entries and ignores them`, async () => {
  const warn = jest.fn();
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          './configs/*': 2,
        },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn,
      }
    )
  ).toEqual({
    entryPoints: [],
    ignoredEntryPoints: {
      './configs/*': 2,
    },
  });
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "Expected "string" or "object" as exports entry - got "2"",
      ],
    ]
  `);
});

it(`expands glob entries`, async () => {
  const warn = jest.fn();
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          './configs/*': './configs/*',
        },
        packageDirectory: '.',
      },
      {
        fg: () =>
          Promise.resolve([
            //
            './configs/one.ts',
            './configs/two.ts',
          ]),
        warn,
      }
    )
  ).toEqual({
    entryPoints: [
      {
        entryPoint: './configs/*',
        sourcePath: './configs/one.ts',
        outputPath: './dist/configs/one.js',
        chunkName: 'configs-one',
      },
      {
        entryPoint: './configs/*',
        sourcePath: './configs/two.ts',
        outputPath: './dist/configs/two.js',
        chunkName: 'configs-two',
      },
    ],
    ignoredEntryPoints: {},
  });
});

it(`expands glob entries which have bundle condition`, async () => {
  const warn = jest.fn();
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          './configs/*': {
            bundle: './configs/*',
          },
        },
        packageDirectory: '.',
      },
      {
        fg: () =>
          Promise.resolve([
            //
            './configs/one.ts',
            './configs/two.ts',
          ]),
        warn,
      }
    )
  ).toEqual({
    entryPoints: [
      {
        entryPoint: './configs/*',
        sourcePath: './configs/one.ts',
        outputPath: './dist/configs/one.js',
        chunkName: 'configs-one',
      },
      {
        entryPoint: './configs/*',
        sourcePath: './configs/two.ts',
        outputPath: './dist/configs/two.js',
        chunkName: 'configs-two',
      },
    ],
    ignoredEntryPoints: {},
  });
});

it(`expands glob entries which have bundle condition`, async () => {
  const warn = jest.fn();
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          './configs/*': {
            bundle: './configs/*',
            default: './dist/configs/*',
          },
        },
        packageDirectory: '.',
      },
      {
        fg: () =>
          Promise.resolve([
            //
            './configs/one.ts',
            './configs/two.ts',
          ]),
        warn,
      }
    )
  ).toEqual({
    entryPoints: [
      {
        entryPoint: './configs/*',
        sourcePath: './configs/one.ts',
        outputPath: './dist/configs/one.js',
        chunkName: 'configs-one',
      },
      {
        entryPoint: './configs/*',
        sourcePath: './configs/two.ts',
        outputPath: './dist/configs/two.js',
        chunkName: 'configs-two',
      },
    ],
    ignoredEntryPoints: {},
  });
});

it(`ignores package.json entry without a warning`, async () => {
  const warn = jest.fn();
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          './package.json': './package.json',
        },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn,
      }
    )
  ).toEqual({
    entryPoints: [],
    ignoredEntryPoints: { './package.json': './package.json' },
  });
  expect(warn.mock.calls).toMatchInlineSnapshot(`[]`);
});

it(`expands glob entries which have bundle condition and uses node or default conditions as output`, async () => {
  const warn = jest.fn();
  expect(
    await validateEntryPoints(
      {
        exportEntry: {
          '.': './lib/index.js',
          './lib': './lib/index.js',
          './lib/*': './lib/*.js',
          './lib/*.js': './lib/*.js',
          './feature': './feature/index.js',
          './feature/*': './feature/*.js',
          './feature/*.js': './feature/*.js',
        },
        packageDirectory: '.',
      },
      {
        fg: (pattern) =>
          pattern.includes('lib')
            ? Promise.resolve([
                //
                './lib/one.ts',
                './lib/two.ts',
              ])
            : Promise.resolve([
                //
                './feature/unique.ts',
              ]),
        warn,
      }
    )
  ).toEqual({
    entryPoints: [
      {
        chunkName: 'main',
        entryPoint: '.',
        outputPath: './dist/lib/index.js',
        sourcePath: './lib/index.js',
      },
      {
        chunkName: 'lib-one',
        entryPoint: './lib/*',
        outputPath: './dist/lib/one.js',
        sourcePath: './lib/one.ts',
      },
      {
        chunkName: 'lib-two',
        entryPoint: './lib/*',
        outputPath: './dist/lib/two.js',
        sourcePath: './lib/two.ts',
      },
      {
        chunkName: 'feature',
        entryPoint: './feature',
        outputPath: './dist/feature/index.js',
        sourcePath: './feature/index.js',
      },
      {
        chunkName: 'feature-unique',
        entryPoint: './feature/*',
        outputPath: './dist/feature/unique.js',
        sourcePath: './feature/unique.ts',
      },
    ],
    ignoredEntryPoints: {
      './feature/*.js': './feature/*.js',
      './lib': './lib/index.js',
      './lib/*.js': './lib/*.js',
    },
  });
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "The "exports" entry "./lib" resolves to the same output path as another entry point ".". Ignoring.",
      ],
      [
        "The "exports" entry "./lib/*.js" resolves to the same output path as another entry point "./lib/*". Ignoring.",
      ],
      [
        "The "exports" entry "./feature/*.js" resolves to the same output path as another entry point "./feature/*". Ignoring.",
      ],
    ]
  `);
});

it(`throws on invalid export entries`, async () => {
  await expect(
    validateEntryPoints(
      {
        exportEntry: {
          bundle: {
            ['.']: './src/index.ts',
            './cli': './src/cli.ts',
          },
        },
        packageDirectory: '.',
      },
      {
        fg: () => Promise.resolve([]),
        warn: jest.fn(),
      }
    )
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `"Unexpected "exports" entry - found ".", "./cli" but expected only conditions, ie "types", "node", "browser", "default", ... etc. See https://nodejs.org/api/packages.html#conditional-exports for more information"`
  );
});
