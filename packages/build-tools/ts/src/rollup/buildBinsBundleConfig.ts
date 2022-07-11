import virtual from '@rollup/plugin-virtual';
import type { OutputOptions, Plugin, RollupWatchOptions } from 'rollup';

import type { PackageBinEntryPoint } from '../config/nodePackageConfig';
import { isTruthy } from '../utils/isTruthy';
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
      [entry.binName]: `./src/bin/${entry.binName}${suffix?.(entry) ?? ''}.ts`,
    }),
    {}
  );
}

function buildBinsPlugins(entryPoints: PackageBinEntryPoint[]) {
  const mirroredBins = entryPoints.filter(
    (entry) => entry.binEntryType === 'dependency-bin'
  );

  // for bins which are declared in package.json but do not exist in
  // the ./src/bin directory we create a virtual module that redirects
  // to the node_modules/.bin/
  const mirroredBinsVirtualPlugin =
    mirroredBins.length > 0 &&
    virtual({
      ...mirroredBins.reduce(
        (acc, { binName }) => ({
          ...acc,
          // [location of the module]: 'source code of the module'
          [`./src/bin/${binName}.ts`]: `import { spawn } from 'child_process';

const cp = spawn(
  new URL("../node_modules/.bin/${binName}", import.meta.url).pathname,
  process.argv.slice(2),
  { stdio: "inherit" }
);
cp.on("error", (err) => {
  console.error(err);
  process.exitCode = 1;
});
cp.on("close", (code, signal) => {
  if (typeof code === "number") {
    process.exitCode = code;
  } else if (typeof signal === "string") {
    console.error("Failed to start", "${binName}", signal);
  }
});
`,
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
        (acc, { binName: bin }) => ({
          ...acc,
          // [location of the module]: 'source code of the module'
          [`./src/bin/${bin}.dev.ts`]: `import { spawn } from 'child_process';

const cp = spawn(
  new URL("../node_modules/.bin/tsx", import.meta.url).pathname,
  [new URL("../src/bin/${bin}.ts", import.meta.url).pathname, ...process.argv.slice(2)],
  { stdio: "inherit" }
);
cp.on("error", (err) => {
  console.error(err);
  process.exitCode = 1;
});
cp.on("close", (code, signal) => {
  if (typeof code === "number") {
    process.exitCode = code;
  } else if (typeof signal === "string") {
    console.error("Failed to start", "${bin}", signal);
  }
});
`,
        }),
        {}
      ),
    });

  const bundledEsmBinsInfo = new Map(
    bundledEsmBins.map(({ binName }) => [
      `../dist/${binName}.es.js`,
      {
        virtualModuleLocation: `./src/bin/${binName}.bundled.ts`,
        bundledEsmBinFileName: `../dist/${binName}.es.js`,
        proxySourceCode: `export * from "${`../dist/${binName}.es.js`}";`,
      },
    ])
  );

  // for bins which are declared in package.json and exist in
  // the ./src/bin directory we create a virtual module that
  // uses "export * from '../dist/bin.es.js';"
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

export function buildBinsBundleConfig({
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
  const { plugins } = buildBinsPlugins(config.binEntryPoints);

  const standard = defaultRollupConfig();

  // output to ./bin directory so developers can run these bins
  const shared: RollupWatchOptions = {
    ...standard,
    plugins: [...plugins, ...(standard.plugins ? standard.plugins : [])],
  };

  const devBinOutput: OutputOptions = {
    ...(standard.output as OutputOptions),
    dir: './bin',
  };

  const bundledBinOutput: OutputOptions = {
    ...(standard.output as OutputOptions),
    dir: './dist/bin',
  };

  const cjsBins = config.binEntryPoints.filter(
    (entry) => entry.format === 'cjs'
  );

  const banner = `#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed`;

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

  const esmBins = config.binEntryPoints.filter(
    (entry) => entry.format === 'esm'
  );
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
            },
          },
          {
            ...shared,
            input: buildBinInputs(bundledEsmBins, () => '.bundled'),
            output: {
              ...bundledBinOutput,
              entryFileNames: `[name].gen.mjs`,
              chunkFileNames: `chunk.[hash].mjs`,
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
    binConfigs: [cjsConfig, ...esmDevConfig].filter(isTruthy),
  };
}
