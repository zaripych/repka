/// <reference types="../@types/rollup-plugin-generate-package-json.js" />

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import type { InputOption, Plugin, RollupWatchOptions } from 'rollup';
import analyze from 'rollup-plugin-analyzer';

import { readCwdPackageJson } from '../package-json/readPackageJson';
import { validatePackageJson } from '../package-json/validatePackageJson';
import { resolveNodeBuiltinsPlugin } from './resolveNodeBuiltinsPlugin';
import { esbuild } from './rollupPluginEsbuild';
import { extensions } from './rollupPluginExtensions';

export type BespokeBuildOpts = {
  outDir: string;
  input: InputOption;
  externals?: string[];
  resolveId?: (
    id: string,
    importer?: string
  ) => ReturnType<NonNullable<Plugin['resolveId']>>;
  /**
   * https://esbuild.github.io/api/#minify
   */
  minify?: boolean;
  sourcemap?: boolean | 'inline' | 'hidden';
};

const plugins = (opts: BespokeBuildOpts) => {
  const resolveIdFn = opts.resolveId;
  return [
    resolveIdFn && {
      name: 'rollupNodeConfig:resolveId',
      async resolveId(id: string, importer?: string) {
        return await Promise.resolve(resolveIdFn(id, importer));
      },
    },
    resolveNodeBuiltinsPlugin(),
    resolve(),
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
      minify: opts.minify ?? true,
      format: 'esm',
      loader: 'tsx',
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
    analyze({
      summaryOnly: true,
      limit: 5,
    }),
  ];
};

const buildExternals = async (opts: BespokeBuildOpts) => {
  const packageJson = validatePackageJson(await readCwdPackageJson());
  const dependencies = Object.keys(packageJson.dependencies || {});
  return [...new Set([...dependencies, ...(opts.externals || [])])];
};

export async function rollupNodeConfig(opts: BespokeBuildOpts) {
  const config: RollupWatchOptions = {
    input: opts.input,
    plugins: plugins(opts),
    external: await buildExternals(opts),
    output: {
      dir: opts.outDir,
      sourcemap: opts.sourcemap ?? 'inline',
      chunkFileNames: `chunk.[hash].js`,
      entryFileNames: `[name].[format].js`,
      format: 'es',
    },
    watch: {
      clearScreen: false,
    },
  };
  return config;
}
