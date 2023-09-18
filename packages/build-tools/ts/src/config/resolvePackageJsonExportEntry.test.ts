import {
  isConditionsOnlyEntry,
  resolvePackageJsonExportEntry,
} from './resolvePackageJsonExportEntry';

it('should work with string', () => {
  expect(resolvePackageJsonExportEntry('./index.ts')).toBe('./index.ts');
});

it('should work with null', () => {
  expect(resolvePackageJsonExportEntry(null)).toBe(undefined);
});

it('should return undefined for empty objects', () => {
  expect(resolvePackageJsonExportEntry({})).toBe(undefined);
});

it('should throw with non-condition objects', () => {
  expect(() =>
    resolvePackageJsonExportEntry({
      './mod.js': './mod.ts',
    })
  ).toThrowErrorMatchingInlineSnapshot(
    `"Unexpected "exports" entry - found "./mod.js" but expected only conditions, ie "types", "node", "browser", "default", ... etc. See https://nodejs.org/api/packages.html#conditional-exports for more information"`
  );
});

it('should resolve first-level conditions', () => {
  expect(
    resolvePackageJsonExportEntry(
      {
        types: './index.d.ts',
      },
      ['types']
    )
  ).toBe('./index.d.ts');
});

it('should resolve first-level conditions when multiple present', () => {
  expect(
    resolvePackageJsonExportEntry(
      {
        node: './index.node.js',
        types: './index.d.ts',
      },
      ['types']
    )
  ).toBe('./index.d.ts');
});

it('should not-resolve second-level conditions when first-level did not match', () => {
  expect(
    resolvePackageJsonExportEntry(
      {
        node: {
          types: './index.d.ts',
          default: './index.node.js',
        },
      },
      ['types']
    )
  ).toBe(undefined);
});

it('should resolve second-level conditions when multiple present', () => {
  expect(
    resolvePackageJsonExportEntry(
      {
        node: {
          types: './index.d.ts',
          default: './index.node.js',
        },
      },
      ['node', 'types']
    )
  ).toBe('./index.d.ts');
});

it('should detect conditions-only entries', () => {
  expect(
    isConditionsOnlyEntry({
      node: {
        types: './index.d.ts',
        default: './index.node.js',
      },
    })
  ).toBe(true);
});

it('should detect non-conditions entries', () => {
  expect(
    isConditionsOnlyEntry({
      '.': {
        types: './index.d.ts',
        default: './index.js',
      },
    })
  ).toBe(false);
});
