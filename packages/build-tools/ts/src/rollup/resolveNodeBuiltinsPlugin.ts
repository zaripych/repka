import nodeBuiltins from 'builtin-modules/static.js';
import type { Plugin } from 'rollup';

import { once } from '../utils/once';

const allBuiltins = once(() =>
  nodeBuiltins
    .flatMap((builtin) => [builtin, `node:${builtin}`])
    .concat(['fs/promises', 'node:fs/promises'])
);

export const resolveNodeBuiltinsPlugin = (): Plugin => {
  return {
    name: 'node:builtins',
    resolveId(source) {
      if (allBuiltins().includes(source)) {
        return {
          id: source.replace('node:', ''),
          external: true,
        };
      }
      return null;
    },
  };
};
