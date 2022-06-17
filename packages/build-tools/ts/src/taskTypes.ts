/* eslint-disable @typescript-eslint/consistent-type-imports */

import type { TaskOpts } from './tasks/declareTask';

type BivarianceHack<Args extends unknown[], Result> = {
  bivarianceHack(...args: Args): Result;
}['bivarianceHack'];

type TaskOf<T extends BivarianceHack<unknown[], TaskOpts<string, unknown>>> =
  ReturnType<T>;

type LintTask = TaskOf<typeof import('./lint').lint>;
type BuildForNodeTask = TaskOf<typeof import('./buildForNode').buildForNode>;
type UnitTestTask = TaskOf<typeof import('./unitTest').unitTest>;
type CopyTask = TaskOf<typeof import('./copy').copy>;

export type AllTaskTypes =
  | LintTask
  | BuildForNodeTask
  | UnitTestTask
  | CopyTask;
