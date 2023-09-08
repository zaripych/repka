import assert from 'assert';

import type {
  PackageBinEntryPoint,
  PackageExportsEntryPoint,
} from '../config/nodePackageConfig';
import type { JsonType, PackageJsonExports } from '../package-json/packageJson';

export function transformPackageJson(opts: {
  entryPoints: Array<PackageExportsEntryPoint>;
  ignoredEntryPoints?: Record<string, PackageJsonExports>;
  binEntryPoints: Array<PackageBinEntryPoint>;
  ignoredBinEntryPoints?: Record<string, string>;
}) {
  const {
    entryPoints,
    ignoredEntryPoints,
    binEntryPoints,
    ignoredBinEntryPoints,
  } = opts;

  const main = entryPoints.find((entry) => entry.chunkName === 'main');
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

    const bin = Object.fromEntries([
      ...binEntryPoints.map(
        (bin) =>
          [
            bin.binName,
            `./bin/${bin.binName}.${bin.format === 'cjs' ? 'cjs' : 'mjs'}`,
          ] as const
      ),
      ...Object.entries(ignoredBinEntryPoints || {}),
    ]);

    const next = {
      name,
      version,
      type,
      ...rest,
      ...('main' in packageJson && {
        main: `./dist/${main.chunkName}.js`,
      }),
      ...(Object.keys(bin).length > 0 && { bin }),
      ...(entryPoints.length === 1
        ? {
            exports:
              Object.entries(ignoredEntryPoints || {}).length === 0
                ? `./dist/${main.chunkName}.js`
                : {
                    ...ignoredEntryPoints,
                    '.': `./dist/${main.chunkName}.js`,
                  },
          }
        : {
            exports: entryPoints.reduce(
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
