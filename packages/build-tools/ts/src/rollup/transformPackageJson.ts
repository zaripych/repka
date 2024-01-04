import assert from 'assert';
import { posix } from 'path';

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
      'peerDependencies',
      'peerDependenciesMeta',
      'engines',
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

    const mainOutput = main
      ? './' + posix.relative('./dist', main.outputPath)
      : undefined;

    const exports =
      entryPoints.length === 1
        ? Object.entries(ignoredEntryPoints || {}).length === 0
          ? mainOutput
          : {
              ...ignoredEntryPoints,
              ...(mainOutput && {
                '.': mainOutput,
              }),
            }
        : entryPoints.reduce(
            (acc, entry) => ({
              ...acc,
              [entry.entryPoint]:
                './' + posix.relative('./dist', entry.outputPath),
            }),
            {
              ...opts.ignoredEntryPoints,
            }
          );

    const next = {
      name,
      version,
      type,
      ...rest,
      ...('main' in packageJson &&
        mainOutput && {
          main: mainOutput,
        }),
      ...(Object.keys(bin).length > 0 && { bin }),
      ...((typeof exports === 'string' ||
        (exports && Object.entries(exports).length > 0)) && { exports }),
    };

    return next;
  };
}
