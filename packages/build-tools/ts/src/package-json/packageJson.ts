export const nodeExportsConditions = [
  'node',
  'import',
  'require',
  'default',
] as const;

export const ignoredExportConditions = ['browser', 'development', 'production'];

export type NodeExportsConditions = typeof nodeExportsConditions[number];

export type ExportsConditions =
  | NodeExportsConditions
  | typeof ignoredExportConditions[number];

export type PackageJsonExports =
  | string
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
  exports?: PackageJsonExports;

  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} & Record<string, JsonType>;
