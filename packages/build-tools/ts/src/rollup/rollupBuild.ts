/// <reference types="../@types/rollup-plugin-generate-package-json" />

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import type { Plugin } from 'rollup';
import { rollup } from 'rollup';
import analyze from 'rollup-plugin-analyzer';
import esbuild from 'rollup-plugin-esbuild';
import generatePackageJsonPlugin from 'rollup-plugin-generate-package-json';

import type { JsonType } from '../package-json/packageJson';
import type { PackageExportsEntryPoint } from '../package-json/resolveEntryPoints';
import { resolveNodeBuiltinsPlugin } from './resolveNodeBuiltinsPlugin';
import { transformPackageJson } from './transformPackageJson';

export type BuildOpts = {
  entryPoints: Record<string, PackageExportsEntryPoint>;
  externals?: string[];
  resolveId?: (
    id: string,
    importer?: string
  ) => ReturnType<NonNullable<Plugin['resolveId']>>;
  packageJson?: (
    packageJson: Record<string, JsonType>
  ) => Record<string, JsonType>;
};

const plugins = () => [
  resolve(),
  commonjs({
    ignoreTryCatch: true,
  }),
  json(),
  esbuild({
    target: 'node16',
    minify: true,
  }),
  analyze({
    summaryOnly: true,
    limit: 5,
  }),
];

const customPlugins = (opts: BuildOpts) => {
  const resolveIdFn = opts.resolveId;
  return [
    resolveIdFn && {
      name: 'buildForNode:resolveId',
      async resolveId(id: string, importer?: string) {
        return await Promise.resolve(resolveIdFn(id, importer));
      },
    },
    resolveNodeBuiltinsPlugin(),
    generatePackageJsonPlugin({
      additionalDependencies: opts.externals,
      outputFolder: './dist',
      baseContents: (packageJson) => {
        const result = transformPackageJson(opts.entryPoints)(packageJson);
        return opts.packageJson ? opts.packageJson(result) : result;
      },
    }),
  ];
};

export async function rollupBuild(opts: BuildOpts) {
  const entryByName = opts.entryPoints;
  const entries = Object.values(entryByName);
  const result = await rollup({
    input: Object.fromEntries(entries.map(({ name, value }) => [name, value])),
    plugins: [...plugins(), ...customPlugins(opts)],
    watch: {
      clearScreen: false,
    },
    external: opts.externals || [],
  });
  await result.write({
    dir: './dist/dist',
    sourcemap: true,
    entryFileNames: `[name].[format].js`,
    format: 'es',
  });
  await result.close();
}
