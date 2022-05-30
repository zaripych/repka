import type { TransformOptions } from 'esbuild';
import { transform } from 'esbuild';
import type { Plugin } from 'rollup';

const defaultOptions = {
  treeShaking: true,
};

export function esbuild(options: TransformOptions): Plugin {
  options = { ...defaultOptions, ...options };
  return {
    name: 'esbuild',
    async transform(src, id) {
      options.sourcefile = id;
      const { code, map } = await transform(src, options);
      return { code, map };
    },
  };
}
