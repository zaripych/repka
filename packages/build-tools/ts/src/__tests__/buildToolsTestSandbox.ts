import { packageTestSandbox } from '@testing-tools/packages';
import { join, relative } from 'node:path';

import { moduleRootDirectory } from '../utils/moduleRootDirectory';

export function buildToolsTestSandbox(opts: { tag: string }) {
  const templateLocation = join(
    moduleRootDirectory(),
    `../../templates/${opts.tag}`
  );
  // this is where the sandbox is going to be located
  const rootDirectory = join(
    process.cwd(),
    './.integration',
    `sandbox-${opts.tag}`
  );
  return packageTestSandbox({
    tag: opts.tag,
    templateLocation,
    replaceTextInFiles: () => {
      {
        // since we are copying the template from our monorepo packages/*/*
        // to a temporary location (in order to avoid modifying committed code)
        // the .bin/{file}'s are going to have invalid references to ./build-tools/ts/bin/${file}'s
        // we just replace those relative paths here as a performance optimization hack
        // this is much faster than doing `pnpm install` for every test!
        const binRoot = join(moduleRootDirectory(), 'bin');
        const origin = join(templateLocation, './node_modules/.bin');
        const currentRelativePath = relative(origin, binRoot);
        const target = join(rootDirectory, './node_modules/.bin');
        const targetRelativePath = relative(target, binRoot);
        return [
          {
            include: ['./node_modules/.bin/*'],
            filters: [
              {
                substring: `$basedir/${currentRelativePath}`,
                replaceWith: `$basedir/${targetRelativePath}`,
              },
            ],
          },
        ];
      }
    },
  });
}
