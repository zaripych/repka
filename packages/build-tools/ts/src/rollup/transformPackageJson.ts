import assert from 'assert';

import type { PackageExportsEntryPoint } from '../config/nodePackageConfig';
import type { JsonType, PackageJsonExports } from '../package-json/packageJson';

export function transformPackageJson(opts: {
  entryPoints: Array<PackageExportsEntryPoint>;
  ignoredEntryPoints: Record<string, PackageJsonExports>;
}) {
  const entries = opts.entryPoints;
  const main = opts.entryPoints.find((entry) => entry.chunkName === 'main');
  assert(!!main);
  return (packageJson: Record<string, JsonType>): Record<string, JsonType> => {
    const keys = [
      'name',
      'version',
      'type',
      'license',
      'description',
      'author',
      'keywords',
      'bugs',
      'repository',
      'version',
      'type',
      'bin',
    ] as const;

    type Key = (typeof keys)[number];

    const copyValues = Object.fromEntries(
      Object.entries(packageJson).filter(([key]) => keys.includes(key as Key))
    ) as Record<Key, JsonType>;

    const { name, version, type, ...rest } = copyValues;

    assert(!!name && typeof name === 'string');
    assert(!!version && typeof version === 'string');
    assert(!!type && typeof type === 'string');

    const next = {
      name,
      version,
      type,
      ...rest,
      ...('main' in packageJson && {
        main: `./dist/${main.chunkName}.js`,
      }),
      ...(entries.length === 1
        ? {
            exports:
              Object.entries(opts.ignoredEntryPoints).length === 0
                ? `./dist/${main.chunkName}.js`
                : {
                    ...opts.ignoredEntryPoints,
                    '.': `./dist/${main.chunkName}.js`,
                  },
          }
        : {
            exports: entries.reduce(
              (acc, entry) => ({
                ...acc,
                [entry.entryPoint]: `./dist/${entry.chunkName}.js`,
              }),
              {
                ...opts.ignoredEntryPoints,
              }
            ),
          }),
    };

    return next;
  };
}
