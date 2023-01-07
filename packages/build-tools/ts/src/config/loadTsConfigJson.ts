import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { JsonType } from '../package-json/packageJson';

export type ParsedTsConfigContent = {
  compilerOptions?: {
    outDir?: string;
  };
};

// TODO: This is somewhat simplistic in its implementation, consider
// using a specialized package that would be smart enough to use
// "extends" property of the TS Config
export async function loadTsConfigJson(
  packageDirectory: string = process.cwd()
): Promise<ParsedTsConfigContent> {
  const content = await readFile(
    join(packageDirectory, 'tsconfig.json'),
    'utf-8'
  );

  const parsed = JSON.parse(content) as JsonType;

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(
      `Error when trying to load "tsconfig.json", expected an object but got ${typeof parsed}`
    );
  }

  const compilerOptions = parsed['compilerOptions'];
  if (typeof compilerOptions !== 'object' || compilerOptions === null) {
    return {};
  }

  const outDir = compilerOptions['outDir'];
  if (typeof outDir !== 'string') {
    return {
      compilerOptions: {},
    };
  }

  return {
    compilerOptions: {
      outDir,
    },
  };
}
