export async function allFulfilled<T extends readonly unknown[] | []>(
  args: T
): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>> }> {
  const results = await Promise.allSettled(args);
  const resultsArr = results as unknown as Array<PromiseSettledResult<unknown>>;
  for (const result of resultsArr) {
    if (result.status === 'rejected') {
      throw result.reason;
    }
  }
  return results;
}
