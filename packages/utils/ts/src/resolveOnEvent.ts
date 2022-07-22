type EventEmitter = {
  once(event: string, listener: (arg: unknown) => void): void;
};

type EventResult<T extends EventEmitter> = Parameters<
  Parameters<T['once']>[1]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
> extends any[]
  ? unknown[]
  : Parameters<Parameters<T['once']>[1]>[0];

export function resolveOnEvent<T extends EventEmitter>({
  emitter,
  event,
}: {
  emitter: T;
  event: Parameters<T['once']>[0];
}): Promise<EventResult<T>> {
  const result = new Promise<unknown>((res, _rej) => {
    emitter.once(event, res);
  });
  return result as Promise<EventResult<T>>;
}
