import { buildForNode, pipeline } from '@build-tools/ts';

import { dtsBundleGeneratorBuildPlugins } from './src/dts-bundle-generator.build';

await pipeline(
  buildForNode({
    packageConfig: (deps) => ({
      ...deps,
      buildEntryPoints: () => [
        {
          entryPoint: '.',
          sourcePath: './src/index.ts',
          chunkName: 'main',
        },
      ],
    }),
    plugins: [...dtsBundleGeneratorBuildPlugins()],
  })
);
