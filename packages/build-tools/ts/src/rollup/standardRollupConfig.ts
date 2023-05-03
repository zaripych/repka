/// <reference types="../@types/rollup-plugin-generate-package-json.js" />

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import { isTruthy } from '@utils/ts';
import type {
  InputPluginOption,
  Plugin,
  ResolveIdHook,
  RollupWatchOptions,
} from 'rollup';
import analyze from 'rollup-plugin-analyzer';

import type { NodePackageConfig } from '../config/nodePackageConfig';
import { resolveNodeBuiltinsPlugin } from './resolveNodeBuiltinsPlugin';
import { esbuild } from './rollupPluginEsbuild';
import { extensions } from './rollupPluginExtensions';

export type DefaultRollupConfigBuildOpts = {
  external?: string[];
  resolveId?: ResolveIdHook;
  plugins?: InputPluginOption;
  /**
   * https://esbuild.github.io/api/#minify
   */
  minify?: boolean;
  analyze?: boolean;
};

export type RollupOptionsBuilder = (
  opts: RollupOptionsBuilderOpts
) => Promise<RollupWatchOptions[]> | RollupWatchOptions[];

export type RollupOptionsBuilderOpts = {
  config: NodePackageConfig;
  defaultRollupConfig: (
    opts?: DefaultRollupConfigBuildOpts
  ) => RollupWatchOptions;
};

type FalsyMix<T> = NonNullable<T> | null | false | undefined;

function combineArrays<K extends string, T>(
  key: K,
  before?: FalsyMix<T>[],
  after?: FalsyMix<T>[]
): { [P in K]?: NonNullable<T>[] } {
  if (!before && !after) {
    return {};
  }
  return {
    ...((before || after) && {
      [key]: [...(before ? before : []), ...(after ? after : [])].filter(
        isTruthy
      ),
    }),
  } as { [P in K]?: NonNullable<T>[] };
}

export const combineExternalProp = (before?: string[], after?: string[]) =>
  combineArrays('external', before, after);

export const combinePluginsProp = (
  before?: InputPluginOption,
  after?: InputPluginOption
) => combineInputPluginsOptionsProp(before, after);

export const combineInputPluginsOptionsProp = (
  before?: InputPluginOption,
  after?: InputPluginOption
): { plugins: InputPluginOption } => {
  return {
    plugins: [before, after],
  };
};

export function combineDefaultRollupConfigBuildOpts(
  before: DefaultRollupConfigBuildOpts,
  after?: DefaultRollupConfigBuildOpts
): DefaultRollupConfigBuildOpts {
  if (before === after) {
    return before;
  }
  return {
    ...before,
    ...after,
    ...combineExternalProp(before.external, after?.external),
    ...combineInputPluginsOptionsProp(before.plugins, after?.plugins),
  };
}

export function defaultRollupConfig(opts?: DefaultRollupConfigBuildOpts) {
  const config: RollupWatchOptions = {
    plugins: plugins(opts),
    external: opts?.external ? opts.external : [],
    output: {
      sourcemap: 'inline',
      chunkFileNames: `chunk.[hash].js`,
      entryFileNames: `[name].js`,
      format: 'esm',
    },
  };
  return config;
}

export const declareRollupPlugin = (plugin: Plugin) => plugin;

const plugins = (opts?: DefaultRollupConfigBuildOpts): InputPluginOption => {
  const resolveIdFn = opts?.resolveId;
  return [
    opts?.plugins,
    resolveIdFn &&
      declareRollupPlugin({
        name: 'rollupNodeConfig:resolveId',
        async resolveId(this, id, importer, options) {
          return await Promise.resolve(
            resolveIdFn.bind(this)(id, importer, options)
          );
        },
      }),
    resolveNodeBuiltinsPlugin(),
    resolve({
      exportConditions: ['node'],
    }),
    commonjs({
      ignoreTryCatch: true,
    }),
    json(),
    extensions({
      extensions: ['.ts', '.tsx'],
    }),
    esbuild({
      target: 'node16',
      sourcemap: true,
      minify: opts?.minify ?? false,
      format: 'esm',
      loader: 'tsx',
      include: ['**/*.tsx'],
    }),
    esbuild({
      target: 'node16',
      sourcemap: true,
      minify: opts?.minify ?? false,
      format: 'esm',
      loader: 'ts',
      include: ['**/*.ts'],
    }),
    // swc({
    //   module: {
    //     type: 'es6',
    //   },
    //   jsc: {
    //     parser: {
    //       syntax: 'typescript',
    //     },
    //     target: 'es2022',
    //   },
    //   sourceMaps: true,
    //   minify: true,
    // }),
    opts?.analyze &&
      analyze({
        summaryOnly: true,
        limit: 5,
      }),
  ];
};
