import replace from '@rollup/plugin-replace';
import virtual from '@rollup/plugin-virtual';
import { escapeRegExp } from '@utils/ts';
import type { Plugin } from 'rollup';

export function dtsBundleGeneratorBuildPlugins(): Plugin[] {
  const bundleGenerator = new RegExp(
    '.*' + escapeRegExp('/dts-bundle-generator/') + '.*'
  );
  const replaceEnvPrefix = replace({
    include: [bundleGenerator],
    values: {
      [`#!/usr/bin/env node`]: '',
    },
    delimiters: ['', ''],
    preventAssignment: true,
  });
  const mockDtsBundleGeneratorPackageJsonVersion = virtual({
    [new URL(`../sub-repo/src/helpers/package-version`, import.meta.url)
      .pathname]: `export function packageVersion() { return 'custom'; }`,
  });
  return [
    {
      name: 'resolve:dts-bundle-generator',
      async resolveId(source, importer) {
        if (importer && bundleGenerator.test(importer)) {
          if (source === 'yargs') {
            const result = await this.resolve(source, importer, {
              skipSelf: true,
              custom: { 'node-resolve': { isRequire: true } },
            });
            return result;
          }
        }
        return null;
      },
    },
    replaceEnvPrefix,
    mockDtsBundleGeneratorPackageJsonVersion,
  ];
}
