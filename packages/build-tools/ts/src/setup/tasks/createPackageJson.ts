import { join, relative } from 'node:path';

import type { DependencyVersion } from '../../package-json/lookupPackageVersions';
import type { DependencyKeys } from '../../package-json/packageJson';
import { taskFactory } from './core/definition';
import { cleanupDependencies } from './helpers/cleanupDependencies';
import { lookupAndMergeDependencies } from './helpers/mergeDependencies';
import { readPackageJsonWithDefault } from './helpers/readPackageJson';

export const createPackageJson = taskFactory(
  (
    opts: {
      directory?: string;
      packageName: string;
    } & {
      [keys in DependencyKeys]?: Record<string, DependencyVersion>;
    }
  ) => {
    const { directory = process.cwd(), packageName, ...dependencies } = opts;
    const path = join(directory, 'package.json');
    const directoryHumanReadable = relative(process.cwd(), directory);

    return {
      name: 'package.json',
      description: `Create/update package.json with repka defaults at "${
        directoryHumanReadable || '.'
      }"`,

      async execute({ writeFile, readFile }) {
        const original = await readPackageJsonWithDefault(path, {
          readFile,
        });

        const overridden = await lookupAndMergeDependencies(
          original,
          dependencies
        );
        const deps = cleanupDependencies(overridden);

        await writeFile(
          path,
          JSON.stringify({
            name: packageName,
            version: '1.0.0',
            description: '',
            keywords: [],
            license: 'ISC',
            author: '',
            type: 'module',
            exports: './src/index.ts',
            main: './src/index.ts',
            types: './src/index.ts',
            scripts: {
              test: 'repka test',
              lint: 'repka lint',
            },
            ...deps,
          })
        );
      },
    };
  }
);
