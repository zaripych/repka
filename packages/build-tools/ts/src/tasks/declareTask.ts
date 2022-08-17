export type TaskOpts<Key extends string, Args, State> = {
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
  execute?: TaskExecuteFn<State>;

  /**
   * Function that executes the task in watch mode
   */
  watch?: TaskWatchFn<State>;
};

export type TaskExecuteFn<State> = () => Promise<State>;

export type TaskWatchFn<State> = (state: State) => Promise<unknown>;

export type BuiltTaskOpts<Key extends string, Args, State> = TaskOpts<
  Key,
  Args,
  State
>;

export function declareTask<Key extends string, Args, State>(
  opts: TaskOpts<Key, Args, State>
): BuiltTaskOpts<Key, Args, State> {
  return opts;
}
