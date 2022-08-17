import type { BivarianceHack } from './bivarianceHack';

export type MemoizedFunctionStore<
  K extends string,
  T extends BivarianceHack<unknown[], Promise<unknown>>
> = {
  [P in K]: T;
} & {
  entries(): IterableIterator<[string, Awaited<ReturnType<T>>]>;
  isPending(...args: Parameters<T>): boolean;
  has(...args: Parameters<T>): boolean;
  get(...args: Parameters<T>): Awaited<ReturnType<T>> | undefined;
  set(...args: Parameters<T>): {
    value(value: Awaited<ReturnType<T>>): void;
  };
};

export function memoizeFunction<
  K extends string,
  T extends BivarianceHack<unknown[], Promise<unknown>>
>(
  functionName: K,
  opts: {
    memoizeFn: T;
    keyFromArgs: (...args: Parameters<T>) => string;
    cache?: Map<string, Awaited<ReturnType<T>>>;
  }
): MemoizedFunctionStore<K, T> {
  const resultByArgs = opts.cache ?? new Map<string, Awaited<ReturnType<T>>>();
  const pendingPromises = new Map<string, Promise<Awaited<ReturnType<T>>>>();
  const cachedFn = async (
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>> => {
    const key = opts.keyFromArgs(...args);
    const existing = resultByArgs.get(key);
    if (existing) {
      return existing;
    }
    const pending = pendingPromises.get(key);
    if (pending) {
      return pending;
    }
    try {
      const dataPromise = opts.memoizeFn(...args) as Promise<
        Awaited<ReturnType<T>>
      >;
      pendingPromises.set(key, dataPromise);
      const data = await dataPromise;
      resultByArgs.set(key, data);
      return data;
    } finally {
      pendingPromises.delete(key);
    }
  };
  const result: MemoizedFunctionStore<K, T> = {
    [functionName]: cachedFn,
    entries: () => resultByArgs.entries(),
    isPending: (...args: Parameters<T>) => {
      const key = opts.keyFromArgs(...args);
      return pendingPromises.has(key);
    },
    has: (...args: Parameters<T>) => {
      const key = opts.keyFromArgs(...args);
      return resultByArgs.has(key);
    },
    get: (...args: Parameters<T>): Awaited<ReturnType<T>> | undefined => {
      const key = opts.keyFromArgs(...args);
      return resultByArgs.get(key);
    },
    set: (...args: Parameters<T>) => ({
      value: (value: Awaited<ReturnType<T>>) => {
        const key = opts.keyFromArgs(...args);
        resultByArgs.set(key, value);
      },
    }),
  } as MemoizedFunctionStore<K, T>;
  return result;
}
