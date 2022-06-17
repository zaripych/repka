/// <reference types="../@types/rollup-plugin-generate-package-json.js" />

import generatePackageJsonPlugin from 'rollup-plugin-generate-package-json';

import type { JsonType } from '../package-json/packageJson';
import type { PackageExportsEntryPoint } from '../package-json/parseEntryPoints';
import { transformPackageJson } from './transformPackageJson';

export type PackageJsonOpts = {
  outDir: string;
  entryPoints: Record<string, PackageExportsEntryPoint>;
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
      const result = transformPackageJson(opts.entryPoints)(packageJson);
      return opts.packageJson ? opts.packageJson(result) : result;
    },
  });
};
