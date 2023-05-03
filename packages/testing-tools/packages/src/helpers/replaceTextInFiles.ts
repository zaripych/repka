import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  allFulfilled,
  escapeRegExp,
  promiseFromEvents,
  UnreachableError,
} from '@utils/ts';
import fg from 'fast-glob';

export type SearchAndReplaceOptsExtra = Pick<
  fg.Options,
  'cwd' | 'deep' | 'dot' | 'followSymbolicLinks'
>;

export type ReplaceTextFilter =
  | {
      substring: string;
      replaceWith: string;
    }
  | {
      regExp: RegExp;
      replaceWith: (match: RegExpExecArray) => string;
    };

export type ReplaceTextFilters = [ReplaceTextFilter, ...ReplaceTextFilter[]];

export type SearchTextFilter =
  | {
      substring: string;
    }
  | {
      regExp: RegExp;
    };

export type SearchTextFilters = [SearchTextFilter, ...SearchTextFilter[]];

export type ReplaceTextOpts = {
  /**
   * Target directory (defaults to current)
   */
  target?: string;
  include: string[];
  exclude?: string[];
  filters: ReplaceTextFilters;
  maxMatchLength?: number;
  options?: SearchAndReplaceOptsExtra & {
    dryRun?: boolean;
  };
};

export type SearchTextOpts = {
  /**
   * Target directory (defaults to current)
   */
  target?: string;
  include: string[];
  exclude?: string[];
  filters: SearchTextFilters;
  maxMatchLength?: number;
  options?: SearchAndReplaceOptsExtra & {
    dryRun?: boolean;
  };
};

function filesStream({
  target: source,
  exclude,
  include,
  options,
}: Pick<ReplaceTextOpts, 'target' | 'include' | 'exclude' | 'options'>) {
  return fg.stream(
    [
      ...(exclude ? exclude.map((glob) => `!${source || '.'}/${glob}`) : []),
      ...include.map((glob) => `${source || '.'}/${glob}`),
    ],
    {
      followSymbolicLinks: false,
      ...options,
      onlyFiles: true,
    }
  );
}

function createFilter(textFilters: ReplaceTextFilters | SearchTextFilters) {
  const filters = textFilters.map((entry) => {
    if ('substring' in entry) {
      if (!entry.substring) {
        throw new Error('substring cannot be empty');
      }
      return {
        regex: new RegExp(escapeRegExp(entry.substring), 'u'),
        ...('replaceWith' in entry && {
          replaceWith: (_match: RegExpExecArray) => entry.replaceWith,
        }),
      };
    } else if ('regExp' in entry) {
      return {
        regex: entry.regExp,
        ...('replaceWith' in entry && {
          replaceWith: entry.replaceWith,
        }),
      };
    } else {
      throw new UnreachableError(entry);
    }
  });

  return (text: string) => {
    for (const [filterIndex, filter] of filters.entries()) {
      const result = filter.regex.exec(text);
      if (!result || !result[0]) {
        continue;
      }
      const original = result[0];
      return {
        filterIndex,
        index: result.index,
        length: result[0].length,
        before: text.slice(0, result.index),
        match: result,
        replacement: () => filter.replaceWith?.(result) ?? original,
        after: text.slice(result.index + result[0].length),
      };
    }
    return undefined;
  };
}

export type Match = {
  filterIndex: number;
  match: RegExpExecArray;
  position: number;
  length: number;
};

