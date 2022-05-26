import type { PackageJsonExports } from './packageJson';

const resolveEntryPointsNoConditions = (
  results: Map<string, string>,
  exports: PackageJsonExports,
  nameParam?: string
): void => {
  // determine name of the entry point which is used
  // for the file name we want to use for the output
  const determineName = (name = 'main') => {
    return name === '.'
      ? 'main'
      : name
          .replace(/(^\.\/)/, '')
          .replace(/(\/(\*)?$)/, '')
          .replace('*', '')
          .replace('/', '_');
  };

  const name = determineName(nameParam);
  if (results.has(name)) {
    return;
  }

  if (typeof exports === 'string') {
    results.set(name, exports);
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

export const resolveNodeEntryPoints = (
  exports: PackageJsonExports
): Array<{ name: string; entryPoint: string }> => {
  const results = new Map<string, string>();
  resolveEntryPointsNoConditions(results, exports);
  return [...results.entries()].map(([key, value]) => ({
    name: key,
    entryPoint: value,
  }));
};
