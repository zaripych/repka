import { red } from 'kleur/colors';
import { performance } from 'perf_hooks';

import { logger } from './logger/logger';
import { readCwdPackageJson } from './package-json/readPackageJson';
import type { TaskExecuteFn, TaskWatchFn } from './tasks/declareTask';
import type { AllTaskTypes } from './taskTypes';
import { allFulfilled } from './utils/allFullfilled';
import { enableSourceMapsSupport } from './utils/enableSourceMapsSupport';

type Task = AllTaskTypes | TaskExecuteFn<unknown>;

const postTaskNames: Array<AllTaskTypes['name']> = ['copy'];

const mainTaskNames: Array<AllTaskTypes['name']> = [
  'lint',
  'build',
  'test',
  'declarations',
  'integration',
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
  const isWatchMode = process.argv.includes('--watch');
  const start = performance.now();
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
          : await Promise.resolve<unknown>(task.execute?.());
      } catch (err) {
        logger.error(err);
        logger.error(
          red(
            `\nERROR: Failed to ${task.name || 'execute a task'} ${String(
              (await readCwdPackageJson()).name
            )} "${err instanceof Error ? err.message : String(err)}"`
          )
        );
        return Promise.reject(err);
      }
    };

    const watchTask = async (task: Task, state: unknown) => {
      try {
        if (typeof task === 'function') {
          return;
        }
        if (!task.watch) {
          return;
        }
        const watchFn = task.watch as TaskWatchFn<unknown>;
        return await Promise.resolve(watchFn(state));
      } catch (err) {
        logger.error(err);
        logger.error(
          red(
            `\nERROR: Failed to ${
              task.name || 'execute a task in watch mode'
            } ${String((await readCwdPackageJson()).name)} "${
              err instanceof Error ? err.message : String(err)
            }"`
          )
        );
        return Promise.reject(err);
      }
    };

    const mainAndCustom = await allFulfilled(
      [...main, ...custom].map(executeTask)
    );
    const postTasks = await allFulfilled(post.map(executeTask));

    if (isWatchMode) {
      await allFulfilled(
        [...main, ...custom, ...post].map((task, index) =>
          index < mainAndCustom.length
            ? watchTask(task, mainAndCustom[index])
            : watchTask(task, postTasks[index - mainAndCustom.length])
        )
      );
    }
  } catch (err) {
    if (typeof process.exitCode !== 'number') {
      process.exitCode = 1;
    }
  } finally {
    if (!isWatchMode) {
      const end = performance.now();
      const toSeconds = (value: number) => `${(value / 1000).toFixed(2)}s`;
      logger.log(`\nTask took ${toSeconds(end - start)}`);
    }
  }
}
