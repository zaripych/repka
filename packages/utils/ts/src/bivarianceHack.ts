export type BivarianceHack<Args extends unknown[], Result> = {
  bivarianceHack(...args: Args): Result;
}['bivarianceHack'];
