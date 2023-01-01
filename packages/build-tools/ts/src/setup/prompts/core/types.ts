import type { Choice, PromptObject } from 'prompts';
import type { UnionToIntersection, ValuesType } from 'utility-types';

type PromptAnswer<P> = P extends PromptObject & {
  name: infer Name;
  initial?: infer Initial;
  choices?: infer Choices;
}
  ? Name extends string
    ? {
        [K in Name]: Choices extends Choice[]
          ? Choices[number]['value']
          : Initial;
      }
    : never
  : never;

type Join<T> = UnionToIntersection<T>;

type AnyPrompt = PromptObject | PromptObject[];

// eslint-disable-next-line @typescript-eslint/ban-types
type AnyArgs = {};

type PromptFactoryFn<Args> = (context: Args) => AnyPrompt | Promise<AnyPrompt>;

type AnyPromptFactoryFn = (context: AnyArgs) => AnyPrompt | Promise<AnyPrompt>;

export type ExtractPromptAnswers<T> = Join<
  ValuesType<T> extends AnyPromptFactoryFn
    ? Awaited<ReturnType<ValuesType<T>>> extends PromptObject
      ? PromptAnswer<Awaited<ReturnType<ValuesType<T>>>>
      : Awaited<ReturnType<ValuesType<T>>> extends PromptObject[]
      ? PromptAnswer<ValuesType<Awaited<ReturnType<ValuesType<T>>>>>
      : never
    : never
>;

export interface PromptFactory<
  Args,
  Result extends PromptObject | PromptObject[],
  DependsOn extends Array<AnyPromptFactory>
> {
  (context: Args): Promise<Result>;
  dependsOn: DependsOn;
}

export type AnyPromptFactory = {
  // eslint-disable-next-line @typescript-eslint/ban-types
  (context: {}): Promise<PromptObject | PromptObject[]>;
  dependsOn: AnyPromptFactory[];
};

export function promptFactory<
  T extends PromptFactoryFn<ExtractPromptAnswers<DependsOn>>,
  DependsOn extends Array<AnyPromptFactory> | [] = []
>(
  fn: T,
  dependsOn: DependsOn | [] = []
): PromptFactory<
  ExtractPromptAnswers<DependsOn> extends unknown
    ? AnyArgs
    : ExtractPromptAnswers<DependsOn>,
  Awaited<ReturnType<T>>,
  DependsOn
> {
  return Object.assign(fn, {
    dependsOn,
  }) as unknown as PromptFactory<
    ExtractPromptAnswers<DependsOn> extends unknown
      ? AnyArgs
      : ExtractPromptAnswers<DependsOn>,
    Awaited<ReturnType<T>>,
    DependsOn
  >;
}
