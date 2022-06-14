import { pipeline, unitTest } from '@build-tools/ts';

await pipeline(unitTest());
