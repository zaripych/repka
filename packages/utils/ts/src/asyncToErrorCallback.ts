export function asyncToErrorCallback<
  R,
  RR,
  T extends (result: R) => Promise<RR>
>(asyncTask: T, onPromiseCreated: (promise: Promise<RR>) => void) {
  return (error: Error | null | undefined, result: R) => {
    if (error) {
      onPromiseCreated(Promise.reject(error));
    } else {
      onPromiseCreated(asyncTask(result));
    }
  };
}
