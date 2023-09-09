import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '../logger/logger';
import type { PackageBinEntryPoint } from './nodePackageConfig';

export async function validatePackageJsonBins({
  packageName,
  packageDirectory,
  bin,
}: {
  packageName?: string;
  packageDirectory: string;
  bin?: string | Record<string, string>;
}) {
  const binEntries =
    typeof bin === 'string' && packageName
      ? Object.entries({
          [packageName]: bin,
        })
      : typeof bin === 'object'
      ? Object.entries(bin)
      : [];

  if (binEntries.length === 0) {
    return {
      binEntryPoints: [],
    };
  }

  const validBins: PackageBinEntryPoint[] = [];
  const invalidBins: string[] = [];

  for (const [bin, value] of binEntries) {
    const fileExists = await stat(join(packageDirectory, value))
      .then((result) => result.isFile())
      .catch(() => false);

    if (!fileExists) {
      logger.warn(
        'package.json "bin" prop is invalid: the key ' +
          `"${bin}" points to a file "${value}" that does not ` +
          `exist.`
      );
      invalidBins.push(bin);
      continue;
    }

    const fileContents = await readFile(join(packageDirectory, value), 'utf-8');
    const firstLine = fileContents.split('\n')[0];

    if (!firstLine || !firstLine.startsWith('#!/usr/bin/env ')) {
      logger.warn(
        'package.json "bin" prop is invalid: the key ' +
          `"${bin}" points to a file "${value}" that does not have a ` +
          `shebang, ie "#!/usr/bin/env tsx". The shebang is required ` +
          `to be able to run the TypeScript file when the bin command ` +
          `is executed at dev-time.`
      );
      invalidBins.push(bin);
      continue;
    }

    validBins.push({
      binName: bin,
      sourceFilePath: value,
      format: value.endsWith('.cts') ? 'cjs' : 'esm',
    });
  }

  return {
    binEntryPoints: validBins,
    ignoredBinEntryPoints: Object.fromEntries(
      binEntries.filter(([key]) => invalidBins.includes(key))
    ) as Record<string, string>,
  };
}
