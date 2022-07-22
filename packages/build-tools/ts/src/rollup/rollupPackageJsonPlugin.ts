/// <reference types="../@types/rollup-plugin-generate-package-json.js" />

import generatePackageJsonPlugin from 'rollup-plugin-generate-package-json';

import type { PackageExportsEntryPoint } from '../config/nodePackageConfig';
import type { JsonType, PackageJsonExports } from '../package-json/packageJson';
import { transformPackageJson } from './transformPackageJson';

export type PackageJsonOpts = {
  outDir: string;
  entryPoints: Array<PackageExportsEntryPoint>;
  ignoredEntryPoints: Record<string, PackageJsonExports>;
  externals?: string[];
  packageJson?: (
    packageJson: Record<string, JsonType>
  ) => Record<string, JsonType>;
};

export const rollupPackageJsonPlugin = (opts: PackageJsonOpts) => {
  return generatePackageJsonPlugin({
    additionalDependencies: opts.externals,
    outputFolder: opts.outDir,
    baseContents: (packageJson) => {
      const result = transformPackageJson({
        entryPoints: opts.entryPoints,
        ignoredEntryPoints: opts.ignoredEntryPoints,
      })(packageJson);
      return opts.packageJson ? opts.packageJson(result) : result;
    },
  });
};
