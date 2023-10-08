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
  const types = packageJson.types;
  if (!types && (exports || packageJson.main)) {
    throw new Error(
      line`
        "types" in package.json should be defined, point it to your
        TypeScript files; ie "./src/index.ts". This would allow your
        packages to be imported in other TypeScript packages in the
        monorepo.
      `
    );
  }
  return {
    ...packageJson,
    name,
    version,
    type,
    exports,
    types,
  };
}
