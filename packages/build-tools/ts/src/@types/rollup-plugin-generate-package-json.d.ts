declare module 'rollup-plugin-generate-package-json' {
  import type { Plugin } from 'rollup';

  type JsonPrimitive = boolean | number | string | null;

  type JsonType =
    | {
        [key: string]: JsonType | JsonPrimitive;
      }
    | JsonPrimitive;

  type GeneratePackageJsonPlugin = (options?: {
    additionalDependencies?: string[];
    baseContents?:
      | Record<string, JsonType>
      | ((packageJson: Record<string, JsonType>) => Record<string, JsonType>);
    inputFolder?: string;
    outputFolder?: string;
  }) => Plugin;

  const generagePackageJson: GeneratePackageJsonPlugin;

  export default generagePackageJson;
}
