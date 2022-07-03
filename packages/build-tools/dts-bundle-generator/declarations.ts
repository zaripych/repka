import { declarations, pipeline } from '@build-tools/ts';

await pipeline(
  declarations({
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
  })
);
