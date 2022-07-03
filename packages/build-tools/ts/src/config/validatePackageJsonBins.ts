import { readdir } from 'node:fs/promises';

import type { PackageBinEntryPoint } from './nodePackageConfig';

export async function validatePackageJsonBins({
  packageName,
  bin,
}: {
  packageName?: string;
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
    return [];
  }

  for (const [key, value] of binEntries) {
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

  const [srcBinContents, nodeModulesBinContents] = await Promise.all([
    readdir('./src/bin').catch(() => [] as string[]),
    readdir('./node_modules/.bin').catch(() => [] as string[]),
  ]);

  const { validBins, invalidBins } = binEntries.reduce<{
    validBins: PackageBinEntryPoint[];
    invalidBins: string[];
  }>(
    (acc, [bin, value]) => {
      if (srcBinContents.includes(`${bin}.ts`)) {
        acc.validBins.push({
          binName: bin,
          format: value.endsWith('.cjs') ? 'cjs' : 'esm',
        });
      } else {
        if (!nodeModulesBinContents.includes(bin)) {
          acc.invalidBins.push(bin);
        } else {
          acc.validBins.push({
            binName: bin,
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

  return validBins;
}
