import assert from 'assert';
import type { ChildProcess } from 'child_process';
import type { Readable } from 'stream';

export type TextFilter =
  | {
      text: string;
      replaceWith?: string;
    }
  | {
      regExp: RegExp;
      extractGroup: number;
    }
  | {
      regExp: RegExp;
      replaceWith?: string;
    };

export type TextFilters = [TextFilter, ...TextFilter[]];

export function createFilter(filters: TextFilters) {
  const filterFns = filters.map((filter) => {
    if ('text' in filter) {
      return (data: string) =>
        data === filter.text ? filter.replaceWith : data;
    } else if ('regExp' in filter && 'extractGroup' in filter) {
      return (data: string) => {
        const array = filter.regExp.exec(data);
        if (!array) {
          return data;
        }
        return array[filter.extractGroup] || undefined;
      };
    } else if ('regExp' in filter) {
      return (data: string) => {
        const array = filter.regExp.exec(data);
        if (!array) {
          return data;
        }
        return filter.replaceWith;
      };
    } else {
      throw new Error('Invalid filter');
    }
  });

  const combinedFilter = (data: string) => {
    for (const filter of filterFns) {
      const result = filter(data);
      if (result !== data) {
        return result;
      }
    }
    return data;
  };

  return combinedFilter;
}

function read(
  readable: Readable,
  filter: (data: string) => string | undefined,
  destination: (data: string) => void
) {
  readable.setEncoding('utf-8');
  const onData = (data: string) => {
    const result = filter(data);
    if (typeof result === 'string') {
      destination(result);
    }
  };
  readable.addListener('data', onData);
}

export function filterAndPrint(
  childProcess: ChildProcess,
  filters: TextFilters
) {
  const { stdout, stderr } = childProcess;
  assert(!!stdout, '.stdout should be defined');
  assert(!!stderr, '.stderr should be defined');
  const filter = createFilter(filters);
  const writeLog = (data: string) => {
    process.stdout.write(data);
  };
  const writeErr = (data: string) => {
    process.stderr.write(data);
  };
  read(stdout, filter, writeLog);
  read(stderr, filter, writeErr);
}
