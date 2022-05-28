import type { PackageJson } from './packageJson';

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
    throw new Error('"exports" in package.json should be defined');
  }
  if (packageJson.typings) {
    throw new Error(
      '"typings" in package.json should not be defined, use "types"'
    );
  }
  const types = packageJson.types;
  if (!types) {
    throw new Error('"types" in package.json should be defined');
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
