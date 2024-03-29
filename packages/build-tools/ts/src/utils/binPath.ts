import { readFile, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

import { moduleRootDirectory } from './moduleRootDirectory';

async function isFile(filePath: string) {
  return await stat(filePath)
    .then((result) => result.isFile())
    .catch(() => false);
}

async function* iterateNodeModules(startWith: string, path: string) {
  let current = startWith;
  while (current !== sep && current !== '~/') {
    const candidate = join(current, 'node_modules', path);
    if (await isFile(candidate)) {
      yield candidate;
    }
    if (current === dirname(current)) {
      break;
    }
    current = dirname(current);
  }
}

async function findBinScript(startWith: string, binScriptPath: string) {
  for await (const path of iterateNodeModules(startWith, binScriptPath)) {
    return path;
  }
  return undefined;
}

export async function binPath(opts: {
  binName: string;
  binScriptPath: string;
}) {
  const root = moduleRootDirectory();
  const result = await findBinScript(root, opts.binScriptPath);
  if (result) {
    return result;
  }
  throw new Error(`Cannot find bin ${opts.binName}`);
}

function scriptFromPackageJson(opts: {
  binName: string;
  packageJson: Record<string, unknown>;
}) {
  const candidate = opts.packageJson['bin'];
  if (typeof candidate === 'string') {
    return candidate;
  } else if (typeof candidate === 'object' && candidate !== null) {
    const entry = (candidate as Record<string, string>)[opts.binName];
    if (typeof entry === 'string') {
      return entry;
    }
  }
  return undefined;
}

export async function determineBinScriptPath(opts: {
  binName: string;
  binPackageName: string;
}) {
  for await (const path of iterateNodeModules(
    moduleRootDirectory(),
    join(opts.binPackageName, 'package.json')
  )) {
    const pkg = await readFile(path, 'utf-8')
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch(() => null);
    if (!pkg) {
      continue;
    }

    const scriptPath = scriptFromPackageJson({
      binName: opts.binName,
      packageJson: pkg,
    });
    if (!scriptPath) {
      continue;
    }

    const candidate = join(dirname(path), scriptPath);
    if (await isFile(candidate)) {
      // denormalize and make this consistent on all platforms
      // as the path will work both for windows and non-windows
      return join(opts.binPackageName, scriptPath).replaceAll(sep, '/');
    }
  }
  return undefined;
}
