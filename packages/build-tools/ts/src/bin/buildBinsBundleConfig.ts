import replace from '@rollup/plugin-replace';
import virtual from '@rollup/plugin-virtual';
import { readdir } from 'fs/promises';
import type { RollupWatchOptions } from 'rollup';

import { readCwdPackageJson } from '../package-json/readPackageJson';
import { rollupNodeConfig } from '../rollup/rollupNodeConfig';
import { isTruthy } from '../utils/isTruthy';

function inputFor(bins: string[]): { [entryAlias: string]: string } {
  return bins.reduce(
    (acc, bin) => ({
      ...acc,
      [bin]: `./src/bin/${bin}.ts`,
    }),
    {}
  );
}

export async function buildBinsBundleConfig(): Promise<RollupWatchOptions[]> {
  const packageJson = await readCwdPackageJson();
  const binEntries = Object.entries(packageJson['bin'] || {}) as Array<
    [string, string]
  >;
  const allBins = binEntries.map(([key]) => key);

  // all source files in the ./src/bin directory
  const srcBinContents = await readdir(new URL('./', import.meta.url).pathname);

  // for bins which are declared in package.json but do not exist in
  // the ./src/bin directory we create a virtual module (that is generate their
  // code on the fly)
  const generateModulesPlugin = virtual({
    ...allBins
      .filter((bin) => !srcBinContents.includes(`${bin}.ts`))
      .reduce(
        (acc, bin) => ({
          ...acc,
          // [location of the module]: 'source code of the module'
          [`./src/bin/${bin}.ts`]: `import { runBin } from '${
            new URL(`./runBin`, import.meta.url).pathname
          }';
await runBin('${bin}')`,
        }),
        {}
      ),
  });

  // TODO: check if still needed
  const replaceEnvFilePrefix = replace({
    values: {
      [`#!/usr/bin/env node`]: '',
    },
    delimiters: ['', ''],
    preventAssignment: true,
  });

  // TODO: check if still needed
  // we should not be using require in .mjs
  const mockDtsBundleGeneratorPackageJsonVersion = virtual({
    [new URL(
      `../../../dts-bundle-generator/dist/helpers/package-version.js`,
      import.meta.url
    ).pathname]: `export function packageVersion() { return 'custom'; }`,
  });

  const { cjsbins, mjsbins } = binEntries.reduce<{
    cjsbins: string[];
    mjsbins: string[];
  }>(
    (acc, [key, value]) => {
      if (value.endsWith('.cjs')) {
        acc.cjsbins.push(key);
      } else if (value.endsWith('.mjs')) {
        acc.mjsbins.push(key);
      }
      return acc;
    },
    {
      cjsbins: [],
      mjsbins: [],
    }
  );

  const bespoke = await rollupNodeConfig({
    outDir: './bin',
    minify: false,
  });

  const shared: RollupWatchOptions = {
    ...bespoke,
    plugins: [
      generateModulesPlugin,
      replaceEnvFilePrefix,
      mockDtsBundleGeneratorPackageJsonVersion,
      ...(bespoke.plugins ? bespoke.plugins : []),
    ],
  };

  const cjsConfig = cjsbins.length > 0 && {
    ...shared,
    input: inputFor(cjsbins),
    output: {
      ...shared.output,
      format: 'cjs',
      entryFileNames: `[name].gen.cjs`,
      chunkFileNames: `[name].gen.cjs`,
      banner: `// This file is bundled up from './src/*' and needs to be committed`,
    },
  };

  const mjsConfig = mjsbins.length > 0 && {
    ...shared,
    input: inputFor(mjsbins),
    output: {
      ...shared.output,
      entryFileNames: `[name].gen.mjs`,
      chunkFileNames: `[name].gen.mjs`,
      banner: `// This file is bundled up from './src/*' and needs to be committed`,
    },
  };

  console.log({ cjsConfig, cjsbins });
  console.log({ mjsConfig, mjsbins });

  return [cjsConfig, mjsConfig].filter(isTruthy);
}
