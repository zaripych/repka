import type { PackageJsonExports } from '../package-json/packageJson';
import type { PackageExportsEntryPoint } from './nodePackageConfig';

const determineName = (key = 'main') => {
  return key === '.'
    ? 'main'
    : key
        .replace(/(^\.\/)/, '')
        .replace(/(\/(\*)?$)/, '')
        .replace('*', '')
        .replace('/', '_');
};

// TODO: This doesn't support globs yet
const resolveEntryPointsNoConditions = (
  results: Record<string, PackageExportsEntryPoint>,
  exports: PackageJsonExports,
  entryPoint?: string
): void => {
  const chunkName = determineName(entryPoint);
  if (chunkName in results) {
    return;
  }

  if (typeof exports === 'string') {
    results[chunkName] = {
      entryPoint: entryPoint || '.',
      sourcePath: exports,
      chunkName,
    };
    return;
  }

  for (const [key, entry] of Object.entries(exports)) {
    if (!entry) {
      continue;
    }
    if (!key.startsWith('.')) {
      const expected = key
        .replaceAll('*', '')
        .replaceAll(/^\.?\//g, '')
        .replaceAll(/\/$/g, '');
      throw new Error(
        `"exports" in package.json doesn't support conditions/flavors - found "${key}", expected something like "./${
          expected === '' ? 'something' : expected
        }" or "."`
      );
    }
    if (key.includes('*')) {
      const expected = key
        .replaceAll('*', '')
        .replaceAll(/^\.?\//g, '')
        .replaceAll(/\/$/g, '');
      throw new Error(
        `"exports" in package.json doesn't support globs yet - found "${key}", expected something like "./${
          expected === '' ? 'something' : expected
        }"`
      );
    } else {
      resolveEntryPointsNoConditions(results, entry, key);
    }
  }
};

export function validateEntryPoints(
  exports: PackageJsonExports
): Record<string, PackageExportsEntryPoint> {
  const results: Record<string, PackageExportsEntryPoint> = {};
  resolveEntryPointsNoConditions(results, exports);
  return results;
}
