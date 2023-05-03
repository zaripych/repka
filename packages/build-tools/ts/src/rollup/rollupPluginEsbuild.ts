import { createFilter } from '@rollup/pluginutils';
import type { TransformOptions } from 'esbuild';
import { transform } from 'esbuild';
import type { Plugin } from 'rollup';

const defaultOptions = {
  treeShaking: true,
};

type Filter = string | RegExp;

export function esbuild({
  include,
  exclude,
  ...options
}: TransformOptions & {
  include?: Filter[];
  exclude?: Filter[];
}): Plugin {
  options = { ...defaultOptions, ...options };
  const filter = createFilter(include, exclude);
  return {
    name: 'esbuild',
    async transform(src, id) {
      if (!filter(id)) {
        return null;
      }

      options.sourcefile = id;
      const { code, map } = await transform(src, options);
      return { code, map };
    },
  };
}
