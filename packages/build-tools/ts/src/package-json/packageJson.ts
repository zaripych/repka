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

export const dependencyKeys = Object.freeze([
  'dependencies',
  'devDependencies',
  'peerDependencies',
] as const);
export type DependencyKeys = typeof dependencyKeys[number];

export function getDependenciesRecord(
  packageJson: Record<string, JsonType>,
  key: DependencyKeys
): Record<string, string> {
  const packageDependencies = packageJson[key];
  if (typeof packageDependencies !== 'object' || !packageDependencies) {
    return {};
  }
  return packageDependencies as Record<string, string>;
}

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

export type JsonObject = {
  [key: string]: JsonType | JsonPrimitive;
};

export type JsonType = JsonObject | JsonPrimitive;

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
