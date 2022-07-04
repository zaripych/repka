import type { BundlerConfig } from '@build-tools/dts-bundle-generator';
import { spawn } from 'child_process';
import { join } from 'path';

import { spawnToPromise } from '../child-process';
import type { PackageConfigBuilder } from '../config/loadNodePackageConfigs';
import { loadNodePackageConfigs } from '../config/loadNodePackageConfigs';
import { logger } from '../logger/logger';
import { isTruthy } from '../utils/isTruthy';
import { moduleRootDirectory } from '../utils/moduleRootDirectory';

const generatorPath = () =>
  join(moduleRootDirectory(), './bin/dts-bundle-generator.gen.cjs');

export type DeclarationsOpts = {
  /**
   * Override core configuration options that are normally read from package.json
   */
  packageConfig?: PackageConfigBuilder;
};

export async function declarationsViaDtsBundleGenerator(
  opts?: DeclarationsOpts
) {
  const packageConfig = await loadNodePackageConfigs(opts);

  const entryPoints = packageConfig.entryPoints;

  const dtsBundleGeneratorConfigFile: BundlerConfig = {
    compilationOptions: {
      preferredConfigPath: './tsconfig.json',
    },
    entries: entryPoints.map((entry) => {
      const input = join(entry.sourcePath);
      const output = join('./dist/dist', entry.chunkName + '.es.d.ts');
      return {
        filePath: input,
        outFile: output,
        libraries: {
          inlinedLibraries: Object.keys(packageConfig.devDependencies).filter(
            (f) => !f.startsWith('@types')
          ),
        },
      };
    }),
  };
  await runDtsBundleGeneratorViaStdIn(dtsBundleGeneratorConfigFile);
}

async function runDtsBundleGeneratorViaStdIn(config: BundlerConfig) {
  const child = spawn(
    process.execPath,
    [
      generatorPath(),
      ['warn', 'error', 'fatal'].includes(logger.logLevel)
        ? '--silent'
        : logger.logLevel === 'debug'
        ? '--verbose'
        : undefined,
    ].filter(isTruthy),
    {
      cwd: process.cwd(),
      stdio: ['pipe', 'inherit', 'inherit'],
    }
  );
  child.stdin.setDefaultEncoding('utf-8');
  const writeToStdin = () =>
    new Promise<void>((res, rej) => {
      child.stdin.write(JSON.stringify(config), (err) => {
        if (err) {
          rej(err);
        } else {
          child.stdin.end(res);
        }
      });
    });
  await Promise.all([
    writeToStdin(),
    spawnToPromise(child, {
      cwd: process.cwd(),
      exitCodes: 'inherit',
    }),
  ]);
}
