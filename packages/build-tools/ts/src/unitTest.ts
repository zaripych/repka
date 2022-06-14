import { jestUnitTests } from './jest/jest';
import { setFunctionName } from './utils/setFunctionName';

export function unitTest(): () => Promise<void> {
  return setFunctionName('unitTest', async () => {
    await jestUnitTests(process.argv.slice(2));
  });
}
