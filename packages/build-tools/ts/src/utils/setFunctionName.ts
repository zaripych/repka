export function setFunctionName<Fn extends (...args: unknown[]) => unknown>(
  name: string,
  fn: Fn
) {
  const instance = {
    [name]: (...args: Parameters<Fn>) => {
      return fn(...args);
    },
  };
  return instance[name] as Fn;
}
