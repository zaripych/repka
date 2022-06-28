<p align="center">
  <img width="240" alt="Turnip or Repka" src="https://user-images.githubusercontent.com/396623/176195581-8ffe54c2-4096-4076-853d-645553af1903.png">
</p>

Have a look at example packages in [tooling-tests](./packages/tooling-tests/).

This is a work in progress at the moment.

## Features

- single dependency linting, bundling, testing and packaging for TypeScript projects
- supports both monorepo with multiple packages and single package repos
- minimum configuration required, driven by `package.json` and TypeScript scripts
- ESM support by default

## Core Dependencies

- node@16
- typescript
- esbuild - (to be compared to swc)
- rollup - (for bundling packages targeting node.js)
- eslint
- prettier
- jest
- turbo - (as dependency at the moment with planned auto-generation of turbo.json)
- lint-staged - (customized version that stashes all changes including untracked files)
- vite - (planned as bundler for FE apps if `vite-federation` lives up to expectations, otherwise webpack with esbuild/swc)
- dts-bundle-generator - forked version which turned into bundler

## Roadmap

TODO

## Documentation

TODO

### Attributions

<a href="https://www.flaticon.com/free-icons/turnip" title="turnip icons">Turnip icons created by Ridho Imam Prayogi - Flaticon</a>
