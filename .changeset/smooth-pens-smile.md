---
'@repka-kit/ts': patch
---

feat(bins): improve bins experience - we can now simply use TypeScript for bin
entries, as long as they have a shebang (ie '#!/usr/bin/env tsx') as first line
in the source file the bin entry points to. This is much better experience than
having to deal with generated .gen.cjs/mjs files that we then have to commit
along with the source code.

Here is an
[example](https://github.com/zaripych/repka/blob/e804d34feba9e4205ffd4e9f791bee7e4dc96ac2/packages/build-tools/ts/src/bin/eslint.ts#L1)
of a source file that this
[bin](https://github.com/zaripych/repka/blob/e804d34feba9e4205ffd4e9f791bee7e4dc96ac2/packages/build-tools/ts/package.json#L33)
entry points to from "package.json".

Now `eslint` bin becomes available to us in the terminal at dev-time as well as
in the production bundle.
