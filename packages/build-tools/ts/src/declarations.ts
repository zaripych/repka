import { declareTask } from './tasks/declareTask';
import type { DeclarationsOpts } from './tsc/declarationsViaDtsBundleGenerator';
import { declarationsViaDtsBundleGenerator } from './tsc/declarationsViaDtsBundleGenerator';
import { ensureTsConfigExists } from './tsc/ensureTsConfigExists';

export function declarations(opts?: DeclarationsOpts) {
  return declareTask({
    name: 'declarations',
    args: undefined,
    execute: async () => {
      await ensureTsConfigExists();
      await declarationsViaDtsBundleGenerator(opts);
    },
  });
}
