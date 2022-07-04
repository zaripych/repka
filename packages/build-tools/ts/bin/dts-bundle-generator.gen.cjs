#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed
'use strict';

var node_child_process = require('node:child_process');

const cp = node_child_process.spawn(new URL("../node_modules/.bin/dts-bundle-generator", (typeof document === 'undefined' ? new (require('u' + 'rl').URL)('file:' + __filename).href : (document.currentScript && document.currentScript.src || new URL('dts-bundle-generator.gen.cjs', document.baseURI).href))).pathname, process.argv.slice(2), { stdio: "inherit" });
cp.on("error", (err) => {
  console.error(err);
  process.exitCode = 1;
});
cp.on("close", (code, signal) => {
  if (typeof code === "number") {
    process.exitCode = code;
  } else if (typeof signal === "string") {
    console.error("Failed to start", "dts-bundle-generator", signal);
  }
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHRzLWJ1bmRsZS1nZW5lcmF0b3IuZ2VuLmNqcyIsInNvdXJjZXMiOltdLCJzb3VyY2VzQ29udGVudCI6W10sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7In0=
