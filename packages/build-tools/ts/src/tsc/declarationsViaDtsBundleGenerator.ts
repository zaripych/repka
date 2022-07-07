import type { BundlerConfig } from '@build-tools/dts-bundle-generator';
import { spawn } from 'child_process';
import { join, relative } from 'path';

import { spawnToPromise } from '../child-process';
import type { PackageConfigBuilder } from '../config/loadNodePackageConfigs';
import { loadNodePackageConfigs } from '../config/loadNodePackageConfigs';
import { logger } from '../logger/logger';
import { loadMonorepoDependencies } from '../utils/loadMonorepoDependencies';
import { moduleRootDirectory } from '../utils/moduleRootDirectory';
import { tscCompositeTypeCheckAt } from './tsc';

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
  const [packageConfig, dependencies] = await Promise.all([
    loadNodePackageConfigs(opts),
    loadMonorepoDependencies(),
  ]);

  await Promise.all(
    [
      ...dependencies.map((directory) => directory.packageDirectory),
      process.cwd(),
    ].map((directory) => tscCompositeTypeCheckAt(directory))
  );

  const entryPoints = packageConfig.entryPoints;

  const dtsBundleGeneratorConfigFile: BundlerConfig = {
    compilationOptions: {
      preferredConfigPath: './tsconfig.json',
      compilerOptions: {
        composite: false,
        baseUrl: '.',
        paths: Object.fromEntries(
          dependencies.map((dep) => [
            dep.aliasName,
            [
              relative(
                process.cwd(),
                join(dep.packageDirectory, '.tsc-out', 'src')
              ),
            ],
          ])
        ),
      },
    },
    entries: entryPoints.map((entry) => {
      const input = join('.tsc-out', entry.sourcePath);
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
  const child = spawn(process.execPath, [generatorPath()], {
    cwd: process.cwd(),
    stdio: ['pipe', 'inherit', 'inherit'],
    env: {
      ...process.env,
      LOG_LEVEL: logger.logLevel,
    },
  });
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
