export const ignoreErrors = async <T>(
  promise: Promise<T>
): Promise<T | undefined> => {
  try {
    return await promise;
  } catch {
    return undefined;
  }
};
