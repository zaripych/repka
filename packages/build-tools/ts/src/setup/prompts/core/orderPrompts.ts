import type { AnyPromptFactory } from './types';

function collectAll(
  factory: AnyPromptFactory | AnyPromptFactory[],
  add: (value: AnyPromptFactory) => void,
  visited: (value: AnyPromptFactory) => boolean
) {
  if (Array.isArray(factory)) {
    for (const el of factory) {
      collectAll(el, add, visited);
    }
  } else {
    if (visited(factory)) {
      return;
    }
    add(factory);
    collectAll(factory.dependsOn, add, visited);
  }
}

function hasEvery(
  set: Set<AnyPromptFactory>,
  values: Iterable<AnyPromptFactory>
) {
  for (const value of values) {
    if (!set.has(value)) {
      return false;
    }
  }
  return true;
}

type OrderedFactories = AnyPromptFactory[][];

export function orderPrompts<T extends Array<AnyPromptFactory>>(factories: T) {
  const all = new Set<AnyPromptFactory>();
  collectAll(factories, all.add.bind(all), all.has.bind(all));

  const ordered = new Set<AnyPromptFactory>();
  const levels: OrderedFactories = [];

  while (all.size > 0) {
    const level: AnyPromptFactory[] = [];
    for (const factory of all) {
      if (
        factory.dependsOn.length !== 0 &&
        !hasEvery(ordered, factory.dependsOn)
      ) {
        continue;
      }
      level.push(factory);
    }
    if (level.length === 0 && all.size > 0) {
      throw new Error(
        'Cannot determine the order of execution of prompts, dependencies form a cycle?'
      );
    }
    level.forEach(all.delete.bind(all));
    level.forEach(ordered.add.bind(ordered));
    levels.push(level);
  }

  return levels;
}
