---
"@repka-kit/ts": minor
---

fix(declarations): reverts back to less hacky fork of dts-bundle-generator which now relies on .d.ts files as input which are generated from "tsc --build tsconfig.json" command - supposed to be faster as well due to incremental compilation
