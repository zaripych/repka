/**
 * Capture the stack trace and allow to enrich exceptions thrown in asynchronous callbacks
 * with additional stack information captured at the moment of the call of this function
 */
export function captureStackTrace(remove = 0) {
  const stackContainer = {
    stack: '',
  };
  Error.captureStackTrace(stackContainer);
  const stackTrace = stackContainer.stack
    .split('\n')
    .slice(6 + remove)
    .join('\n');
  return {
    /**
     * Captured stack trace information
     */
    stackTrace,
    /**
     * Can be called in asynchronous callback to enrich exceptions with additional information
     * @param err Exception to enrich - it is going to have its `.stack` prop mutated
     * @returns Same exception
     */
    prepareForRethrow: (err: Error) => {
      const oldStackTrace = err.stack ?? ''.split('\n').slice(1).join('\n');
      err.stack = `${err.name || 'Error'}: ${
        err.message
      }\n${oldStackTrace}\n${stackTrace}`;
      return err;
    },
  };
}
