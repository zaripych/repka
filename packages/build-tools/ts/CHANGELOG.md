# @repka-kit/ts

## 1.0.0-beta.5

### Minor Changes

- [#5](https://github.com/zaripych/repka/pull/5) [`4cc3889`](https://github.com/zaripych/repka/commit/4cc388912e3e2659bb57dd126f551e85c02b3e83) Thanks [@zaripych](https://github.com/zaripych)! - feat(init): adds init command which allows to initialize your repository to start using repka

## 1.0.0-beta.4

### Minor Changes

- [`a247db8`](https://github.com/zaripych/repka/commit/a247db8cf8cdd328c053b0e8bc895e5b4b72b8cf) Thanks [@zaripych](https://github.com/zaripych)! - fix: writes unsupported globs and conditions from package.json exports to resulting package.json as is without changes

* [`18112ae`](https://github.com/zaripych/repka/commit/18112ae9a7007069b69fb5ee9fe567ec07cb6fe9) Thanks [@zaripych](https://github.com/zaripych)! - Add pre-configured jest and eslint as bins allowing developers to use them without specifying any extra parameters that are typically would be required in a monorepo

## 1.0.0-beta.3

### Minor Changes

- [`7d81d3b`](https://github.com/zaripych/repka/commit/7d81d3bd924e22165ac034853631e88d8565f7ee) Thanks [@zaripych](https://github.com/zaripych)! - repka now has cli which allows you to lint, test and build packages via CLI without having to create a TypeScript script - while the script still remains as means to configure and go beyond default settings

## 1.0.0-beta.2

### Minor Changes

- [`e844c9d`](https://github.com/zaripych/repka/commit/e844c9dc9367067978c59daba502080f2217e6e3) Thanks [@zaripych](https://github.com/zaripych)! - fix(declarations): revert back to less hacky fork of dts-bundle-generator which now relies on .d.ts files as input which are generated from "tsc --build tsconfig.json" command - supposed to be faster as well due to incremental compilation

## 1.0.0-beta.1

### Patch Changes

- [`9f9c2f8`](https://github.com/zaripych/repka/commit/9f9c2f83e01d4277537df5bddcae41ca428f5328) Thanks [@zaripych](https://github.com/zaripych)! - Upgrade dependencies

* [`0fd524d`](https://github.com/zaripych/repka/commit/0fd524dcb6c72d9d1e7dbd7228f4934a923ce48e) Thanks [@zaripych](https://github.com/zaripych)! - Reduces console output verbosity, allows controlling console output verbosity via `--log-level` parameter and `LOG_LEVEL` environment variable which is respected by all tasks.

## 1.0.0-beta.0

### Major Changes

- Initial beta version of the @repka-kit/ts
