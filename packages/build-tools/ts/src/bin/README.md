Simply add an entry in package.json to automatically generate a bin that wraps a bin from node_modules
of the @build-tools/ts, alternatively create `${bin}.ts` file similar to `lint-staged.ts` to override
the default wrapper implementation which resides in `runBin.ts`
