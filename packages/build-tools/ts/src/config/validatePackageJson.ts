import { line } from '../markdown/line';
import type { PackageJson } from '../package-json/packageJson';

export function validatePackageJson(packageJson: PackageJson) {
  const name = packageJson.name;
  if (!name) {
    throw new Error('"name" in package.json should be defined');
  }
  const version = packageJson.version;
  if (!version) {
    throw new Error('"version" in package.json should be defined');
  }
  const type = packageJson.type;
  if (type !== 'module') {
    throw new Error('"type" in package.json should be "module"');
  }
  const exports = packageJson.exports;
  if (!exports) {
    if (!packageJson.bin && !packageJson.main) {
      throw new Error(
        line`
          "exports" in package.json should be defined, for starters you can
          point it to your main entry point; ie "./src/index.ts".
          Alternatively, you can also define "bin" or "main" in package.json.
        `
      );
    }
  }
  if (packageJson.typings) {
    throw new Error(
      '"typings" in package.json should not be defined, use "types"'
    );
  }
  return {
    ...packageJson,
    name,
    version,
    type,
    exports,
  };
}
