export function includesAnyOf(target: string[], hasAnyOfArgs: string[]) {
  return hasAnyOfArgs.some((variant) => target.includes(variant));
}

export function insertAfterAnyOf(
  target: string[],
  insert: string[],
  hasAnyOfArgs: string[]
) {
  const index = target.findIndex((value) => hasAnyOfArgs.includes(value));
  if (index === -1) {
    return target;
  }
  const result = [...target];
  result.splice(index + 1, 0, ...insert);
  return result;
}

export function removeArgsFrom(
  target: string[],
  args: Array<string | RegExp>,
  opts?: { numValues: number }
) {
  const result = [...target];
  for (const arg of args) {
    const index = target.findIndex((value) =>
      typeof arg === 'string' ? value === arg : arg.test(value)
    );
    if (index !== -1) {
      result.splice(index, opts?.numValues ? opts.numValues + 1 : 1);
    }
  }
  return result;
}

export function setScript(script: string) {
  return (state: CliArgs): CliArgs => {
    return {
      ...state,
      preArgs: [script, ...state.preArgs],
    };
  };
}

export function removeInputArgs(
  args: Array<string | RegExp>,
  opts?: { numValues: number }
) {
  return (state: CliArgs) => {
    return {
      ...state,
      inputArgs: removeArgsFrom(state.inputArgs, args, opts),
    };
  };
}

export function setDefaultArgs(
  args: [string, ...string[]],
  values: string[] = [],
  condition?: (state: CliArgs) => boolean,
  apply?: (args: string[], state: CliArgs) => CliArgs
) {
  return (state: CliArgs) => {
    if (condition) {
      if (!condition(state)) {
        return state;
      }
    }
    if (includesAnyOf(state.inputArgs, args)) {
      return state;
    }
    const set: NonNullable<typeof apply> = apply
      ? apply
      : (args, to) => ({
          ...to,
          preArgs: [...state.preArgs, ...args],
        });
    return set([args[0], ...values], state);
  };
}

export const removeLogLevelOption = () =>
  removeInputArgs(['--log-level'], { numValues: 1 });

export type CliArgs = {
  /**
   * Extra arguments that go before arguments passed in by the user
   */
  preArgs: string[];
  /**
   * Arguments as passed in by the user, could be modified by
   * transforms that come before current
   */
  inputArgs: string[];
  /**
   * Extra arguments that go after arguments passed in by the user
   */
  postArgs: string[];
};

export type CliArgsTransform = (state: CliArgs) => CliArgs;

export function cliArgsPipe(
  transforms: CliArgsTransform[],
  inputArgs: string[]
) {
  const {
    preArgs,
    inputArgs: modifiedInputArgs,
    postArgs,
  } = transforms.reduce<CliArgs>((acc, transform) => transform(acc), {
    inputArgs,
    preArgs: [],
    postArgs: [],
  });
  return [...preArgs, ...modifiedInputArgs, ...postArgs];
}
