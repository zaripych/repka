/// <reference types="./@types/rollup-plugin-generate-package-json" />

import type { Plugin } from 'rollup';

import { copyFiles } from './file-system/copyFiles';
import type { PackageJson } from './package-json/packageJson';
import { readCwdPackageJson } from './package-json/readPackageJson';
import { resolveNodeEntryPoints } from './package-json/resolveEntryPoints';
import { rollupBuild } from './rollup/rollupBuild';
import { tscComposite } from './tsc-cli/tsc';
import { allFulfilled } from './utils/allFullfilled';
import { setFunctionName } from './utils/setFunctionName';

export type BuildOpts = {
  /**
   * Extra externals which are not listed in dependencies or those
   * listed which are not explicitly referenced in the code
   */
  externals?: string[];

  /**
   * Whether to generate declarations during build
   */
  declarations?: true;

  /**
   * Extra files to copy to the ./dist directory to be published
   */
  copy?: Array<{ sourceDir: string; globs: string[] }>;

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
  packageJson: PackageJson,
  opts?: BuildOpts
) => {
  const dependencies = Object.keys(packageJson.dependencies || {});
  return [...new Set([...dependencies, ...(opts?.externals || [])])];
};

export function buildForNode(opts?: BuildOpts): () => Promise<void> {
  return setFunctionName('buildForNode', async () => {
    const packageJson = await readCwdPackageJson();
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

    const declarations = opts?.declarations;

    // ./src will imply that we should just include ./src
    // into the package, otherwise, let's build declarations
    const declarationsPre = declarations
      ? async () => {
          await tscComposite();
        }
      : () => Promise.resolve();

    const entryPoints = resolveNodeEntryPoints(packageJson.exports);

    const declarationsPost = declarations
      ? async () => {
          await copyFiles({
            sourceDirectory: '.tsc-out',
            globs: ['**/*.d.ts'],
            destination: './dist/types',
          });
        }
      : async () => {
          await copyFiles({
            sourceDirectory: './src',
            globs: ['**/*'],
            destination: './dist/src',
          });
        };

    const allExternals = externalsFromDependencies(packageJson, opts);

    await allFulfilled([
      declarationsPre(),
      rollupBuild({
        entryPoints,
        externals: allExternals,
        packageJson: (packageJson) => {
          if (declarations) {
            packageJson['types'] = './dist/types';
          } else {
            packageJson['types'] = packageJson['types'] || './src/index.ts';
          }
          return packageJson;
        },
      }),
    ]);
    await allFulfilled([
      declarationsPost(),
      ...(opts?.copy
        ? opts.copy.map((entry) =>
            copyFiles({
              sourceDirectory: entry.sourceDir,
              globs: entry.globs,
              destination: `./dist/${entry.sourceDir}`,
            })
          )
        : []),
    ]);
  });
}
