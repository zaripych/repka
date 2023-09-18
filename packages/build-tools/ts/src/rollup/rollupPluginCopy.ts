import fg from 'fast-glob';
import type { Plugin } from 'rollup';

import { copyFiles, type CopyOpts } from '../file-system/copyFiles';

export const rollupPluginCopy = (
  opts: Pick<
    CopyOpts,
    'source' | 'destination' | 'exclude' | 'include' | 'options'
  >
): Plugin => {
  return {
    name: 'copy',
    async buildStart() {
      const entries = fg.stream(opts.include, {
        followSymbolicLinks: false,
        ...opts.options,
      }) as AsyncIterable<string>;

      for await (const entry of entries) {
        this.addWatchFile(entry);
      }
    },
    async buildEnd() {
      await copyFiles({
        ...opts,
      });
    },
  };
};
