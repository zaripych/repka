import config from './packages/build-tools/ts/configs/lint-staged/lintStaged.mjs';

export default {
  ...config,
  ['packages/build-tools/ts/**/*']: [
    () => `repka --cwd packages/build-tools/ts build:node`,
    "git add -- ':(glob)packages/build-tools/ts/**/*.gen.*'",
  ],
};
