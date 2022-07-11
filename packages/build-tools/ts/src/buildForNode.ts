/// <reference types="./@types/rollup-plugin-generate-package-json" />

import type { Plugin, RollupWatchOptions } from 'rollup';

import type { PackageConfigBuilder } from './config/loadNodePackageConfigs';
import { loadNodePackageConfigs } from './config/loadNodePackageConfigs';
import { rmrfDist } from './file-system/rmrfDist';
import { buildBinsBundleConfig } from './rollup/buildBinsBundleConfig';
import { rollupBuild } from './rollup/rollupBuild';
import { rollupPackageJsonPlugin } from './rollup/rollupPackageJsonPlugin';
import type {
  DefaultRollupConfigBuildOpts,
  RollupOptionsBuilder,
} from './rollup/standardRollupConfig';
import { combinePluginsProp } from './rollup/standardRollupConfig';
import { combineDefaultRollupConfigBuildOpts } from './rollup/standardRollupConfig';
import { defaultRollupConfig } from './rollup/standardRollupConfig';
import { declareTask } from './tasks/declareTask';
import { allFulfilled } from './utils/allFullfilled';

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

  /**
   * Entries in package.json "exports" represent inputs for Rollup.
   *
   * If you have a need fine tune configuration for entries defined
   * in package.json "exports" prop - you can do that in this callback.
   */
  buildExportsConfig?: RollupOptionsBuilder;

  /**
   * Entries in package.json "bin" need to be pre-bundled and included
   * as source code for normal operation during development.
   *
   * If you have a need to fine-tune configuration entries defined
   * in package.json "bin" prop - you can do that in this callback.
   */
  buildBinsConfig?: RollupOptionsBuilder;

  /**
   * If you have a need to bundle different entries with different
   * non-standard parameters, have a function here return those
   * configs
   */
  extraRollupConfigs?: RollupOptionsBuilder;

  /**
   * Rollup plugins to inject into every bundle config
   */
  plugins?: Plugin[];

  /**
   * Override core configuration options that are normally read from package.json
   */
  packageConfig?: PackageConfigBuilder;
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
      const config = await loadNodePackageConfigs(opts);

      await rmrfDist();

      const { entryPoints } = config;

      const allExternals = externalsFromDependencies(config.dependencies, opts);
      const baseOpts: DefaultRollupConfigBuildOpts = {
        external: allExternals,
        resolveId: opts?.resolveId,
        plugins: opts?.plugins,
      };

      const defaultConfig = (opts?: DefaultRollupConfigBuildOpts) =>
        defaultRollupConfig(
          combineDefaultRollupConfigBuildOpts(baseOpts, opts)
        );

      const { binConfigs, bundledEsmBinsInputs } = buildBinsBundleConfig({
        config,
        defaultRollupConfig: defaultConfig,
      });

      const extraConfigs = opts?.extraRollupConfigs
        ? await Promise.resolve(
            opts.extraRollupConfigs({
              config,
              defaultRollupConfig: defaultConfig,
            })
          )
        : [];

      const buildExportsConfig = (
        opts?: DefaultRollupConfigBuildOpts
      ): RollupWatchOptions => {
        const config = defaultConfig(opts);
        return {
          ...config,
          input: {
            ...Object.fromEntries(
              Object.values(entryPoints).map(
                ({ chunkName: name, sourcePath: value }) =>
                  [name, value] as const
              )
            ),
            ...bundledEsmBinsInputs,
          },
          output: {
            ...config.output,
            dir: './dist/dist',
          },
          ...combinePluginsProp(config.plugins, [
            rollupPackageJsonPlugin({
              outDir: './dist',
              entryPoints,
              externals: allExternals,
            }),
          ]),
        };
      };

      const exportsConfig = opts?.buildExportsConfig
        ? await Promise.resolve(
            opts.buildExportsConfig({
              config,
              defaultRollupConfig: buildExportsConfig,
            })
          )
        : [buildExportsConfig()];

      await allFulfilled(
        [...exportsConfig, ...binConfigs, ...extraConfigs].map((config) =>
          rollupBuild(config)
        )
      );
    },
  });
}
