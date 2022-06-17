export function isTruthy<T>(
  value: NonNullable<T> | false | null | undefined | '' | 0
): value is NonNullable<T> {
  return Boolean(value);
}
