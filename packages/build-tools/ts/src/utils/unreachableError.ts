export class UnreachableError extends Error {
  constructor(value: never) {
    super(`${String(value)} is not handled`);
    Error.captureStackTrace(this, UnreachableError);
    this.name = 'UnreachableError';
  }
}
