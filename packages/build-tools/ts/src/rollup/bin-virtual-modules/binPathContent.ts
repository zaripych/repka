export const js = String.raw;

export const binPathContent = () => `import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const isFile = async (file) => {
  return await stat(file)
    .then((result) => result.isFile())
    .catch(() => false);
};

async function findBin(startWith, binScriptPath) {
  let current = startWith;
  while (current !== '/' && current !== '~/') {
    const candidate = join(current, 'node_modules', binScriptPath);
    if (await isFile(candidate)) {
      return candidate;
    }
    current = dirname(current);
  }
}

const binPath = async (binName, binScriptPath) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bestGuess = join(root, 'node_modules', '.bin', binName);
  if (await isFile(bestGuess)) {
    return bestGuess;
  }
  const result = await findBin(root, binScriptPath);
  if (result) {
    return result;
  }
  throw new Error(\`Cannot find bin \${binName}\`);
};
`;
