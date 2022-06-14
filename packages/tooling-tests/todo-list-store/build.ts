import { buildForNode, pipeline } from '@build-tools/ts';

await pipeline(
  // this package is built but never published
  buildForNode()
);
