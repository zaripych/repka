import { spawn } from 'child_process';
import { join } from 'path';

import { spawnToPromise } from './child-process';
import { parseEntryPoints } from './package-json/parseEntryPoints';
import { readCwdPackageJson } from './package-json/readPackageJson';
import { validatePackageJson } from './package-json/validatePackageJson';
import { declareTask } from './tasks/declareTask';

const generatorPath = () =>
  new URL('../bin/dts-bundle-generator.gen.cjs', import.meta.url).pathname;

export function declarations() {
  return declareTask({
    name: 'declarations',
    args: undefined,
    execute: async () => {
      const packageJson = validatePackageJson(await readCwdPackageJson());

      const entryPoints = Object.values(parseEntryPoints(packageJson.exports));

      const dtsBundleGeneratorConfigFile = {
        compilationOptions: {
          preferredConfigPath: './tsconfig.json',
        },
        entries: entryPoints.map((entry) => {
          const input = join(entry.value);
          const output = join('./dist/dist', entry.name + '.es.d.ts');
          return {
            filePath: input,
            outFile: output,
          };
        }),
      };

      const child = spawn(process.execPath, [generatorPath(), '--silent'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'inherit', 'inherit'],
      });
      child.stdin.setDefaultEncoding('utf-8');
      const writeToStdin = () =>
        new Promise<void>((res, rej) => {
          child.stdin.write(
            JSON.stringify(dtsBundleGeneratorConfigFile),
            (err) => {
              if (err) {
                rej(err);
              } else {
                child.stdin.end(res);
              }
            }
          );
        });
      await Promise.all([
        writeToStdin(),
        spawnToPromise(child, {
          cwd: process.cwd(),
        }),
      ]);
    },
  });
}
