export function hasOne<T>(arr: Array<T>): arr is [T, ...T[]] {
  return arr.length > 0;
}

export function ensureHasOne<T>(arr?: Array<T>): [T, ...T[]] {
  if (!arr || !hasOne(arr)) {
    throw new Error(`Expected at least one element, found none`);
  }
  return arr;
}
