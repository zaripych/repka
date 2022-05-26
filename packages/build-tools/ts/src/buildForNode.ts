import nodeBuiltins from 'builtin-modules/static.js';
import type { Plugin, PluginOption } from 'vite';
import { build } from 'vite';

import { copyFiles } from './file-system/copyFiles';
import type { PackageJson } from './package-json/packageJson';
import { readCwdPackageJson } from './package-json/readPackageJson';
import { resolveNodeEntryPoints } from './package-json/resolveEntryPoints';
import { tscComposite } from './tsc-cli/tsc';
import { setFunctionName } from './utils/setFunctionName';

export type BuildOpts = {
  /**
   * Extra externals which are not listed in dependencies
   */
  externals?: string[];

  /**
   * Whether to generate dependencies during build
   */
  declarations?: true | string;

  /**
   * Module resolution function, in case you have weird dependencies
   * that do not resolve on their own, have them setup here
   */
  resolveId?: (
    id: string,
    importer?: string
  ) => ReturnType<NonNullable<Plugin['resolveId']>>;
};

const allBuiltins = nodeBuiltins
  .flatMap((builtin) => [builtin, `node:${builtin}`])
  .concat(['fs/promises', 'node:fs/promises']);

const externalsFromDependencies = (
  packageJson: PackageJson,
  opts?: BuildOpts
) => {
  const dependencies = Object.keys(packageJson.dependencies || {});
  return [...new Set([...dependencies, ...(opts?.externals || [])])];
};

const resolveNodeBuiltinsPlugin = (): PluginOption => {
  return {
    name: 'node:builtins',
    enforce: 'pre',
    resolveId(source) {
      if (allBuiltins.includes(source)) {
        return {
          id: source.replace('node:', ''),
          external: true,
        };
      }
      return null;
    },
  };
};

const nodeVitePlugins = (opts: BuildOpts): PluginOption[] => {
  const resolveIdFn = opts.resolveId;
  return [
    resolveIdFn && {
      name: 'buildLibrary:resolveId',
      enforce: 'pre',
      async resolveId(id, importer) {
        return await Promise.resolve(resolveIdFn(id, importer));
      },
    },
    resolveNodeBuiltinsPlugin(),
  ];
};

export function buildForNode(optsOptional?: BuildOpts): () => Promise<void> {
  return setFunctionName('buildForNode', async () => {
    const packageJson = await readCwdPackageJson();
    const opts: BuildOpts = {
      ...optsOptional,
      externals: externalsFromDependencies(packageJson, optsOptional),
    };
    if (packageJson.type !== 'module') {
      throw new Error('"type" in package.json should be "module"');
    }
    if (!packageJson.exports) {
      throw new Error('"exports" in package.json should be defined');
    }
    if (packageJson.typings) {
      throw new Error(
        '"typings" in package.json should not be defined, use "types"'
      );
    }
    const types = packageJson.types;
    if (!types) {
      throw new Error('"types" in package.json should be defined');
    }

    const declarationsPath = opts.declarations;

    // ./src will imply that we should just include ./src
    // into the package, otherwise, let's build declarations
    const declarationsPre = declarationsPath
      ? async () => {
          await tscComposite();
        }
      : () => Promise.resolve();
    const declarationsPost = declarationsPath
      ? async () => {
          await copyFiles({
            sourceDirectory: '.tsc-out',
            globs: '**/*.d.ts',
            destination:
              declarationsPath !== true
                ? `./dist/${declarationsPath}`
                : './dist/types',
          });
        }
      : () => Promise.resolve();

    const entryPoints = resolveNodeEntryPoints(packageJson.exports);
    const results = await Promise.allSettled([
      declarationsPre(),
      ...entryPoints.map((entry) =>
        build({
          plugins: nodeVitePlugins(opts),
          build: {
            sourcemap: true,
            target: 'node16',
            lib: {
              entry: entry.entryPoint,
              name: entry.name,
              fileName: (format) => `${entry.name}.${format}.js`,
              formats: ['es'],
            },
            rollupOptions: {
              external: opts.externals ? opts.externals : [],
            },
          },
        })
      ),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason;
      }
    }
    await declarationsPost();
  });
}
