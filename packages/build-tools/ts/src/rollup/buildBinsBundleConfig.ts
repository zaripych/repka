import virtual from '@rollup/plugin-virtual';
import { isTruthy } from '@utils/ts';
import type { OutputOptions, Plugin, RollupWatchOptions } from 'rollup';

import type { PackageBinEntryPoint } from '../config/nodePackageConfig';
import { determineBinScriptPath } from '../utils/binPath';
import { mirroredBinContent } from './bin-virtual-modules/mirroredBinContent';
import { tsxJumpDevTimeContent } from './bin-virtual-modules/tsxJumpDevTimeContent';
import { rollupMakeExecutablePlugin } from './rollupMakeExecutablePlugin';
import type { RollupOptionsBuilderOpts } from './standardRollupConfig';

function buildBinInputs(
  entryPoints: PackageBinEntryPoint[],
  suffix?: (entry: PackageBinEntryPoint) => string
): {
  [entryAlias: string]: string;
} {
  return entryPoints.reduce(
    (acc, entry) => ({
      ...acc,
      [entry.binName]:
        entry.binEntryType !== 'typescript-shebang-bin'
          ? `./src/bin/${entry.binName}${suffix?.(entry) ?? ''}.ts`
          : entry.sourceFilePath,
    }),
    {}
  );
}

async function buildBinsPlugins(entryPoints: PackageBinEntryPoint[]) {
  const mirroredBins = entryPoints.filter(
    (entry) => entry.binEntryType === 'dependency-bin'
  );

  const mirroredBinsAndScriptPaths = await Promise.all(
    mirroredBins.map(async (bin) => ({
      ...bin,
      binScriptPath: await determineBinScriptPath({
        binName: bin.binName,
        binPackageName: bin.binName,
      }).then((result) => {
        if (!result) {
          throw new Error(
            `Cannot determine location of the bin script for "${bin.binName}"` +
              `, location has to be specified manually.`
          );
        }
        return result;
      }),
    }))
  );

  // for bins which are declared in package.json but do not exist in
  // the ./src/bin directory we create a virtual module that redirects
  // to the node_modules/.bin/
  const mirroredBinsVirtualPlugin =
    mirroredBins.length > 0 &&
    virtual({
      ...mirroredBinsAndScriptPaths.reduce(
        (acc, { binName, binScriptPath }) => ({
          ...acc,
          // [location of the module]: 'source code of the module'
          [`./src/bin/${binName}.ts`]: mirroredBinContent({
            binName,
            binScriptPath,
          }),
        }),
        {}
      ),
    });

  const bundledEsmBins = entryPoints.filter(
    (entry) => entry.format === 'esm' && entry.binEntryType !== 'dependency-bin'
  );

  // for bins which are declared in package.json and exist in
  // the ./src/bin directory we create a virtual module that
  // uses `tsx` to point to the ./src/bin during development
  const devEsmBinsPlugin =
    bundledEsmBins.length > 0 &&
    virtual({
      ...bundledEsmBins.reduce(
        (acc, { binName }) => ({
          ...acc,
          // [location of the module]: 'source code of the module'
          [`./src/bin/${binName}.dev.ts`]: tsxJumpDevTimeContent(binName),
        }),
        {}
      ),
    });

  const bundledEsmBinsInfo = new Map(
    bundledEsmBins.map(({ binName }) => [
      `../dist/${binName}.js`,
      {
        virtualModuleLocation: `./src/bin/${binName}.bundled.ts`,
        bundledEsmBinFileName: `../dist/${binName}.js`,
        proxySourceCode: `export * from "${`../dist/${binName}.js`}";`,
      },
    ])
  );

  // for bins which are declared in package.json and exist in
  // the ./src/bin directory we create a virtual module that
  // uses "export * from '../dist/bin.js';"
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
    plugins: [
      mirroredBinsVirtualPlugin,
      devEsmBinsPlugin,
      ...bundledEsmBinsPlugins,
    ].filter(isTruthy),
  };
}

