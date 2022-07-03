export function includesAnyOf(target: string[], hasAnyOfArgs: string[]) {
  return hasAnyOfArgs.some((variant) => target.includes(variant));
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

export function removeInputArgs(
  args: Array<string | RegExp>,
  opts?: { numValues: number }
) {
  return (value: CliArgs) => {
    return {
      ...value,
      inputArgs: removeArgsFrom(value.inputArgs, args, opts),
    };
  };
}

export function setDefaultArgs(
  args: [string, ...string[]],
  values: string[] = [],
  condition?: (args: CliArgs) => boolean
) {
  return (value: CliArgs) => {
    if (condition) {
      if (!condition(value)) {
        return value;
      }
    }
    if (includesAnyOf(value.inputArgs, args)) {
      return value;
    }
    return {
      ...value,
      preArgs: [...value.preArgs, args[0], ...values],
    };
  };
}

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

export type CliArgsTransform = (opts: CliArgs) => CliArgs;

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
