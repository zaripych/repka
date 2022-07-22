import { jest } from '../jest/jest';
import { cliArgsPipe, setDefaultArgs } from '../utils/cliArgsPipe';
import { configFilePath } from '../utils/configFilePath';

const runJest = async () => {
  await jest(
    cliArgsPipe(
      [
        setDefaultArgs(
          [`--config`, '-c'],
          [configFilePath('./jest/jestConfigRootUnit.mjs')]
        ),
      ],
      process.argv.slice(2)
    ),
    {
      exitCodes: 'inherit',
    }
  );
};

await runJest();
