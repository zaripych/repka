import { createJestConfigForMonorepo } from './jestConfigHelpers.gen.mjs';

export default () =>
  createJestConfigForMonorepo({
    flavor: 'integration',
  });
