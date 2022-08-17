import type { RollupWatchOptions } from 'rollup';
import { watch } from 'rollup';

export async function rollupWatch(configs: RollupWatchOptions[]) {
  const tasks: Set<Promise<void>> = new Set();

  const addTask = (task: Promise<void>) => {
    const promise = task.finally(() => {
      tasks.delete(promise);
    });
    tasks.add(promise);
  };

  const watcher = watch(configs);

  watcher.on('event', (ev) => {
    if (ev.code === 'BUNDLE_END') {
      addTask(ev.result.close());
    }
    if (ev.code === 'ERROR' && ev.result) {
      addTask(ev.result.close());
    }
  });
  try {
    process.on('SIGINT', () => {
      addTask(watcher.close());
    });
    await new Promise<void>((res) => {
      watcher.once('close', res);
    });
    await Promise.all([...tasks]);
  } finally {
    await watcher.close();
  }
}
