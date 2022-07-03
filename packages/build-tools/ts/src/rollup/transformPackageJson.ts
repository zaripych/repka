import assert from 'assert';

import type { PackageExportsEntryPoint } from '../config/nodePackageConfig';
import type { JsonType } from '../package-json/packageJson';

export function transformPackageJson(
  entryPoints: Array<PackageExportsEntryPoint>
) {
  const entries = Object.values(entryPoints);
  const main = entryPoints.find((entry) => entry.chunkName === 'main');
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
        main: `./dist/${main.chunkName}.es.js`,
      }),
      ...(entries.length === 1
        ? {
            exports: `./dist/${main.chunkName}.es.js`,
          }
        : {
            exports: entries.reduce(
              (acc, entry) => ({
                ...acc,
                [entry.entryPoint]: `./dist/${entry.chunkName}.es.js`,
              }),
              {}
            ),
          }),
    };
    return next;
  };
}
