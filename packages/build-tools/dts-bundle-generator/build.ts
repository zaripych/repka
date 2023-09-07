import { buildForNode, pipeline } from '@build-tools/ts';

import { dtsBundleGeneratorBuildPlugins } from './src/dts-bundle-generator.build';

await pipeline(
  buildForNode({
    packageConfig: (deps) => ({
      ...deps,
      buildEntryPoints: () => ({
        entryPoints: [
          {
            entryPoint: '.',
            sourcePath: './src/index.ts',
            chunkName: 'main',
          },
        ],
      }),
    }),
    plugins: [...dtsBundleGeneratorBuildPlugins()],
    outputPackageJson(packageJson) {
      return {
        ...packageJson,
        types: './dist/main.d.ts',
      };
    },
  }),
  async () => {
    // alleviate issues that might be caused by circular dependency
    // between @build-tools/ts and @build-tools/dts-bundle-generator
    const { declarations, copyFiles } = await import('@build-tools/ts');
    try {
      await declarations({
        packageConfig: (deps) => ({
          ...deps,
          buildEntryPoints: () => ({
            entryPoints: [
              {
                entryPoint: '.',
                sourcePath: './src/index.ts',
                chunkName: 'main',
              },
            ],
          }),
        }),
        unstable_skipDependencies: ['@repka-kit/ts'],
      }).execute?.();
    } catch (err) {
      // if generating failed, copy the existing .d.ts files
      // to the dist folder
      await copyFiles({
        source: './src/',
        destination: './dist/dist/',
        include: ['*.d.ts'],
      });
    }
  }
);
