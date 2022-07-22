import { logger } from '../logger/logger';
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
  ignored: Record<string, PackageJsonExports>,
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

  if (exports === null || typeof exports !== 'object') {
    throw new Error(
      `Expected "string" or "object" as exports entry - got "${String(
        exports
      )}"`
    );
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

      logger.warn(
        `"exports" in package.json doesn't support conditions/flavors - found "${key}", expected something like "./${
          expected === '' ? 'something' : expected
        }" or "."`
      );

      if (entryPoint) {
        ignored[entryPoint] = exports;
      } else {
        ignored[key] = entry;
      }
    } else if (key.includes('*')) {
      const expected = key
        .replaceAll('*', '')
        .replaceAll(/^\.?\//g, '')
        .replaceAll(/\/$/g, '');

      logger.warn(
        `"exports" in package.json doesn't support globs yet - found "${key}", expected something like "./${
          expected === '' ? 'something' : expected
        }"`
      );

      if (entryPoint) {
        ignored[entryPoint] = exports;
      } else {
        ignored[key] = entry;
      }
    } else {
      resolveEntryPointsNoConditions(results, ignored, entry, key);
    }
  }
};

export function validateEntryPoints(exports: PackageJsonExports) {
  const results: Record<string, PackageExportsEntryPoint> = {};
  const ignored: Record<string, PackageJsonExports> = {};
  resolveEntryPointsNoConditions(results, ignored, exports);
  return {
    entryPoints: Object.values(results),
    ignored,
  };
}
