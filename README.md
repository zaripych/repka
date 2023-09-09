<p align="center">
  <img width="240" alt="Turnip or Repka" src="https://user-images.githubusercontent.com/396623/176195581-8ffe54c2-4096-4076-853d-645553af1903.png">
</p>

Have a look at example packages in [tooling-tests](./packages/tooling-tests/).

This is a work in progress at the moment.

## Features

- single dependency linting, bundling, testing and packaging for TypeScript
  projects
- supports both monorepo with multiple packages and single package repos
- minimum configuration required, driven by `package.json`
- configuration via TypeScript scripts with auto-completion
- ESM support by default

## Core Dependencies

- node@16
- typescript
- esbuild - (to be compared to swc)
- rollup - (for bundling packages targeting node.js)
- eslint
- prettier
- jest
- lint-staged - (customized version that stashes all changes including untracked
  files)
- dts-bundle-generator - forked version which turned into bundler

## Roadmap

- [x] `init` command for first time initialization
- [x] test on `Windows OS`, test with `npm` and `yarn` package managers
- [ ] get rid of `turbo` dependency as it was found to be clunky and not super
      beneficial
- [ ] `@repka-kit/node` to be split out of `@repka-kit/ts` in preparation of
      `@repka-kit/web`

## Documentation

TODO

### Attributions

<a href="https://github.com/timocov/dts-bundle-generator" title="dts-bundle-generator">Forked
version of the DTS Bundle Generator is used to generate .d.ts files</a>

<a href="https://www.flaticon.com/free-icons/turnip" title="turnip icons">Turnip
icons created by Ridho Imam Prayogi - Flaticon</a>
