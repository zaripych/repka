import type { createTasksApi } from './tasksApi';

export type TasksApi = ReturnType<typeof createTasksApi>;

export type TaskDefinition = {
  name: string;
  description: string;

  shouldExecute?: (api: TasksApi) => Promise<boolean>;

  execute: (api: TasksApi) => Promise<void>;
};

export function taskFactory<Fn extends (...args: never[]) => TaskDefinition>(
  fn: Fn
) {
  return fn;
}
