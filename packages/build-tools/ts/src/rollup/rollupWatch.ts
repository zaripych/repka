import type { RollupOptions } from 'rollup';
import { rollup } from 'rollup';

export async function rollupBuild(opts: RollupOptions) {
  const { output: outputProp, ...inputProps } = opts;
  const output = Array.isArray(outputProp)
    ? outputProp
    : outputProp
    ? [outputProp]
    : [];
  const builder = await rollup(inputProps);
  return await Promise.all(output.map((out) => builder.write(out)));
}
