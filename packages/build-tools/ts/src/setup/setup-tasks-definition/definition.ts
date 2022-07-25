import type { createTasksApi } from './tasksApi';

export type TasksApi = ReturnType<typeof createTasksApi>;

export type TaskDefinition = {
  name: string;
  description: string;
  optional: boolean;

  shouldExecute?: (api: TasksApi) => Promise<boolean>;

  execute: (api: TasksApi) => Promise<void>;
};
