import type { BivarianceHack } from './bivarianceHack';

type DepsLike = {
  [key: string]: BivarianceHack<unknown[], unknown>;
};

type DepsDecorator<Deps extends DepsLike> = {
  defaultDeps: Deps;
};

type Last<T extends unknown[]> = T extends [opt?: infer L]
  ? L
  : T extends [first?: unknown, opt?: infer L]
  ? L
  : T extends [first?: unknown, second?: unknown, opt?: infer L]
  ? L
  : T extends [
      first?: unknown,
      second?: unknown,
      third?: unknown,
      opt?: infer L
    ]
  ? L
  : never;

type FilterDepsLike<T> = T extends DepsLike ? T : never;

export type DepsOf<Fn extends BivarianceHack<unknown[], unknown>> =
  Fn extends DepsDecorator<infer D> ? D : FilterDepsLike<Last<Parameters<Fn>>>;

export function withDeps<
  Fn extends BivarianceHack<unknown[], unknown>,
  Deps extends DepsLike
>(instance: Fn, defaultDeps: Deps): Fn & DepsDecorator<Deps> {
  return Object.assign(instance, {
    defaultDeps,
  });
}
