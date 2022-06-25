import { copyFiles } from './file-system/copyFiles';
import { logger } from './logger/logger';
import { declareTask } from './tasks/declareTask';

export const copy = (opts: {
  source?: string;
  include: string[];
  exclude?: string[];
  destination: string;
}) => {
  return declareTask({
    name: 'copy',
    args: opts,
    execute: async () => {
      logger.log('Copying', opts);
      await copyFiles(opts);
    },
  });
};
