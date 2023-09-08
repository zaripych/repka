import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

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

  const binObj = Object.fromEntries(binEntries);

  for (const [key, value] of binEntries) {
    if (value.endsWith('ts') || value.endsWith('js')) {
      continue;
    }
    const allowed = [`./bin/${key}.gen.cjs`, `./bin/${key}.gen.mjs`];
    if (!allowed.includes(value)) {
      throw new Error(
        `package.json "bin" prop is invalid: the entry "${key}" ` +
          `value can only be ${allowed
            .map((value) => `"${value}"`)
            .join(' or ')}`
      );
    }
  }

  const srcBinContents = await readdir('./src/bin').catch(() => [] as string[]);
  const nodeModulesBinContents = await readdir(
    join(packageDirectory, './node_modules/.bin')
  ).catch(() => [] as string[]);

  for (const [bin, value] of binEntries) {
    if (value.endsWith('.cjs') || value.endsWith('.mjs')) {
      /**
       * @todo remains for backward compatibility for now,
       * remove this after testing proves that .ts and shebang
       * approach works cross-platform
       */
      continue;
    }

    const fileExists = await stat(join(packageDirectory, value))
      .then((result) => result.isFile())
      .catch(() => false);

    if (!fileExists) {
      throw new Error(
        'package.json "bin" prop is invalid: the key ' +
          `"${bin}" points to a file "${value}" that does not ` +
          `exist.`
      );
    }

    const fileContents = await readFile(join(packageDirectory, value), 'utf-8');
    const firstLine = fileContents.split('\n')[0];

    if (!firstLine || !firstLine.startsWith('#!/usr/bin/env ')) {
      throw new Error(
        'package.json "bin" prop is invalid: the key ' +
          `"${bin}" points to a file "${value}" that does not have a ` +
          `shebang, ie "#!/usr/bin/env tsx". The shebang is required ` +
          `to be able to run the TypeScript file when the bin command ` +
          `is executed.`
      );
    }
  }

  const { validBins, invalidBins } = binEntries.reduce<{
    validBins: PackageBinEntryPoint[];
    invalidBins: string[];
  }>(
    (acc, [bin, value]) => {
      if (value.endsWith('ts')) {
        acc.validBins.push({
          binName: bin,
          sourceFilePath: value,
          format: value.endsWith('.cts') ? 'cjs' : 'esm',
          binEntryType: 'typescript-shebang-bin',
        });
      } else if (value.endsWith('js')) {
        acc.validBins.push({
          binName: bin,
          sourceFilePath: value,
          format: value.endsWith('.cjs') ? 'cjs' : 'esm',
          binEntryType: 'typescript-shebang-bin',
        });
      } else if (srcBinContents.includes(`${bin}.ts`)) {
        acc.validBins.push({
          binName: bin,
          sourceFilePath: `./src/bin/${bin}.ts`,
          format: value.endsWith('.cjs') ? 'cjs' : 'esm',
        });
      } else {
        if (!nodeModulesBinContents.includes(bin)) {
          acc.invalidBins.push(bin);
        } else {
          acc.validBins.push({
            binName: bin,
            sourceFilePath: `./src/bin/${bin}.ts`,
            format: value.endsWith('.cjs') ? 'cjs' : 'esm',
            binEntryType: 'dependency-bin',
          });
        }
      }
      return acc;
    },
    {
      validBins: [],
      invalidBins: [],
    }
  );

  if (invalidBins.length > 0) {
    throw new Error(
      'package.json "bin" prop is invalid: it has keys ' +
        `${invalidBins
          .map((key) => `"${key}"`)
          .join(', ')} that do not have corresponding ` +
        `source files in "./src/bin/*", eg "./src/bin/${String(
          invalidBins[0]
        )}.ts"`
    );
  }

  return {
    binEntryPoints: validBins,
    ignoredBinEntryPoints: Object.fromEntries(
      validBins
        .filter((entry) => entry.binEntryType !== 'typescript-shebang-bin')
        .map((entry) => [entry.binName, binObj[entry.binName]])
    ) as Record<string, string>,
  };
}
