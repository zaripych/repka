import { jestUnitTests } from './jest/jest';
import { declareTask } from './tasks/declareTask';

export function unitTest() {
  return declareTask({
    name: 'test',
    args: undefined,
    execute: async () => {
      await jestUnitTests(process.argv.slice(2));
    },
  });
}
