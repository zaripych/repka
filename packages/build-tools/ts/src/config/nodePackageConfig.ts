import type { PackageJsonExports } from '../package-json/packageJson';

/**
 * Normalized and validated config that is typically built
 * from package.json of the package being linted, bundled or
 * tested
 *
 * The config is designed for Node.js npm packages/libraries or CLI's
 */
export type NodePackageConfig = {
  /**
   * Name of the package as specified in package.json
   */
  name: string;

  /**
   * Version of the package as specified in package.json
   */
  version: string;

  /**
   * Entry points of the package that can be imported/executed
   * by the consumers. These are specified via "exports" value
   * of the package.json. Entry points represents one or more
   * chunks to be bundled and need to point to the TypeScript
   * source code relative to the package root.
   *
   * After bundling, the entry points would be written to `./dist`
   * directory and for every input entry point there is going to be
   * an output entry point in `./dist/package.json` "exports" value
   * and those would point to the bundled chunks in the published
   * version of the package.
   */
  entryPoints: Array<PackageExportsEntryPoint>;

  /**
   * Entry points of the package that can be executed using
   * command line and installed into node_modules/.bin. These
   * are specified, as usual, via package.json "bin" value.
   * The paths are relative to the package root and should
   * point to the TypeScript source code of the bin with
   * "shebang" at the top.
   *
   * The "shebang" is a special comment at the top of the file
   * that tells the system how to execute the file.
   *
   * For example:
   *
   * ```TypeScript
   * #!/usr/bin/env tsx
   * ```
   *
   * The above shebang tells the environment to execute
   * the file using "tsx" executable - which will transform
   * the TypeScript source code into JavaScript and execute
   * it via node.
   *
   * The shebang is optional and if not specified - the "bin"
   * will not be executable at dev-time.
   *
   * After bundling, the bin entry points would be written to
   * `./dist/bin` directory and for every input bin entry point
   * there is going to be an output bin entry point in
   * `./dist/package.json` "bin" value and those would point
   * to the bundled chunks in the published version of the
   * package.
   *
   * After building the package - the bundled version of the
   * code will have the shebang added automatically and point
   * to "node".
   */
  binEntryPoints: Array<PackageBinEntryPoint>;

  /**
   * Entry points of the package that couldn't be parsed and were
   * ignored - they should be rendered out as is.
   */
  ignoredEntryPoints?: Record<string, PackageJsonExports>;

  /**
   * Bin entry points of the package that couldn't be parsed and were
   * ignored - they should be rendered out as is.
   */
  ignoredBinEntryPoints?: Record<string, string>;

  /**
   * Package dependencies of the package where the key
   * is package name and value is the version of the package.
   *
   * NOTE: Version is as is and can be dependency
   * manager specific, ie "workspace:*" when pnpm is used
   */
  dependencies: Record<string, string>;

  /**
   * Dev-time only dependencies of the package
   */
  devDependencies: Record<string, string>;
};

/**
 * Represents single bundled entry from package.json exports object
 *
 * ```json
 *   ".": "./src/index.ts",
 *   "./feature": "./src/feature/index.ts",
 *   "./configs/*": {
 *     "bundle": "./src/configs/*.ts",
 *     "default": "./dist/configs/*"
 *   }
 * ```
 * Contains at least 2 entries, where
 * `"."` and `"./feature"` - are entry points,
 * `"./src/index.ts"`, `"./src/feature/index.ts"` - are source paths, etc.
 *
 * This can also expand to more entries depending on the contents of the
 * "./src/configs" directory. The `*.ts` files are going to be bundled because
 * the "bundle" condition is present.
 */
export type PackageExportsEntryPoint = {
  /**
   * Package entry point, when the "exports" field is a string this
   * will be "." otherwise it will be the key of the entry point
   * in the "exports" object.
   */
  entryPoint: string;

  /**
   * Path to the module this entry point represents
   */
  sourcePath: string;

  /**
   * Path to the output module where the entry point chunk will be written
   */
  outputPath: string;

  /**
   * Chunk name generated from the entry point and source path
   * that can be used to identify the chunk in the bundle when
   * it's being built by rollup.
   */
  chunkName: string;
};

/**
 * Represents single entry from package.json bin object
 *
 * ```json
 *   "jest": "./src/bin/jest.ts",
 *   "prettier": "./src/bin/prettier.ts",
 * ```
 */
export type PackageBinEntryPoint = {
  /**
   * Name of the bin file
   */
  binName: string;

  /**
   * Path to the source file of the bin
   */
  sourceFilePath: string;

  /**
   * Output format
   */
  format: 'cjs' | 'esm';
};
