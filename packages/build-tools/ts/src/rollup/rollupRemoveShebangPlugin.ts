import { createFilter } from '@rollup/pluginutils';
import MagicString from 'magic-string';
import type { Plugin, SourceMapInput } from 'rollup';

type Filter = string | RegExp;

export const rollupRemoveShebangPlugin = (opts?: {
  include?: Filter[];
  exclude?: Filter[];
}): Plugin => {
  const filter = createFilter(opts?.include, opts?.exclude);
  return {
    name: 'removeShebang',
    renderChunk(code, chunk, options) {
      if (!filter(chunk.fileName)) return null;

      const sourceMaps = Boolean(options.sourcemap);

      const result: { code: string; map?: SourceMapInput } = {
        code,
        map: null,
      };

      if (code.startsWith('#!')) {
        const magicString = new MagicString(code).remove(
          0,
          code.indexOf('\n') + 1
        );
        result.code = magicString.toString();
        if (sourceMaps) {
          result.map = magicString.generateMap({ hires: true });
        }
      }

      return result;
    },
  };
};