export async function buildBinsBundleConfig({
  config,
  defaultRollupConfig,
}: RollupOptionsBuilderOpts) {
  const binEntryPoints = config.binEntryPoints.filter(
    (entry) => entry.binEntryType !== 'typescript-shebang-bin'
  );

  if (binEntryPoints.length === 0) {
    return {
      bundledEsmBins: [],
      bundledEsmBinsInputs: {},
      binConfigs: [],
    };
  }

  const { plugins } = await buildBinsPlugins(binEntryPoints);

  const standard = defaultRollupConfig();

  // output to ./bin directory so developers can run these bins
  const shared: RollupWatchOptions = {
    ...standard,
    plugins: [...plugins, standard.plugins],
  };

  const devBinOutput: OutputOptions = {
    ...(standard.output as OutputOptions),
    dir: './bin',
    plugins: [rollupMakeExecutablePlugin()],
  };

  const bundledBinOutput: OutputOptions = {
    ...(standard.output as OutputOptions),
    dir: './dist/bin',
    plugins: [rollupMakeExecutablePlugin()],
  };

  const cjsBins = binEntryPoints.filter((entry) => entry.format === 'cjs');

  const banner = `#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed`;

  const bannerDist = `#!/usr/bin/env node`;

  const cjsConfig: false | RollupWatchOptions = cjsBins.length > 0 && {
    ...shared,
    input: buildBinInputs(cjsBins),
    output: [
      {
        ...devBinOutput,
        format: 'cjs',
        entryFileNames: `[name].gen.cjs`,
        chunkFileNames: `chunk.[hash].gen.cjs`,
        banner,
      },
      {
        ...bundledBinOutput,
        format: 'cjs',
        entryFileNames: `[name].gen.cjs`,
        chunkFileNames: `chunk.[hash].cjs`,
      },
    ],
  };

  const esmBins = binEntryPoints.filter((entry) => entry.format === 'esm');
  const mirroredEsmBins = esmBins.filter(
    (entry) => entry.binEntryType === 'dependency-bin'
  );
  const bundledEsmBins = esmBins.filter(
    (entry) => entry.binEntryType !== 'dependency-bin'
  );

  const esmDevConfig: RollupWatchOptions[] =
    esmBins.length > 0
      ? [
          {
            ...shared,
            input: buildBinInputs(esmBins, (entry) => {
              if (entry.binEntryType === 'dependency-bin') {
                return '';
              }
              return '.dev';
            }),
            output: {
              ...devBinOutput,
              entryFileNames: `[name].gen.mjs`,
              chunkFileNames: `chunk.[hash].gen.mjs`,
              banner,
            },
          },
          {
            ...shared,
            input: buildBinInputs(mirroredEsmBins),
            output: {
              ...bundledBinOutput,
              entryFileNames: `[name].gen.mjs`,
              chunkFileNames: `chunk.[hash].mjs`,
              banner: bannerDist,
            },
          },
          {
            ...shared,
            input: buildBinInputs(bundledEsmBins, () => '.bundled'),
            output: {
              ...bundledBinOutput,
              entryFileNames: `[name].gen.mjs`,
              chunkFileNames: `chunk.[hash].mjs`,
              banner: bannerDist,
            },
          },
        ]
      : [];

  return {
    /**
     * Bins that are part of main config which are bundled together with
     * main entry point to dedupe as much code as possible. We can only do that
     * for bins which are ESM and are not dependency-bin
     */
    bundledEsmBins,
    /**
     * Entry points for the above bins to be merged with main entry points
     */
    bundledEsmBinsInputs: buildBinInputs(bundledEsmBins),
    binConfigs: [cjsConfig, ...esmDevConfig]
      .filter(isTruthy)
      .filter((m) => m.input && Object.keys(m.input).length > 0),
  };
}

function buildTypescriptShebangBinsPlugins(
  entryPointsUnfiltered: PackageBinEntryPoint[]
) {
  const entryPoints = entryPointsUnfiltered.filter(
    (entry) => entry.binEntryType === 'typescript-shebang-bin'
  );

  const bundledEsmBins = entryPoints.filter((entry) => entry.format === 'esm');

  const bundledEsmBinsInfo = new Map(
    bundledEsmBins.map(({ binName }) => [
      `../dist/${binName}.js`,
      {
        virtualModuleLocation: `./src/bin/${binName}.bundled.ts`,
        bundledEsmBinFileName: `../dist/${binName}.js`,
        proxySourceCode: `export * from "${`../dist/${binName}.js`}";`,
      },
    ])
  );

  // for bins which are declared in package.json and exist in
  // the ./src/bin directory we create a virtual module that
  // uses "export * from '../dist/bin.js';"
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

export function buildTypeScriptShebangBinsBundleConfig({
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

  const binEntryPoints = config.binEntryPoints.filter(
    (entry) => entry.binEntryType === 'typescript-shebang-bin'
  );

  const { plugins } = buildTypescriptShebangBinsPlugins(binEntryPoints);

  const standard = defaultRollupConfig();

  const shared = {
    ...standard,
    plugins: [...plugins, standard.plugins],
  };

  const bundledBinOutput: OutputOptions = {
    ...(shared.output as OutputOptions),
    dir: './dist/bin',
    plugins: [rollupMakeExecutablePlugin()],
  };

  const cjsBins = binEntryPoints.filter((entry) => entry.format === 'cjs');

  const bundledEsmBins = binEntryPoints.filter(
    (entry) => entry.format === 'esm'
  );

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

  const esmConfig: false | RollupWatchOptions = bundledEsmBins.length > 0 && {
    ...shared,
    input: buildBinInputs(bundledEsmBins, () => '.bundled'),
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

  const bundledEsmBinsInputs = buildBinInputs(bundledEsmBins);

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
