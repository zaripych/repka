import { logger } from '@build-tools/ts';
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
  /**
   * Path to the test that has initialized this configuration
   */
  testFilePath: string;
};

const waitJustABit = () => new Promise((res) => setTimeout(res, 3));

const readConfigAt = async (opts: {
  filePath: string;
  packageRootDirectory: string;
}) =>
  await readFile(opts.filePath, 'utf-8').then((result) => {
    const data = JSON.parse(result) as Partial<TestConfig>;
    if (!data.testRootDirectory) {
      throw new Error('Invalid config, no "testRootDirectory" found!');
    }
    return {
      packageRootDirectory: opts.packageRootDirectory,
      testRootDirectory: data.testRootDirectory,
    };
  });

const createConfig = (opts: { packageRootDirectory: string }) => {
  return {
    packageRootDirectory: opts.packageRootDirectory,
    testRootDirectory: join(
      tmpdir(),
      '@repka-kit',
      'integration-tests',
      'root-' + randomText(8)
    ),
  };
};

const handleConfigReadError =
  (opts: {
    retryTimes: number;
    readConfig: () => ReturnType<typeof readConfigAt>;
  }) =>
  async (err: unknown): ReturnType<typeof readConfigAt> => {
    if (err instanceof SyntaxError && opts.retryTimes > 0) {
      // it is possible another process (test) is writing the config at the moment
      // wait just a little bit and give them a chance to finish
      await waitJustABit();
      return opts.readConfig().catch(
        handleConfigReadError({
          retryTimes: opts.retryTimes - 1,
          readConfig: opts.readConfig,
        })
      );
    } else {
      return Promise.reject(err);
    }
  };

export async function getTestConfig(testFilePath: string): Promise<TestConfig> {
  const packageRootDirectory = await findPackageRootDir(testFilePath);
  if (!packageRootDirectory) {
    throw new Error(
      `Following along parent directories of "${testFilePath}" no package.json in sight`
    );
  }
  const directoryPath = join(packageRootDirectory, './.integration');
  const filePath = join(packageRootDirectory, './.integration', 'config.json');

  const readConfig = () =>
    readConfigAt({
      filePath,
      packageRootDirectory,
    });

  const config = await readConfig()
    .catch(
      handleConfigReadError({
        retryTimes: 3,
        readConfig,
      })
    )
    .catch(async () => {
      const created = createConfig({
        packageRootDirectory,
      });
      await mkdir(directoryPath, { recursive: true });
      await writeFile(
        filePath,
        JSON.stringify(created, undefined, '  '),
        'utf-8'
      );
      return created;
    });

  await mkdir(config.testRootDirectory, { recursive: true });

  logger.debug(
    `Integration test root directory is "${config.testRootDirectory}"`
  );

  return {
    ...config,
    testFilePath: testFilePath,
  };
}
