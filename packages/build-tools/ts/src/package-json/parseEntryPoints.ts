import type { PackageJsonExports } from './packageJson';

const determineName = (key = 'main') => {
  return key === '.'
    ? 'main'
    : key
        .replace(/(^\.\/)/, '')
        .replace(/(\/(\*)?$)/, '')
        .replace('*', '')
        .replace('/', '_');
};

const resolveEntryPointsNoConditions = (
  results: Record<string, PackageExportsEntryPoint>,
  exports: PackageJsonExports,
  key?: string
): void => {
  const name = determineName(key);
  if (name in results) {
    return;
  }

  if (typeof exports === 'string') {
    results[name] = {
      key: key || '.',
      value: exports,
      name,
    };
    return;
  }

  for (const [key, entry] of Object.entries(exports)) {
    if (!entry) {
      continue;
    }
    if (!key.startsWith('.')) {
      throw new Error(
        `"exports" in package.json doesn't support conditions/flavors - found "${key}", expected something like "./${key}"`
      );
    } else {
      resolveEntryPointsNoConditions(results, entry, key);
    }
  }
};

/**
 * Represents single entry from package.json exports object
 *
 * ```json
 *   ".": "./src/index.ts",
 *   "./feature/*": "./src/feature/index.ts"
 * ```
 * Contains 2 entries, where `"."` and "./feature/*" - are keys,
 * `"./src/index.ts"`, "./src/feature/index.ts" etc. - are values.
 */
export type PackageExportsEntryPoint = {
  /**
   * Export path pattern
   */
  key: string;
  /**
   * Path to the module this entry point represents
   */
  value: string;
  /**
   * Chunk name generated from the key
   */
  name: string;
};

export const parseEntryPoints = (
  exports: PackageJsonExports
): Record<string, PackageExportsEntryPoint> => {
  const results: Record<string, PackageExportsEntryPoint> = {};
  resolveEntryPointsNoConditions(results, exports);
  return results;
};
