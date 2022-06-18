import pico from 'picocolors';

import { readCwdPackageJson } from './package-json/readPackageJson';
import type { TaskExecuteFn } from './tasks/declareTask';
import type { AllTaskTypes } from './taskTypes';
import { allFulfilled } from './utils/allFullfilled';
import { enableSourceMapsSupport } from './utils/enableSourceMapsSupport';

type Task = AllTaskTypes | TaskExecuteFn;

const postTaskNames: Array<AllTaskTypes['name']> = ['copy'];

const mainTaskNames: Array<AllTaskTypes['name']> = [
  'lint',
  'build',
  'test',
  'declarations',
];

/**
 * Declare how your package is linted, built, bundled and published
 * by specifying task parameters specific to your package.
 *
 * The order of execution of tasks is bespoke and depends on the task.
 *
 * Some tasks also accept parameters from process.argv, for example
 * `lint` or `test` allow you to specify which files need linting or
 * testing. Use `--help` parameter to determine what is possible.
 */
export async function pipeline<Args extends [Task, ...Task[]]>(
  ...tasks: Args
): Promise<void> {
  try {
    enableSourceMapsSupport();

    const { custom, main, post } = tasks.reduce<{
      custom: Task[];
      main: Task[];
      post: Task[];
    }>(
      (acc, task) => {
        if (typeof task === 'function') {
          acc.custom.push(task);
          return acc;
        }
        if (mainTaskNames.includes(task.name)) {
          acc.main.push(task);
          return acc;
        }
        if (postTaskNames.includes(task.name)) {
          acc.post.push(task);
          return acc;
        }
        return acc;
      },
      {
        custom: [],
        main: [],
        post: [],
      }
    );

    const executeTask = async (task: Task) => {
      try {
        return typeof task === 'function'
          ? await task()
          : await Promise.resolve(task.execute?.());
      } catch (err) {
        console.error(err);
        console.error(
          pico.red(
            `\nERROR: Failed to ${task.name || 'execute a task'} ${String(
              (await readCwdPackageJson()).name
            )} "${err instanceof Error ? err.message : String(err)}"`
          )
        );
        return Promise.reject(err);
      }
    };

    await allFulfilled([...main, ...custom].map(executeTask));
    await allFulfilled(post.map(executeTask));
  } catch (err) {
    if (typeof process.exitCode !== 'number') {
      process.exitCode = 1;
    }
  }
}
