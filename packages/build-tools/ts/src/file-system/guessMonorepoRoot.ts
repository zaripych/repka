import assert from 'assert';

import { once } from '../utils/once';

const determineMonorepoRoot = (candidate: string) => {
  // try to guess what the root is considering that our commands
  // can be executed from within package directory or from the root
  const result = /(.*(?=\/packages\/))|(.*(?=\/node_modules\/))|(.*)/.exec(
    candidate
  );
  assert(!!result);
  const [, packagesRoot, nodeModulesRoot, entirePath] = result;
  const rootPath = packagesRoot || nodeModulesRoot || entirePath;
  assert(!!rootPath);
  return rootPath;
};

export const guessMonorepoRoot = once(() => {
  return determineMonorepoRoot(process.env['INIT_CWD'] || process.cwd());
});
