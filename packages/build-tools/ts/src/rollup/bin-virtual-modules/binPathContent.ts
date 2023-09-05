export const js = String.raw;

export const binPathContent = () => `import { stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const isFile = async (file) => {
  return await stat(file)
    .then((result) => result.isFile())
    .catch(() => false);
};

async function* iterateNodeModules(startWith, path) {
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

async function findBinScript(startWith, binScriptPath) {
  for await (const path of iterateNodeModules(startWith, binScriptPath)) {
    return path;
  }
  return undefined;
}

async function binPath(binName, binScriptPath) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = await findBinScript(root, binScriptPath);
  if (result) {
    return result;
  }
  throw new Error(\`Cannot find bin \${binName}\`);
};
`;
