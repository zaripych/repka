import { declarations, pipeline } from '@build-tools/ts';

await pipeline(
  declarations({
    unstable_ignoreTypeScriptErrors: true,
  })
);
