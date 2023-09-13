import type { PackageJsonExports } from '../package-json/packageJson';

export function isConditionsOnlyEntry(exports: PackageJsonExports): boolean {
  if (typeof exports !== 'object' || !exports) {
    return false;
  }

  const startsWithDot = Object.keys(exports).some((key) => key.startsWith('.'));

  return !startsWithDot;
}

export function resolvePackageJsonExportEntry(
  entry: PackageJsonExports,
  exportConditions: string[] = ['types', 'node', 'default']
): string | undefined {
  if (typeof entry === 'string') {
    return entry;
  }

  if (typeof entry !== 'object' || !entry) {
    return undefined;
  }

  const entries = Object.entries(entry);

  const conditionEntries = entries.filter(([key]) => !key.startsWith('.'));
  const nonConditions = entries.filter(([key]) => key.startsWith('.'));

  if (nonConditions.length > 0) {
    throw new Error(
      `Unexpected "exports" entry - found ${nonConditions
        .map(([key]) => `"${key}"`)
        .join(', ')} but expected only conditions, ie ` +
        `"types", "node", "browser", "default", ... etc. See ` +
        `https://nodejs.org/api/packages.html#conditional-exports for more ` +
        `information`
    );
  }

  for (const condition of exportConditions) {
    const result = conditionEntries.find(([key]) => key === condition);

    if (result) {
      const value = result[1];

      if (typeof value === 'string') {
        return value;
      }

      if (typeof value !== 'object' || !value) {
        return undefined;
      }

      return resolvePackageJsonExportEntry(value, exportConditions);
    }
  }

  return undefined;
}
