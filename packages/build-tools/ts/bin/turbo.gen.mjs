#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed
import { relative } from 'node:path';
import { c as cliArgsPipe, b as setDefaultArgs, d as insertAfterAnyOf, i as includesAnyOf } from './taskArgsPipe.gen.mjs';
import { m as monorepoRootPath } from './monorepoRootPath.gen.mjs';
import { r as runBin } from './runBin.gen.mjs';
import 'node:child_process';
import 'node:assert';
import 'fast-glob';

const runTurbo = async () => {
  const root = await monorepoRootPath();
  await runBin("turbo", cliArgsPipe([
    setDefaultArgs([`--filter`], ["./" + relative(root, process.cwd())], (args) => root !== process.cwd() && includesAnyOf(args.inputArgs, ["run"]), (args, state) => ({
      ...state,
      inputArgs: insertAfterAnyOf(state.inputArgs, args, ["run"])
    }))
  ], process.argv.slice(2)), {
    cwd: root
  });
};
await runTurbo();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHVyYm8uZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vc3JjL2Jpbi90dXJiby50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyByZWxhdGl2ZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7XG4gIGNsaUFyZ3NQaXBlLFxuICBpbmNsdWRlc0FueU9mLFxuICBpbnNlcnRBZnRlckFueU9mLFxuICBzZXREZWZhdWx0QXJncyxcbn0gZnJvbSAnLi4vdXRpbHMvY2xpQXJnc1BpcGUnO1xuaW1wb3J0IHsgbW9ub3JlcG9Sb290UGF0aCB9IGZyb20gJy4uL3V0aWxzL21vbm9yZXBvUm9vdFBhdGgnO1xuaW1wb3J0IHsgcnVuQmluIH0gZnJvbSAnLi9ydW5CaW4nO1xuXG5jb25zdCBydW5UdXJibyA9IGFzeW5jICgpID0+IHtcbiAgY29uc3Qgcm9vdCA9IGF3YWl0IG1vbm9yZXBvUm9vdFBhdGgoKTtcbiAgYXdhaXQgcnVuQmluKFxuICAgICd0dXJibycsXG4gICAgY2xpQXJnc1BpcGUoXG4gICAgICBbXG4gICAgICAgIHNldERlZmF1bHRBcmdzKFxuICAgICAgICAgIFtgLS1maWx0ZXJgXSxcbiAgICAgICAgICBbJy4vJyArIHJlbGF0aXZlKHJvb3QsIHByb2Nlc3MuY3dkKCkpXSxcbiAgICAgICAgICAoYXJncykgPT5cbiAgICAgICAgICAgIHJvb3QgIT09IHByb2Nlc3MuY3dkKCkgJiYgaW5jbHVkZXNBbnlPZihhcmdzLmlucHV0QXJncywgWydydW4nXSksXG4gICAgICAgICAgKGFyZ3MsIHN0YXRlKSA9PiAoe1xuICAgICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgICBpbnB1dEFyZ3M6IGluc2VydEFmdGVyQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBhcmdzLCBbJ3J1biddKSxcbiAgICAgICAgICB9KVxuICAgICAgICApLFxuICAgICAgXSxcbiAgICAgIHByb2Nlc3MuYXJndi5zbGljZSgyKVxuICAgICksXG4gICAge1xuICAgICAgY3dkOiByb290LFxuICAgIH1cbiAgKTtcbn07XG5cbmF3YWl0IHJ1blR1cmJvKCk7XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7OztBQVdBLE1BQU0sV0FBVyxZQUFZO0FBQzNCLEVBQU0sTUFBQSxJQUFBLEdBQU8sTUFBTSxnQkFBaUIsRUFBQSxDQUFBO0FBQ3BDLEVBQU0sTUFBQSxNQUFBLENBQ0osU0FDQSxXQUNFLENBQUE7QUFBQSxJQUNFLGNBQ0UsQ0FBQSxDQUFDLENBQVUsUUFBQSxDQUFBLENBQUEsRUFDWCxDQUFDLElBQUEsR0FBTyxRQUFTLENBQUEsSUFBQSxFQUFNLE9BQVEsQ0FBQSxHQUFBLEVBQUssQ0FBQyxDQUNyQyxFQUFBLENBQUMsSUFDQyxLQUFBLElBQUEsS0FBUyxPQUFRLENBQUEsR0FBQSxFQUFTLElBQUEsYUFBQSxDQUFjLElBQUssQ0FBQSxTQUFBLEVBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQSxFQUNqRSxDQUFDLElBQUEsRUFBTSxLQUFXLE1BQUE7QUFBQSxNQUNoQixHQUFHLEtBQUE7QUFBQSxNQUNILFdBQVcsZ0JBQWlCLENBQUEsS0FBQSxDQUFNLFdBQVcsSUFBTSxFQUFBLENBQUMsS0FBSyxDQUFDLENBQUE7QUFBQSxLQUU5RCxDQUFBLENBQUE7QUFBQSxLQUVGLE9BQVEsQ0FBQSxJQUFBLENBQUssS0FBTSxDQUFBLENBQUMsQ0FDdEIsQ0FDQSxFQUFBO0FBQUEsSUFDRSxHQUFLLEVBQUEsSUFBQTtBQUFBLEdBRVQsQ0FBQSxDQUFBO0FBQ0YsQ0FBQSxDQUFBO0FBRUEsTUFBTSxRQUFTLEVBQUEifQ==
