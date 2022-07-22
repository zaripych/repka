type EventEmitter = {
  once(event: string, listener: (arg: unknown) => void): void;
};

type EventResult<T extends EventEmitter> = Parameters<
  Parameters<T['once']>[1]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
> extends any[]
  ? unknown[]
  : Parameters<Parameters<T['once']>[1]>[0];

export function promiseFromEvents<T extends EventEmitter>({
  emitter,
  resolveEvent,
  rejectEvent,
}: {
  emitter: T;
  resolveEvent: Parameters<T['once']>[0];
  rejectEvent: Parameters<T['once']>[0];
}): Promise<EventResult<T>> {
  const result = new Promise<unknown>((res, rej) => {
    emitter.once(resolveEvent, res);
    emitter.once(rejectEvent, rej);
  });
  return result as Promise<EventResult<T>>;
}
