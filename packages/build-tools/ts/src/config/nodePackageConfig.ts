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
   * by the consumers, every entry represents a chunk to be
   * bundled and normally specified via package.json "exports"
   * pointing to the TypeScript source code.
   *
   * After bundling, the entry points would be written to a separate
   * bundled package.json "exports" and point to the bundled
   * chunks in the published version of the package.
   */
  entryPoints: Array<PackageExportsEntryPoint>;

  /**
   * Entry points of the package that can be executed using
   * command line and installed into node_modules/.bin. These
   * are normally specified via package.json "bin".
   *
   * NOTE: The way "bin" is specified is kind of bespoke and
   * has to match `./bin/[bin].gen.{cjs,mjs}` - this is required
   * so we can support running those bins during development.
   */
  binEntryPoints: Array<PackageBinEntryPoint>;

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
 * Represents single entry from package.json exports object
 *
 * ```json
 *   ".": "./src/index.ts",
 *   "./feature": "./src/feature/index.ts"
 * ```
 * Contains 2 entries, where `"."` and `"./feature"` - are entry points,
 * `"./src/index.ts"`, `"./src/feature/index.ts"` - are source paths, etc.
 */
export type PackageExportsEntryPoint = {
  /**
   * Package entry point
   */
  entryPoint: string;
  /**
   * Path to the module this entry point represents
   */
  sourcePath: string;
  /**
   * Chunk name generated from the entry point
   */
  chunkName: string;
};

/**
 * Represents single entry from package.json bin object
 *
 * ```json
 *   "jest": "./bin/jest.gen.cjs",
 *   "prettier": "./bin/prettier.gen.mjs",
 * ```
 */
export type PackageBinEntryPoint = {
  /**
   * Name of the bin file
   */
  binName: string;
  /**
   * When specified, the bin entry is a mirror of package's dependency,
   * this will automatically generate source code to run
   * `./node_modules/.bin/[binName]` relative to the package
   */
  binEntryType?: 'dependency-bin';
  /**
   * Output format
   */
  format: 'cjs' | 'esm';
};
