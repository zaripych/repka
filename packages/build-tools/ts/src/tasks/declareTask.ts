export type TaskOpts<Key extends string, Args> = {
  /**
   * A key identifying task options
   */
  name: Key;
  /**
   * Arguments passed by user to task options function
   */
  args: Args;

  /**
   * Function that executes the task
   */
  execute?: TaskExecuteFn;
};

export type TaskExecuteFn = () => Promise<unknown>;

export type BuiltTaskOpts<Key extends string, Args> = TaskOpts<Key, Args>;

export function declareTask<Key extends string, Args>(
  opts: TaskOpts<Key, Args>
): BuiltTaskOpts<Key, Args> {
  return opts;
}
