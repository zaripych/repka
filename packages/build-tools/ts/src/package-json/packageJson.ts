export const nodeExportsConditions = [
  'node',
  'import',
  'require',
  'default',
] as const;

export const ignoredByNodeExportConditions = [
  'types',
  'browser',
  'development',
  'production',
] as const;

export type NodeExportsConditions = typeof nodeExportsConditions[number];

export type ExportsConditions =
  | NodeExportsConditions
  | typeof ignoredByNodeExportConditions[number];

export type PackageJsonExports =
  | JsonPrimitive
  | ({
      [condition in ExportsConditions]?: PackageJsonExports;
    } & {
      [exportPath: `.${string}`]: PackageJsonExports;
    });

export type JsonPrimitive = boolean | number | string | null;

export type JsonType =
  | {
      [key: string]: JsonType | JsonPrimitive;
    }
  | JsonPrimitive;

export type PackageJson = {
  name?: string;
  version?: string;
  type?: string;
  types?: string;
  typings?: string;
  main?: string;
  scripts?: Record<string, string>;
  exports?: PackageJsonExports;
  bin?: string | Record<string, string>;

  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} & Record<string, JsonType>;
