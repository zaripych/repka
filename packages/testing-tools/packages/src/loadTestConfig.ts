import { logger } from '@build-tools/ts';
import { onceAsync } from '@utils/ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findPackageRootDir } from './helpers/findPackageRootDir';
import { randomText } from './helpers/randomText';

export type TestConfig = {
  /**
   * Root directory of the package that contains the tests
   */
  packageRootDirectory: string;
  /**
   * Parent directory for temporary files that belong to every test
   * which should have following directory structure:
   * ```txt
   *   [testRootDirectory]
   *     template <- default template
   *     sandbox-this-xxyy <- sandbox for a testA
   *     sandbox-that-yyzz <- sandbox for a testB
   * ```
   */
  testRootDirectory: string;
};

async function loadTestConfigInternal(): Promise<TestConfig> {
  const packageRootDirectory = await findPackageRootDir(process.cwd());
  if (!packageRootDirectory) {
    throw new Error(
      `Following along parent directories of "${process.cwd()}" no package.json in sight`
    );
  }
  const filePath = join(packageRootDirectory, './.integration', 'config.json');
  const config = await readFile(filePath, 'utf-8').then(
    (result) => {
      try {
        const data = JSON.parse(result) as Partial<TestConfig>;
        if (!data.testRootDirectory) {
          throw new Error('Invalid config, no "testRootDirectory" found!');
        }
        return {
          packageRootDirectory,
          testRootDirectory: data.testRootDirectory,
        };
      } catch (err) {
        logger.error(
          `Cannot parse JSON file at ${filePath} with contents:\n`,
          `  "${result}"\n`,
          err
        );
        return Promise.reject(err);
      }
    },
    () => {
      return {
        packageRootDirectory,
        testRootDirectory: join(
          tmpdir(),
          '@repka-kit',
          'integration-tests',
          'root-' + randomText(8)
        ),
      };
    }
  );
  await mkdir(config.testRootDirectory, { recursive: true });
  await writeFile(filePath, JSON.stringify(config, undefined, '  '), 'utf-8');
  logger.debug(
    `Integration test root directory is "${config.testRootDirectory}"`
  );
  return config;
}

export const loadTestConfig = onceAsync(() => loadTestConfigInternal());
