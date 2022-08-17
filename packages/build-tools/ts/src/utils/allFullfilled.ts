type ReturnType<T extends readonly unknown[] | []> = {
  -readonly [P in keyof T]: Awaited<T[P]>;
};

export async function allFulfilled<T extends readonly unknown[] | []>(
  args: T
): Promise<ReturnType<T>> {
  const results = await Promise.allSettled(args);
  const resultsArr = results as unknown as Array<PromiseSettledResult<unknown>>;
  return resultsArr.map((result) => {
    if (result.status === 'rejected') {
      throw result.reason;
    }
    return result.value;
  }) as unknown as ReturnType<T>;
}
