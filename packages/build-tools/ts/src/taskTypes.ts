/* eslint-disable @typescript-eslint/consistent-type-imports */

import type { TaskOpts } from './tasks/declareTask';
import { BivarianceHack } from './utils/bivarianceHack';

type TaskOf<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends BivarianceHack<unknown[], TaskOpts<string, unknown, any>>
> = ReturnType<T>;

type LintTask = TaskOf<typeof import('./lint').lint>;
type BuildForNodeTask = TaskOf<typeof import('./buildForNode').buildForNode>;
type UnitTestTask = TaskOf<typeof import('./unitTest').unitTest>;
type IntegrationTestTask = TaskOf<
  typeof import('./integrationTest').integrationTest
>;
type DeclarationsTask = TaskOf<typeof import('./declarations').declarations>;
type CopyTask = TaskOf<typeof import('./copy').copy>;

export type AllTaskTypes =
  | LintTask
  | BuildForNodeTask
  | UnitTestTask
  | IntegrationTestTask
  | DeclarationsTask
  | CopyTask;

export const taskTypes: Array<AllTaskTypes['name']> = [
  'build',
  'copy',
  'declarations',
  'integration',
  'lint',
  'test',
];
