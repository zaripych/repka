import { buildForNode, run } from '@build-tools/ts';

await run(
  // this package is built but never published
  buildForNode()
);
