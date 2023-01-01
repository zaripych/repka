import { createJestConfigForSinglePackage } from './jestConfigHelpers.gen.mjs';

export default () =>
  createJestConfigForSinglePackage({
    flavor: 'unit',
  });
