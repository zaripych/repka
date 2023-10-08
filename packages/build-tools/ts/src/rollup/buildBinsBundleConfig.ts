import virtual from '@rollup/plugin-virtual';
import { escapeRegExp, isTruthy } from '@utils/ts';
import type { OutputOptions, Plugin, RollupWatchOptions } from 'rollup';

import type { PackageBinEntryPoint } from '../config/nodePackageConfig';
import { rollupMakeExecutablePlugin } from './rollupMakeExecutablePlugin';
import { rollupRemoveShebangPlugin } from './rollupRemoveShebangPlugin';
import type { RollupOptionsBuilderOpts } from './standardRollupConfig';

function buildBinInputs(
  entryPoints: PackageBinEntryPoint[],
  sourceFilePath?: (entry: PackageBinEntryPoint) => string
): {
  [entryAlias: string]: string;
} {
  return entryPoints.reduce(
    (acc, entry) => ({
      ...acc,
      [entry.binName]: sourceFilePath
        ? sourceFilePath(entry)
        : entry.sourceFilePath,
    }),
    {}
  );
}

function buildShebangBinsPlugins(entryPoints: PackageBinEntryPoint[]) {
  const bundledEsmBins = entryPoints.filter((entry) => entry.format === 'esm');

  const bundledEsmBinsInfo = new Map(
    bundledEsmBins.map(({ binName }) => [
      `../${binName}.js`,
      {
        virtualModuleLocation: `./src/bin/${binName}.bundled.ts`,
        proxySourceCode: `export * from "${`../${binName}.js`}";`,
      },
    ])
  );

  // for bins which are declared in package.json and exist in
  // the ./src/bin directory we create a virtual module that
  // renders "export * from '../dist/bin.js';"
  const bundledEsmBinsPlugins: Plugin[] =
    bundledEsmBins.length > 0
      ? [
          virtual(
            Object.fromEntries(
              [...bundledEsmBinsInfo.values()].map((entry) => [
                entry.virtualModuleLocation,
                entry.proxySourceCode,
              ])
            )
          ),
          {
            name: 'resolve:bundledEsmBinModules',
            resolveId(source) {
              if (bundledEsmBinsInfo.has(source)) {
                return { id: source, external: true };
              }
              return null;
            },
          },
        ]
      : [];

  return {
    plugins: bundledEsmBinsPlugins.filter(isTruthy),
  };
}

export function buildShebangBinsBundleConfig({
  config,
  defaultRollupConfig,
}: RollupOptionsBuilderOpts) {
  if (config.binEntryPoints.length === 0) {
    return {
      bundledEsmBins: [],
      bundledEsmBinsInputs: {},
      binConfigs: [],
    };
  }

  const binEntryPoints = config.binEntryPoints;

  const { plugins } = buildShebangBinsPlugins(binEntryPoints);

  const standard = defaultRollupConfig();

  const replaceExistingShebangPrefix = rollupRemoveShebangPlugin({
    include: [
      ...binEntryPoints.map((entry) => new RegExp(escapeRegExp(entry.binName))),
    ],
  });

  const shared = {
    ...standard,
    plugins: [...plugins, standard.plugins, replaceExistingShebangPrefix],
  };

  const bundledBinOutput: OutputOptions = {
    ...(shared.output as OutputOptions),
    dir: './dist/bin',
    plugins: [rollupMakeExecutablePlugin()],
  };

  const cjsBins = binEntryPoints.filter((entry) => entry.format === 'cjs');

  const esmBins = binEntryPoints.filter((entry) => entry.format === 'esm');

  const banner = `#!/usr/bin/env node`;

  const cjsConfig: false | RollupWatchOptions = cjsBins.length > 0 && {
    ...shared,
    input: buildBinInputs(cjsBins),
    output: [
      {
        ...bundledBinOutput,
        format: 'cjs',
        entryFileNames: `[name].cjs`,
        chunkFileNames: `chunk.[hash].cjs`,
        banner,
      },
    ],
  };

  const esmConfig: false | RollupWatchOptions = esmBins.length > 0 && {
    ...shared,
    input: buildBinInputs(
      esmBins,
      ({ binName }) => `./src/bin/${binName}.bundled.ts`
    ),
    output: [
      {
        ...bundledBinOutput,
        format: 'esm',
        entryFileNames: `[name].mjs`,
        chunkFileNames: `chunk.[hash].mjs`,
        banner,
      },
    ],
  };

  const bundledEsmBinsInputs = buildBinInputs(esmBins);

  return {
    binEntryPoints,
    /**
     * Bins that are part of main config which are bundled together with
     * main entry point to dedupe as much code as possible. We can only do that
     * for bins which are ESM and are not dependency-bin
     *
     * Entry points for the above bins to be merged with main entry points
     */
    bundledEsmBinsInputs,
    /**
     * Extra rollup configs that represent following:
     * - CJS output that is not part of the main bundle
     * - ESM output, which redirects to the main bundle
     */
    binConfigs: [cjsConfig, esmConfig]
      .filter(isTruthy)
      .filter((m) => m.input && Object.keys(m.input).length > 0),
  };
}
