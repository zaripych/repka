/// <reference types="./@types/rollup-plugin-generate-package-json" />

import type { Plugin } from 'rollup';

import { rmrfDist } from './file-system/rmrfDist';
import { parseEntryPoints } from './package-json/parseEntryPoints';
import { readCwdPackageJson } from './package-json/readPackageJson';
import { validatePackageJson } from './package-json/validatePackageJson';
import { rollupBuild } from './rollup/rollupBuild';
import { rollupNodeConfig } from './rollup/rollupNodeConfig';
import { rollupPackageJsonPlugin } from './rollup/rollupPackageJsonPlugin';
import { declareTask } from './tasks/declareTask';

export type BuildOpts = {
  /**
   * Extra externals which are not listed in dependencies or those
   * listed which are not explicitly referenced in the code
   */
  externals?: string[];

  /**
   * Module resolution function, in case you have weird dependencies
   * that do not resolve on their own, have them setup here
   */
  resolveId?: (
    id: string,
    importer?: string
  ) => ReturnType<NonNullable<Plugin['resolveId']>>;
};

const externalsFromDependencies = (
  dependenciesParam?: Record<string, string>,
  opts?: BuildOpts
) => {
  const dependencies = Object.keys(dependenciesParam || {});
  return [...new Set([...dependencies, ...(opts?.externals || [])])];
};

export function buildForNode(opts?: BuildOpts) {
  return declareTask({
    name: 'build',
    args: opts,
    execute: async () => {
      const packageJson = validatePackageJson(await readCwdPackageJson());

      await rmrfDist();

      const entryPoints = parseEntryPoints(packageJson.exports);

      const allExternals = externalsFromDependencies(
        packageJson.dependencies,
        opts
      );

      const baseConfig = await rollupNodeConfig({
        outDir: './dist/dist',
        input: Object.fromEntries(
          Object.values(entryPoints).map(({ name, value }) => [name, value])
        ),
        externals: allExternals,
        resolveId: opts?.resolveId,
      });
      const configWithExtraPlugin = {
        ...baseConfig,
        plugins: [
          ...(baseConfig.plugins || []),
          rollupPackageJsonPlugin({
            outDir: './dist',
            entryPoints,
            externals: allExternals,
          }),
        ],
      };
      await rollupBuild(configWithExtraPlugin);
    },
  });
}
