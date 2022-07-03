import virtual from '@rollup/plugin-virtual';
import type { RollupWatchOptions } from 'rollup';

import { isTruthy } from '../utils/isTruthy';
import { UnreachableError } from '../utils/unreachableError';
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

export function buildBinsBundleConfig({
  config,
  defaultRollupConfig,
}: RollupOptionsBuilderOpts): RollupWatchOptions[] {
  if (config.binEntryPoints.length === 0) {
    return [];
  }
  const { cjsBins, mjsBins, mirroredBins } = config.binEntryPoints.reduce<{
    cjsBins: string[];
    mjsBins: string[];
    mirroredBins: string[];
  }>(
    (acc, next) => {
      switch (next.format) {
        case 'cjs': {
          acc.cjsBins.push(next.binName);
          break;
        }
        case 'esm': {
          acc.mjsBins.push(next.binName);
          break;
        }
        default:
          throw new UnreachableError(next.format);
      }
      if (next.binEntryType === 'dependency-bin') {
        acc.mirroredBins.push(next.binName);
      }
      return acc;
    },
    { cjsBins: [], mjsBins: [], mirroredBins: [] }
  );
  const { plugins } = buildBinsPlugins({
    mirroredBins,
  });

  const standard = defaultRollupConfig();

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
