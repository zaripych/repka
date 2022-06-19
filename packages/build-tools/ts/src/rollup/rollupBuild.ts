import type { RollupCache, RollupOptions } from 'rollup';
import { rollup } from 'rollup';

import { once } from '../utils/once';

const rollupCache = once((): RollupCache => {
  return {
    modules: [],
    plugins: {},
  };
});

export async function rollupBuild(opts: RollupOptions) {
  const { output: outputProp, ...inputProps } = opts;
  const output = Array.isArray(outputProp)
    ? outputProp
    : outputProp
    ? [outputProp]
    : [];
  const builder = await rollup({
    ...inputProps,
    cache: rollupCache(),
  });
  const results = await Promise.all(output.map((out) => builder.write(out)));
  if (builder.getTimings) {
    console.log('Timings for', inputProps.input);
    console.log(builder.getTimings());
  }
  return results;
}
