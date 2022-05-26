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

export type PackageJson = {
  name: string;
  type?: string;
  types?: string;
  typings?: string;
  main?: string;
  exports?: PackageJsonExports;

  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} & Record<string, string | string[] | boolean>;
