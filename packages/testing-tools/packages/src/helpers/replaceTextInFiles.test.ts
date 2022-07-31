import { Writable } from 'stream';

import { searchAndReplaceTextTransform } from './replaceTextInFiles';

describe('replaceTextTransform', () => {
  it('requires non-empty substring', () => {
    expect(() =>
      searchAndReplaceTextTransform({
        filters: [
          {
            substring: '',
            replaceWith: '',
          },
        ],
      })
    ).toThrowErrorMatchingInlineSnapshot(`"substring cannot be empty"`);
  });

  it('requires at least one filter', () => {
    expect(() =>
      searchAndReplaceTextTransform({
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        filters: [],
      })
    ).toThrowErrorMatchingInlineSnapshot(`"At least one filter is required"`);
  });

  it('requires maxMatchLength parameters', () => {
    expect(() =>
      searchAndReplaceTextTransform({
        filters: [
          {
            regExp: /test/,
            replaceWith: () => 'good',
          },
        ],
      })
    ).toThrowErrorMatchingInlineSnapshot(
      `"maxMatchLength must be specified when using RegExp replacement"`
    );
  });

  it('requires maxMatchLength parameters', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          substring: 'test',
          replaceWith: 'good',
        },
      ],
    });
    input.pipe(output);

    input.end();

    expect(buffer.join('')).toEqual(``);
  });

  it('captures all matches and calculates total read correctly', () => {
    const matches: Array<{
      position: number;
      length: number;
    }> = [];
    let totalRead = 0;
    const output = new Writable({
      write: (_, __, cb) => {
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          substring: 'test',
          replaceWith: 'good',
        },
      ],
      onEvent: (opts) => {
        if (opts.event === 'match') {
          matches.push({
            position: opts.position,
            length: opts.length,
          });
        }
        if (opts.event === 'flush') {
          totalRead = opts.totalRead;
        }
      },
    });
    input.pipe(output);

    input.write('te');
    input.write('st');
    input.write('-');
    input.write('-');
    input.write('te');
    input.write('st');
    input.write('-');
    input.write('-');
    input.write('te');
    input.write('st');
    input.write('-');
    input.write('-');
    input.end();

    expect(matches).toEqual([
      {
        position: 0,
        length: 4,
      },
      {
        position: 6,
        length: 4,
      },
      {
        position: 12,
        length: 4,
      },
    ]);
    expect(totalRead).toBe(18);
  });

  it('works when chunks are smaller than lookup substring', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          substring: 'test',
          replaceWith: 'good',
        },
      ],
    });
    input.pipe(output);

    input.write('te');
    input.write('st');
    input.write('-');
    input.write('te');
    input.write('st');
    input.write('-');
    input.write('te');
    input.write('st');
    input.write('-');
    input.end();

    expect(buffer.join('')).toEqual(`good-good-good-`);
  });

  it('works when chunks are bigger than lookup substring', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          substring: 'test',
          replaceWith: 'good',
        },
      ],
    });
    input.pipe(output);

    input.write('good-test-test-tes');
    input.write('t-test-te');
    input.end();

    expect(buffer.join('')).toEqual(`good-good-good-good-good-te`);
  });

  it('works when chunks do not have lookup substring', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          substring: 'test',
          replaceWith: 'good',
        },
      ],
    });
    input.pipe(output);

    input.write('good-good-go');
    input.write('od-good');
    input.end();

    expect(buffer.join('')).toEqual(`good-good-good-good`);
  });

  it('works when entire chunk matches lookup substring', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          substring: 'test',
          replaceWith: 'good',
        },
      ],
    });
    input.pipe(output);

    input.write('good-');
    input.write('test');
    input.write('-good');
    input.end();

    expect(buffer.join('')).toEqual(`good-good-good`);
  });

  it('works when there is only one chunk', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          substring: 'test',
          replaceWith: 'good',
        },
      ],
    });
    input.pipe(output);

    input.write('good-test-brother');
    input.end();

    expect(buffer.join('')).toEqual(`good-good-brother`);
  });

  it('works when there are no chunks', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          substring: 'test',
          replaceWith: 'good',
        },
      ],
    });
    input.pipe(output);

    input.end();

    expect(buffer.join('')).toEqual(``);
  });

  it('works with graphemes', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          substring: '😞',
          replaceWith: '🥹',
        },
      ],
    });
    input.pipe(output);

    input.write('😞');
    const characters = '😞';
    expect(characters.length).toBe(2);
    for (const char of characters) {
      input.write(char);
    }
    input.write('😞');
    input.end();

    expect(buffer.join('')).toEqual(`🥹🥹🥹`);
  });

  it('works with regular expressions to the point', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          regExp: /te+st/,
          replaceWith: () => 'good',
        },
      ],
      maxMatchLength: 'teeest'.length,
    });
    input.pipe(output);

    input.write(
      'good-test-teest-brother-teeeeeeeeest-teeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
    input.write('eeeeeeeeeeeeeeeeeeeeeeeeeeeest-test');
    input.end();

    expect(buffer.join('')).toMatchInlineSnapshot(
      `"good-good-good-brother-good-teeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeest-good"`
    );
  });

  it('works with regular expressions if given bigger buffer', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          regExp: /te+st/,
          replaceWith: () => 'good',
        },
      ],
      maxMatchLength:
        'teeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeest'.length,
    });
    input.pipe(output);

    input.write(
      'good-test-teest-brother-teeeeeeeeest-teeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
    input.write('eeeeeeeeeeeeeeeeeeeeeeeeeeeest-test');
    input.end();

    expect(buffer.join('')).toMatchInlineSnapshot(
      `"good-good-good-brother-good-good-good"`
    );
  });

  it('works with regular expressions if given bigger buffer', () => {
    const buffer: string[] = [];
    const output = new Writable({
      write: (chunk: string, __, cb) => {
        buffer.push(chunk);
        cb(null);
      },
    });
    const input = searchAndReplaceTextTransform({
      filters: [
        {
          regExp: /te+st/,
          replaceWith: () => 'good',
        },
      ],
      maxMatchLength:
        'teeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeest'.length,
    });
    input.pipe(output);

    input.write(
      'good-test-teest-brother-teeeeeeeeest-teeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
    input.write('eeeeeeeeeeeeeeeeeeeeeeeeeeeest-test');
    input.end();

    expect(buffer.join('')).toMatchInlineSnapshot(
      `"good-good-good-brother-good-good-good"`
    );
  });
});
