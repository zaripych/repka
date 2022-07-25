export function isTruthy<T>(
  value: NonNullable<T> | false | null | undefined | '' | 0
): value is NonNullable<T> {
  return Boolean(value);
}

export function filterTruthy<
  Arr extends Array<unknown | false | null | undefined | '' | 0>,
  ReturnType = Arr extends Array<infer T | false | null | undefined | '' | 0>
    ? NonNullable<T>[]
    : Arr
>(array: Arr): ReturnType {
  return array.filter(isTruthy) as unknown as ReturnType;
}
