#!/usr/bin/env tsx
import { jest } from '../jest/jest';
import {
  cliArgsPipe,
  removeInputArgs,
  setDefaultArgs,
} from '../utils/cliArgsPipe';
import { configFilePath } from '../utils/configFilePath';

const runJest = async () => {
  const isIntegration = process.argv.includes('--integration');
  await jest(
    cliArgsPipe(
      [
        setDefaultArgs(
          [`--config`, '-c'],
          [
            isIntegration
              ? configFilePath('./jest/jestConfigRootIntegration.mjs')
              : configFilePath('./jest/jestConfigRootUnit.mjs'),
          ]
        ),
        removeInputArgs(['--integration']),
      ],
      process.argv.slice(2)
    ),
    {
      exitCodes: 'inherit',
    }
  );
};

await runJest();
