import { buildForNode, pipeline } from '@repka-kit/ts';

await pipeline(
  // this package is built but never published
  buildForNode()
);
