#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed
import { spawn } from 'node:child_process';

const cp = spawn(new URL("../node_modules/.bin/tsx", import.meta.url).pathname, [new URL("../src/bin/jest.ts", import.meta.url).pathname, ...process.argv.slice(2)], { stdio: "inherit" });
cp.on("error", (err) => {
  console.error(err);
  process.exitCode = 1;
});
cp.on("close", (code, signal) => {
  if (typeof code === "number") {
    process.exitCode = code;
  } else if (typeof signal === "string") {
    console.error("Failed to start", "jest", signal);
  }
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdC5nZW4ubWpzIiwic291cmNlcyI6W10sInNvdXJjZXNDb250ZW50IjpbXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7OyJ9
