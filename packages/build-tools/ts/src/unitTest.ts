import { jestStandardConfig } from './jest-cli/jest';
import { setFunctionName } from './utils/setFunctionName';

export function unitTest(): () => Promise<void> {
  return setFunctionName('unitTest', async () => {
    await jestStandardConfig(process.argv.slice(2));
  });
}
