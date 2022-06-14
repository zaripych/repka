import { lint, pipeline } from '@build-tools/ts';

await pipeline(lint());
