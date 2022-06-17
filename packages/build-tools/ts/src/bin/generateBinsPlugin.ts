import virtual from '@rollup/plugin-virtual';
import { readdir } from 'fs/promises';

import { readCwdPackageJson } from '../package-json/readPackageJson';

export async function generateBinsPlugin() {
  const packageJson = await readCwdPackageJson();
  const bins = Object.keys(packageJson['bin'] || {});
  const srcBinContents = await readdir(new URL('./', import.meta.url).pathname);
  const generateModulesPlugin = virtual({
    ...bins
      .filter((bin) => !srcBinContents.includes(`${bin}.ts`))
      .reduce(
        (acc, bin) => ({
          ...acc,
          [`./src/bin/${bin}.ts`]: `import { runBin } from '${
            new URL(`./runBin`, import.meta.url).pathname
          }';
await runBin('${bin}')`,
        }),
        {}
      ),
  });
  const input: { [entryAlias: string]: string } = {
    ...bins.reduce(
      (acc, bin) => ({
        ...acc,
        [bin]: `./src/bin/${bin}.ts`,
      }),
      {}
    ),
  };
  return {
    input,
    generateModulesPlugin,
  };
}
