import virtual from '@rollup/plugin-virtual';
import { readdir } from 'fs/promises';
import type { RollupWatchOptions } from 'rollup';

import type { PackageJson } from '../package-json/packageJson';
import { isTruthy } from '../utils/isTruthy';
import type { RollupOptionsBuilderOpts } from './standardRollupConfig';

function buildBinInputs(bins: string[]): { [entryAlias: string]: string } {
  return bins.reduce(
    (acc, bin) => ({
      ...acc,
      [bin]: `./src/bin/${bin}.ts`,
    }),
    {}
  );
}

async function validatePackageJsonBins({
  packageJson,
}: {
  packageJson: PackageJson;
}) {
  const bin = (packageJson['bin'] || {}) as Record<string, string>;
  const binEntries = Object.entries(bin);
  if (binEntries.length === 0) {
    return;
  }

  for (const [key, value] of binEntries) {
    const allowed = [`./bin/${key}.gen.cjs`, `./bin/${key}.gen.mjs`];
    if (!allowed.includes(value)) {
      throw new Error(
        `package.json "bin" prop is invalid: the entry "${key}" ` +
          `value can only be ${allowed
            .map((value) => `"${value}"`)
            .join(' or ')}`
      );
    }
  }

  const [srcBinContents, nodeModulesBinContents] = await Promise.all([
    readdir('./src/bin').catch(() => [] as string[]),
    readdir('./node_modules/.bin').catch(() => [] as string[]),
  ]);

  const { ourBins, mirroredBins, cjsBins, mjsBins, invalidBins } =
    binEntries.reduce<{
      ourBins: string[];
      mirroredBins: string[];
      invalidBins: string[];
      cjsBins: string[];
      mjsBins: string[];
    }>(
      (acc, [bin, value]) => {
        if (srcBinContents.includes(`${bin}.ts`)) {
          acc.ourBins.push(bin);
        } else {
          if (!nodeModulesBinContents.includes(bin)) {
            acc.invalidBins.push(bin);
          } else {
            acc.mirroredBins.push(bin);
          }
        }
        if (value.endsWith('.cjs')) {
          acc.cjsBins.push(bin);
        } else if (value.endsWith('.mjs')) {
          acc.mjsBins.push(bin);
        }
        return acc;
      },
      {
        ourBins: [],
        mirroredBins: [],
        invalidBins: [],
        cjsBins: [],
        mjsBins: [],
      }
    );

  if (invalidBins.length > 0) {
    throw new Error(
      'package.json "bin" prop is invalid: it has keys ' +
        `${invalidBins
          .map((key) => `"${key}"`)
          .join(', ')} that do not have corresponding ` +
        `source files in "./src/bin/*", eg "./src/bin/${String(
          invalidBins[0]
        )}.ts"`
    );
  }

  return {
    bin,
    ourBins,
    mirroredBins,
    cjsBins,
    mjsBins,
  };
}

function buildBinsPlugins({ mirroredBins }: { mirroredBins: string[] }) {
  // for bins which are declared in package.json but do not exist in
  // the ./src/bin directory we create a virtual module
  const generateModulesPlugin = virtual({
    ...mirroredBins.reduce(
      (acc, bin) => ({
        ...acc,
        // [location of the module]: 'source code of the module'
        [`./src/bin/${bin}.ts`]: `import { spawn } from 'child_process';

const cp = spawn(
  new URL("../node_modules/.bin/${bin}", import.meta.url).pathname,
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
    console.error("Failed to start", "${bin}", signal);
  }
});
`,
      }),
      {}
    ),
  });

  return {
    plugins: [generateModulesPlugin],
  };
}

export async function buildBinsBundleConfig({
  packageJson,
  defaultConfig,
}: RollupOptionsBuilderOpts): Promise<RollupWatchOptions[]> {
  const result = await validatePackageJsonBins({
    packageJson,
  });
  if (!result) {
    return [];
  }
  const { cjsBins, mjsBins, mirroredBins } = result;
  const { plugins } = buildBinsPlugins({
    mirroredBins,
  });

  const standard = defaultConfig();

  const shared: RollupWatchOptions = {
    ...standard,
    plugins: [...plugins, ...(standard.plugins ? standard.plugins : [])],
    output: {
      ...standard.output,
      dir: './bin',
    },
  };

  const cjsConfig = cjsBins.length > 0 && {
    ...shared,
    input: buildBinInputs(cjsBins),
    output: {
      ...shared.output,
      format: 'cjs',
      entryFileNames: `[name].gen.cjs`,
      chunkFileNames: `[name].gen.cjs`,
      banner: `#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed`,
    },
  };

  const mjsConfig = mjsBins.length > 0 && {
    ...shared,
    input: buildBinInputs(mjsBins),
    output: {
      ...shared.output,
      entryFileNames: `[name].gen.mjs`,
      chunkFileNames: `[name].gen.mjs`,
      banner: `#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed`,
    },
  };

  return [cjsConfig, mjsConfig].filter(isTruthy);
}
