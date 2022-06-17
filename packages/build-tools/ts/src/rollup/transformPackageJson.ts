import assert from 'assert';

import type { JsonType } from '../package-json/packageJson';
import type { PackageExportsEntryPoint } from '../package-json/parseEntryPoints';

export function transformPackageJson(
  entryPoints: Record<string, PackageExportsEntryPoint>
) {
  const entries = Object.values(entryPoints);
  const main = entryPoints['main'];
  assert(!!main);
  return (packageJson: Record<string, JsonType>): Record<string, JsonType> => {
    const license = packageJson['license'];
    const name = packageJson['name'];
    const version = packageJson['version'];
    const type = packageJson['type'];
    const bin = packageJson['bin'];
    assert(!!name);
    assert(!!version);
    assert(!!type);
    const next = {
      name,
      version,
      type,
      ...(license && {
        license,
      }),
      ...(bin && {
        bin,
      }),
      ...('main' in packageJson && {
        main: `./dist/${main.name}.es.js`,
      }),
      ...(entries.length === 1
        ? {
            exports: `./dist/${main.name}.es.js`,
          }
        : {
            exports: entries.reduce(
              (acc, entry) => ({
                ...acc,
                [entry.key]: `./dist/${entry.name}.es.js`,
              }),
              {}
            ),
          }),
    };
    return next;
  };
}
