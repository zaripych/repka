import { buildForNode, run } from '@build-tools/ts';

await run(
  // this package is built but never published
  buildForNode({
    resolveId: (id) => {
      switch (id) {
        case '#ansi-styles':
          return './node_modules/chalk/source/vendor/ansi-styles/index.js';
        case '#supports-color':
          return './node_modules/chalk/source/vendor/supports-color/index.js';
        default:
          return null;
      }
    },
  })
);
