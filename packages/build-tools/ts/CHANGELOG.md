# @repka-kit/ts

## 1.0.3

### Patch Changes

- [`5a916a7`](https://github.com/zaripych/repka/commit/5a916a744aaa35ea2eb30924e1d8bc0cbab5dc3f)
  Thanks [@zaripych](https://github.com/zaripych)! - dependencies: upgrade most
  of the dependencies

## 1.0.2

### Patch Changes

- [#24](https://github.com/zaripych/repka/pull/24)
  [`ff5ed6c`](https://github.com/zaripych/repka/commit/ff5ed6cbfca65a0cd39f8bb7eeef3dca47a7d90c)
  Thanks [@zaripych](https://github.com/zaripych)! - fix: get rid of the
  unmaintained esbuild-jest dependency in favour of pure esbuild transformer
  without mocks hoisting

## 1.0.1

### Patch Changes

- [#22](https://github.com/zaripych/repka/pull/22)
  [`d659637`](https://github.com/zaripych/repka/commit/d659637a7318334d75324dc59b0bdbc6c01caa08)
  Thanks [@zaripych](https://github.com/zaripych)! - Include TypeScript
  declarations in the published package

- [#22](https://github.com/zaripych/repka/pull/22)
  [`d659637`](https://github.com/zaripych/repka/commit/d659637a7318334d75324dc59b0bdbc6c01caa08)
  Thanks [@zaripych](https://github.com/zaripych)! - Update dts-bundle-generator
  to the latest version

## 1.0.0

### Major Changes

- [`be82f73`](https://github.com/zaripych/repka/commit/be82f735598edb49dabd5914175d0dfa9e70680f)
  Thanks [@zaripych](https://github.com/zaripych)! - feat(beta): initial beta
  version of the @repka-kit/ts

### Minor Changes

- [`e844c9d`](https://github.com/zaripych/repka/commit/e844c9dc9367067978c59daba502080f2217e6e3)
  Thanks [@zaripych](https://github.com/zaripych)! - fix(declarations): reverts
  back to less hacky fork of dts-bundle-generator which now relies on .d.ts
  files as input which are generated from "tsc --build tsconfig.json" command -
  supposed to be faster as well due to incremental compilation

- [#5](https://github.com/zaripych/repka/pull/5)
  [`4cc3889`](https://github.com/zaripych/repka/commit/4cc388912e3e2659bb57dd126f551e85c02b3e83)
  Thanks [@zaripych](https://github.com/zaripych)! - feat(init): adds init
  command which allows to initialize your repository to start using repka

- [`7d81d3b`](https://github.com/zaripych/repka/commit/7d81d3bd924e22165ac034853631e88d8565f7ee)
  Thanks [@zaripych](https://github.com/zaripych)! - feat(cli): adds cli which
  allows you to lint, test and build packages via CLI without having to create a
  TypeScript script - while the script still remains as means to configure and
  go beyond default settings

- [`18112ae`](https://github.com/zaripych/repka/commit/18112ae9a7007069b69fb5ee9fe567ec07cb6fe9)
  Thanks [@zaripych](https://github.com/zaripych)! - feat(no-config): adds
  pre-configured jest and eslint as bins allowing developers to use them without
  specifying any extra parameters that are typically would be required in a
  monorepo

- [`9d6b433`](https://github.com/zaripych/repka/commit/9d6b43332d7e6795cd48da6922aa6fdba11c4adf)
  Thanks [@zaripych](https://github.com/zaripych)! - Upgrade important
  dependencies: rollup, typescript, jest, allow overriding contents of the
  package.json used to distribute bundled package

### Patch Changes

- [`cbc189f`](https://github.com/zaripych/repka/commit/cbc189f5e586bd3455e9139b82132fd93bb7c5fe)
  Thanks [@zaripych](https://github.com/zaripych)! - Make sure experimental VM
  modules node warning is silenced.

- [#15](https://github.com/zaripych/repka/pull/15)
  [`3200535`](https://github.com/zaripych/repka/commit/3200535bc80faffbc84e56b8c152b0b40404050d)
  Thanks [@zaripych](https://github.com/zaripych)! - fix(turbo): remove turbo as
  dependency

- [#11](https://github.com/zaripych/repka/pull/11)
  [`8996c10`](https://github.com/zaripych/repka/commit/8996c10d075b9b1621d25e262e20315250a0c698)
  Thanks [@zaripych](https://github.com/zaripych)! - feat(bins): improve bins
  experience - we can now simply use TypeScript for bin entries, as long as they
  have a shebang (ie '#!/usr/bin/env tsx') as first line in the source file the
  bin entry points to. This is much better experience than having to deal with
  generated .gen.cjs/mjs files that we then have to commit along with the source
  code.

  Here is an
  [example](https://github.com/zaripych/repka/blob/e804d34feba9e4205ffd4e9f791bee7e4dc96ac2/packages/build-tools/ts/src/bin/eslint.ts#L1)
  of a source file that this
  [bin](https://github.com/zaripych/repka/blob/e804d34feba9e4205ffd4e9f791bee7e4dc96ac2/packages/build-tools/ts/package.json#L33)
  entry points to from "package.json".

  Now `eslint` bin becomes available to us in the terminal at dev-time as well
  as in the production bundle.

- [#18](https://github.com/zaripych/repka/pull/18)
  [`eb17c89`](https://github.com/zaripych/repka/commit/eb17c89aea7d356711d3dce594d85a7fce15dbdf)
  Thanks [@zaripych](https://github.com/zaripych)! - feat(package.json): globs
  are now supported in "exports" field

- [`0fd524d`](https://github.com/zaripych/repka/commit/0fd524dcb6c72d9d1e7dbd7228f4934a923ce48e)
  Thanks [@zaripych](https://github.com/zaripych)! - feat(diagnostics): reduces
  console output verbosity, allows controlling console output verbosity via
  `--log-level` parameter and `LOG_LEVEL` environment variable which is
  respected by all tasks.

- [#10](https://github.com/zaripych/repka/pull/10)
  [`908ba28`](https://github.com/zaripych/repka/commit/908ba28e2881dfcd35284751576a8e25d26fe3fc)
  Thanks [@zaripych](https://github.com/zaripych)! - fix(windows): make it work
  on windows, make tests run on windows as well

## 1.0.0-beta.9

### Patch Changes

- [#18](https://github.com/zaripych/repka/pull/18)
  [`eb17c89`](https://github.com/zaripych/repka/commit/eb17c89aea7d356711d3dce594d85a7fce15dbdf)
  Thanks [@zaripych](https://github.com/zaripych)! - feat(package.json): globs
  are now supported in "exports" field

## 1.0.0-beta.8

### Patch Changes

- [#15](https://github.com/zaripych/repka/pull/15)
  [`3200535`](https://github.com/zaripych/repka/commit/3200535bc80faffbc84e56b8c152b0b40404050d)
  Thanks [@zaripych](https://github.com/zaripych)! - fix(turbo): remove turbo as
  dependency

- [#11](https://github.com/zaripych/repka/pull/11)
  [`8996c10`](https://github.com/zaripych/repka/commit/8996c10d075b9b1621d25e262e20315250a0c698)
  Thanks [@zaripych](https://github.com/zaripych)! - feat(bins): improve bins
  experience - we can now simply use TypeScript for bin entries, as long as they
  have a shebang (ie '#!/usr/bin/env tsx') as first line in the source file the
  bin entry points to. This is much better experience than having to deal with
  generated .gen.cjs/mjs files that we then have to commit along with the source
  code.

  Here is an
  [example](https://github.com/zaripych/repka/blob/e804d34feba9e4205ffd4e9f791bee7e4dc96ac2/packages/build-tools/ts/src/bin/eslint.ts#L1)
  of a source file that this
  [bin](https://github.com/zaripych/repka/blob/e804d34feba9e4205ffd4e9f791bee7e4dc96ac2/packages/build-tools/ts/package.json#L33)
  entry points to from "package.json".

  Now `eslint` bin becomes available to us in the terminal at dev-time as well
  as in the production bundle.

- [#10](https://github.com/zaripych/repka/pull/10)
  [`908ba28`](https://github.com/zaripych/repka/commit/908ba28e2881dfcd35284751576a8e25d26fe3fc)
  Thanks [@zaripych](https://github.com/zaripych)! - fix(windows): make it work
  on windows, make tests run on windows as well

## 1.0.0-beta.7

### Patch Changes

- [`cbc189f`](https://github.com/zaripych/repka/commit/cbc189f5e586bd3455e9139b82132fd93bb7c5fe)
  Thanks [@zaripych](https://github.com/zaripych)! - Make sure experimental VM
  modules node warning is silenced.

## 1.0.0-beta.6

### Minor Changes

- [`9d6b433`](https://github.com/zaripych/repka/commit/9d6b43332d7e6795cd48da6922aa6fdba11c4adf)
  Thanks [@zaripych](https://github.com/zaripych)! - Upgrade important
  dependencies: rollup, typescript, jest, allow overriding contents of the
  package.json used to distribute bundled package

## 1.0.0-beta.5

### Minor Changes

- [#5](https://github.com/zaripych/repka/pull/5)
  [`4cc3889`](https://github.com/zaripych/repka/commit/4cc388912e3e2659bb57dd126f551e85c02b3e83)
  Thanks [@zaripych](https://github.com/zaripych)! - feat(init): adds init
  command which allows to initialize your repository to start using repka

## 1.0.0-beta.4

### Minor Changes

- [`a247db8`](https://github.com/zaripych/repka/commit/a247db8cf8cdd328c053b0e8bc895e5b4b72b8cf)
  Thanks [@zaripych](https://github.com/zaripych)! - fix: writes unsupported
  globs and conditions from package.json exports to resulting package.json as is
  without changes

* [`18112ae`](https://github.com/zaripych/repka/commit/18112ae9a7007069b69fb5ee9fe567ec07cb6fe9)
  Thanks [@zaripych](https://github.com/zaripych)! - Add pre-configured jest and
  eslint as bins allowing developers to use them without specifying any extra
  parameters that are typically would be required in a monorepo

## 1.0.0-beta.3

### Minor Changes

- [`7d81d3b`](https://github.com/zaripych/repka/commit/7d81d3bd924e22165ac034853631e88d8565f7ee)
  Thanks [@zaripych](https://github.com/zaripych)! - repka now has cli which
  allows you to lint, test and build packages via CLI without having to create a
  TypeScript script - while the script still remains as means to configure and
  go beyond default settings

## 1.0.0-beta.2

### Minor Changes

- [`e844c9d`](https://github.com/zaripych/repka/commit/e844c9dc9367067978c59daba502080f2217e6e3)
  Thanks [@zaripych](https://github.com/zaripych)! - fix(declarations): revert
  back to less hacky fork of dts-bundle-generator which now relies on .d.ts
  files as input which are generated from "tsc --build tsconfig.json" command -
  supposed to be faster as well due to incremental compilation

## 1.0.0-beta.1

### Patch Changes

- [`9f9c2f8`](https://github.com/zaripych/repka/commit/9f9c2f83e01d4277537df5bddcae41ca428f5328)
  Thanks [@zaripych](https://github.com/zaripych)! - Upgrade dependencies

* [`0fd524d`](https://github.com/zaripych/repka/commit/0fd524dcb6c72d9d1e7dbd7228f4934a923ce48e)
  Thanks [@zaripych](https://github.com/zaripych)! - Reduces console output
  verbosity, allows controlling console output verbosity via `--log-level`
  parameter and `LOG_LEVEL` environment variable which is respected by all
  tasks.

## 1.0.0-beta.0

### Major Changes

- Initial beta version of the @repka-kit/ts
