import type { JsonType } from '../../../package-json/packageJson';

export async function readPackageJsonWithDefault(
  path: string,
  deps: {
    readFile: (path: string) => Promise<string>;
  }
): Promise<Record<string, JsonType>> {
  try {
    const text = await deps.readFile(path);
    const packageJson = JSON.parse(text) as JsonType;
    if (typeof packageJson !== 'object' || packageJson === null) {
      return {};
    }
    return packageJson;
  } catch (err) {
    return {};
  }
}