export function searchAndReplaceTextTransform(opts: {
  filters: ReplaceTextFilters | SearchTextFilters;
  /**
   * Maximum length of the match ensures that replacement function is called
   * on chunks of at least this size
   */
  maxMatchLength?: number;
  onEvent?: (
    opts:
      | ({
          event: 'match';
        } & Match)
      | {
          event: 'flush';
          totalRead: number;
        }
  ) => void;
}) {
  if (opts.filters.length === 0) {
    throw new Error('At least one filter is required');
  }

  const filter = createFilter(opts.filters);

  const maxMatchLength =
    opts.maxMatchLength ??
    [...opts.filters].reduce((acc, entry) => {
      if ('regExp' in entry) {
        throw new Error(
          'maxMatchLength must be specified when using RegExp replacement'
        );
      }
      return entry.substring.length + acc;
    }, 0);

  let totalRead = 0;
  let chunks = '';

  const transform = new Transform({
    transform(chunk: string | Buffer, _, callback) {
      chunks += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk;
      // Below commented condition can lead to blocked pipes when
      // stream is infinite, on the other hand consuming input earlier
      // might lead to matching a shorter match and loosing opportunity
      // to consume longer match that later wouldn't match because we already
      // consumed the portion of a match.
      // --
      // if (chunks.length >= maxMatchLength) {
      let result = filter(chunks);
      while (result) {
        if (opts.onEvent) {
          opts.onEvent({
            event: 'match',
            filterIndex: result.filterIndex,
            match: result.match,
            position: totalRead + result.index,
            length: result.length,
          });
        }
        this.push([result.before, result.replacement()].join(''));
        totalRead += chunks.length;
        chunks = result.after;
        result = filter(chunks);
      }
      if (chunks.length > maxMatchLength * 2) {
        const cutPoint = chunks.length - maxMatchLength;
        const before = chunks.slice(0, cutPoint);
        this.push(before);
        chunks = chunks.slice(cutPoint);
        totalRead += cutPoint;
      }
      callback(null);
    },
    flush(callback) {
      if (chunks.length >= 0) {
        let result = filter(chunks);
        while (result) {
          if (opts.onEvent) {
            opts.onEvent({
              event: 'match',
              filterIndex: result.filterIndex,
              match: result.match,
              position: totalRead + result.index,
              length: result.length,
            });
          }
          this.push([result.before, result.replacement()].join(''));
          totalRead += chunks.length;
          chunks = result.after;
          result = filter(chunks);
        }
        if (chunks.length > 0) {
          this.push(chunks);
          totalRead += chunks.length;
        }
      }
      if (opts.onEvent) {
        opts.onEvent({
          event: 'flush',
          totalRead,
        });
      }
      callback(null);
    },
  });
  return transform;
}

async function replaceTextInFile(opts: {
  fileName: string;
  filters: ReplaceTextFilters;
  maxMatchLength?: number;
}) {
  const readStream = createReadStream(opts.fileName, {
    encoding: 'utf-8',
  });
  const writeStream = createWriteStream(opts.fileName, {
    encoding: 'utf-8',
    flags: 'r+',
  });
  writeStream.cork();
  await pipeline(
    readStream,
    searchAndReplaceTextTransform({
      filters: opts.filters,
      maxMatchLength: opts.maxMatchLength,
    }),
    writeStream
  );
}

export async function replaceTextInFiles(opts: ReplaceTextOpts) {
  const searchStream = filesStream(opts);
  const searchingForFiles = promiseFromEvents({
    emitter: searchStream,
    resolveEvent: 'close',
    rejectEvent: 'error',
  });

  const replaceTasks: Array<Promise<void>> = [];
  const addPendingReplaceTask = <T>(promise: Promise<T>) => {
    replaceTasks.push(promise as unknown as Promise<void>);
  };

  const replaceTask = async (fileName: string) => {
    await replaceTextInFile({
      fileName,
      filters: opts.filters,
      maxMatchLength: opts.maxMatchLength,
    });
  };

  searchStream.on('data', (chunk: string) => {
    addPendingReplaceTask(replaceTask(chunk));
  });

  try {
    await searchingForFiles;
  } finally {
    await allFulfilled(replaceTasks);
  }
}

async function searchTextInFile(opts: {
  fileName: string;
  filters: SearchTextFilters;
  maxMatchLength?: number;
}) {
  const readStream = createReadStream(opts.fileName, {
    encoding: 'utf-8',
  });
  const matches: Array<Match> = [];
  await pipeline(
    readStream,
    searchAndReplaceTextTransform({
      filters: opts.filters,
      maxMatchLength: opts.maxMatchLength,
      onEvent: (ev) => {
        if (ev.event === 'match') {
          const { event, ...match } = ev;
          matches.push(match);
        }
      },
    })
  );
  return matches;
}

export async function searchTextInFiles(opts: SearchTextOpts) {
  const set = new Set<string>();
  const map = new Map<string, Match[]>();
  const searchStream = filesStream(opts);
  const searchingForFiles = promiseFromEvents({
    emitter: searchStream,
    resolveEvent: 'close',
    rejectEvent: 'error',
  });

  const searchTasks: Array<Promise<void>> = [];
  const addPendingSearchTask = <T>(promise: Promise<T>) => {
    searchTasks.push(promise as unknown as Promise<void>);
  };

  const searchTask = async (fileName: string) => {
    if (set.has(fileName)) {
      return;
    }
    set.add(fileName);
    const results = await searchTextInFile({
      fileName,
      filters: opts.filters,
      maxMatchLength: opts.maxMatchLength,
    });
    if (results.length === 0) {
      return;
    }
    map.set(fileName, results);
  };

  searchStream.on('data', (chunk: string) => {
    addPendingSearchTask(searchTask(chunk));
  });

  try {
    await searchingForFiles;
  } finally {
    await allFulfilled(searchTasks);
  }
  return map;
}
