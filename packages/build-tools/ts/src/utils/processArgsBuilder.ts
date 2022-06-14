/**
 * A set of helpers to augment/change defaults of a CLI process
 *
 * @param processArgs Arguments of a CLI process being wrapped
 * @returns An API to manipulate CLI process args
 */
export function processArgsBuilder(processArgs: string[] = []) {
  const hasArg = (...argVariants: string[]) => {
    return argVariants.some((variant) => processArgs.includes(variant));
  };
  const modifiedProcessArgs: string[] = [...processArgs];
  const result: string[] = [];
  const api = {
    hasArg,
    defaultArg: (
      arg: [string, ...string[]],
      values: string[] = [],
      condition?: (args: { hasArg: typeof hasArg }) => boolean
    ) => {
      if (condition) {
        if (!condition(api)) {
          return api;
        }
      }
      if (hasArg(...arg)) {
        return api;
      }
      result.push(arg[0], ...values);
      return api;
    },
    addArgs: (argsArgs: Array<string[] | string> = []) => {
      result.push(
        ...argsArgs.flatMap((args) =>
          typeof args === 'string' ? [args] : args
        )
      );
      return api;
    },
    removeArgs: (
      args: Array<string | RegExp>,
      opts?: { numValues: number }
    ) => {
      for (const arg of args) {
        const index = modifiedProcessArgs.findIndex((value) =>
          typeof arg === 'string' ? value === arg : arg.test(value)
        );
        if (index !== -1) {
          modifiedProcessArgs.splice(
            index,
            opts?.numValues ? opts.numValues + 1 : 1
          );
        }
      }
      return api;
    },
    buildResult: () => [...result, ...modifiedProcessArgs],
  };
  return api;
}
