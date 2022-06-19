import replace from '@rollup/plugin-replace';
import virtual from '@rollup/plugin-virtual';

import { escapeRegExp } from '../utils/escapeRegExp';

// TODO: Move this out to dts-bundle-generator plugin once we solve
// circular dependency problem
export function dtsBundleGeneratorBuildPlugins() {
  const replaceEnvPrefix = replace({
    include: [new RegExp('.*' + escapeRegExp('/dts-bundle-generator/') + '.*')],
    values: {
      [`#!/usr/bin/env node`]: '',
    },
    delimiters: ['', ''],
    preventAssignment: true,
  });

  // TODO: check if still needed
  // we should not be using require in .mjs
  const mockDtsBundleGeneratorPackageJsonVersion = virtual({
    [new URL(
      `../../../dts-bundle-generator/dist/helpers/package-version.js`,
      import.meta.url
    ).pathname]: `export function packageVersion() { return 'custom'; }`,
  });

  return [replaceEnvPrefix, mockDtsBundleGeneratorPackageJsonVersion];
}
