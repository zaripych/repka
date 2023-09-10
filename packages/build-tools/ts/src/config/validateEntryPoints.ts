import { logger } from '../logger/logger';
import type { PackageJsonExports } from '../package-json/packageJson';
import type { PackageExportsEntryPoint } from './nodePackageConfig';
import {
  isConditionsOnlyEntry,
  resolvePackageJsonExportEntry,
} from './resolvePackageJsonExportEntry';

const determineName = (key = 'main') => {
  return key === '.'
    ? 'main'
    : key
        .replace(/(^\.\/)/, '')
        .replace(/(\/(\*)?$)/, '')
        .replace('*', '')
        .replace('/', '_');
};

const resolveEntryPoints = (
  results: Record<string, PackageExportsEntryPoint>,
  ignored: Record<string, PackageJsonExports>,
  exportEntry: PackageJsonExports,
  entryPoint?: string
): void => {
  const chunkName = determineName(entryPoint);
  if (chunkName in results) {
    return;
  }

  if (typeof exportEntry === 'string') {
    results[chunkName] = {
      entryPoint: entryPoint || '.',
      sourcePath: exportEntry,
      chunkName,
    };
    return;
  }

  console.log(entryPoint);

  if (exportEntry === null || typeof exportEntry !== 'object') {
    throw new Error(
      `Expected "string" or "object" as exports entry - got "${String(
        exportEntry
      )}"`
    );
  }

  if (isConditionsOnlyEntry(exportEntry)) {
    const result = resolvePackageJsonExportEntry(exportEntry);
    if (!result) {
      if (entryPoint) {
        logger.warn(
          `cannot resolve "exports" entry with key "${entryPoint}" - ignoring`
        );
      } else {
        logger.warn(`cannot resolve "exports" entries`);
      }
    } else {
      results[chunkName] = {
        entryPoint: entryPoint || '.',
        sourcePath: result,
        chunkName,
      };
    }
  } else {
    for (const [key, entry] of Object.entries(exportEntry)) {
      if (!entry) {
        ignored[key] = entry;
        continue;
      }

      resolveEntryPoints(results, ignored, entry as PackageJsonExports, key);
    }
  }
};

export function validateEntryPoints(exportEntry: PackageJsonExports) {
  const results: Record<string, PackageExportsEntryPoint> = {};
  const ignoredEntryPoints: Record<string, PackageJsonExports> = {};

  resolveEntryPoints(results, ignoredEntryPoints, exportEntry);

  return {
    entryPoints: Object.values(results),
    ignoredEntryPoints,
  };
}
