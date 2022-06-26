import { declareTask } from './tasks/declareTask';
import { declarationsViaDtsBundleGenerator } from './tsc/declarationsViaDtsBundleGenerator';
import { ensureTsConfigExists } from './tsc/ensureTsConfigExists';

export function declarations() {
  return declareTask({
    name: 'declarations',
    args: undefined,
    execute: async () => {
      await ensureTsConfigExists();
      await declarationsViaDtsBundleGenerator();
    },
  });
}
