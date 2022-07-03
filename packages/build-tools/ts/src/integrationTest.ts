import { jestIntegrationTests } from './jest/jest';
import { declareTask } from './tasks/declareTask';

export function integrationTest() {
  return declareTask({
    name: 'integration',
    args: undefined,
    execute: async () => {
      await jestIntegrationTests();
    },
  });
}
