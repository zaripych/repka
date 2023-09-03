// Generated by dts-bundle-generator vcustom

import type * as ts from 'typescript';

export interface ConfigEntryPoint extends EntryPointConfig {
  /**
   * Path of generated d.ts.
   * If not specified - the path will be input file with replaced extension to `.d.ts`.
   */
  outFile?: string;
  /**
   * Skip validation of generated d.ts file
   */
  noCheck?: boolean;
}
export interface BundlerConfig {
  entries: ConfigEntryPoint[];
  compilationOptions?: CompilationOptions;
}
export declare function enableVerbose(): void;
export declare function enableNormalLog(): void;
export interface CompilationOptions {
  /**
   * EXPERIMENTAL!
   * Allows disable resolving of symlinks to the original path.
   * By default following is enabled.
   * @see https://github.com/timocov/dts-bundle-generator/issues/39
   */
  followSymlinks?: boolean;
  /**
   * Path to the tsconfig file that will be used for the compilation.
   */
  preferredConfigPath?: string;
  /**
   * Extra TypeScript compiler options to override default options
   * loaded from the default tsconfig.json specified in `preferredConfigPath`
   * or as found in the root of your project by TypeScript compiler.
   */
  compilerOptions?: ts.CompilerOptions;
}
export interface OutputOptions {
  /**
   * Sort output nodes in ascendant order.
   */
  sortNodes?: boolean;
  /**
   * Name of the UMD module.
   * If specified then `export as namespace ModuleName;` will be emitted.
   */
  umdModuleName?: string;
  /**
   * Enables inlining of `declare global` statements contained in files which should be inlined (all local files and packages from inlined libraries).
   */
  inlineDeclareGlobals?: boolean;
  /**
   * Enables inlining of `declare module` statements of the global modules
   * (e.g. `declare module 'external-module' {}`, but NOT `declare module './internal-module' {}`)
   * contained in files which should be inlined (all local files and packages from inlined libraries)
   */
  inlineDeclareExternals?: boolean;
  /**
   * Allows remove "Generated by dts-bundle-generator" comment from the output
   */
  noBanner?: boolean;
  /**
   * Enables stripping the `const` keyword from every direct-exported (or re-exported) from entry file `const enum`.
   * This allows you "avoid" the issue described in https://github.com/microsoft/TypeScript/issues/37774.
   */
  respectPreserveConstEnum?: boolean;
  /**
   * By default all interfaces, types and const enums are marked as exported even if they aren't exported directly.
   * This option allows you to disable this behavior so a node will be exported if it is exported from root source file only.
   */
  exportReferencedTypes?: boolean;
}
export interface LibrariesOptions {
  /**
   * Array of package names from node_modules to inline typings from.
   * Used types will be inlined into the output file.
   */
  inlinedLibraries?: string[];
  /**
   * Array of package names from node_modules to import typings from.
   * Used types will be imported using `import { First, Second } from 'library-name';`.
   * By default all libraries will be imported (except inlined libraries and libraries from @types).
   */
  importedLibraries?: string[];
  /**
   * Array of package names from @types to import typings from via the triple-slash reference directive.
   * By default all packages are allowed and will be used according to their usages.
   */
  allowedTypesLibraries?: string[];
}
export interface EntryPointConfig {
  /**
   * Path to input file.
   */
  filePath: string;
  libraries?: LibrariesOptions;
  /**
   * Fail if generated dts contains class declaration.
   */
  failOnClass?: boolean;
  output?: OutputOptions;
}
export declare function generateAndSaveDtsBundle(
  bundlerConfig: BundlerConfig
): void;
export declare function generateDtsBundle(
  entries: readonly EntryPointConfig[],
  options?: CompilationOptions
): string[];

export {};