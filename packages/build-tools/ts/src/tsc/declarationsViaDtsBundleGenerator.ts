import type { BundlerConfig } from '@build-tools/dts-bundle-generator';
import { spawn } from 'child_process';
import { join, relative } from 'path';

import { spawnToPromise } from '../child-process';
import type { PackageConfigBuilder } from '../config/loadNodePackageConfigs';
import { loadNodePackageConfigs } from '../config/loadNodePackageConfigs';
import { loadTsConfigJson } from '../config/loadTsConfigJson';
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

  /**
   * Ignore TypeScript errors in dependencies when generating declarations
   */
  unstable_ignoreTypeScriptErrors?: boolean;

  /**
   * Skip TypeScript type checking for dependencies
   */
  unstable_skipDependencies?: string[];
};

export async function declarationsViaDtsBundleGenerator(
  opts?: DeclarationsOpts
) {
  const [tsConfig, packageConfig, dependencies] = await Promise.all([
    loadTsConfigJson(),
    loadNodePackageConfigs(opts),
    loadMonorepoDependencies(),
  ]);

  const dependencyOutDirs = await Promise.all(
    [
      ...dependencies
        .filter(
          (dependency) =>
            !opts?.unstable_skipDependencies ||
            !opts.unstable_skipDependencies.includes(dependency.packageName)
        )
        .map((directory) => directory.packageDirectory),
      process.cwd(),
    ].map((directory) =>
      Promise.all([
        loadTsConfigJson(directory),
        tscCompositeTypeCheckAt(directory, {
          exitCodes: opts?.unstable_ignoreTypeScriptErrors ? [0] : 'any',
        }),
      ]).then(([tsconfig]) => tsconfig.compilerOptions?.outDir)
    )
  );

  const entryPoints = packageConfig.entryPoints;

  const outDir = tsConfig.compilerOptions?.outDir || '.tsc-out';

  const dtsBundleGeneratorConfigFile: BundlerConfig = {
    compilationOptions: {
      preferredConfigPath: './tsconfig.json',
      compilerOptions: {
        composite: false,
        baseUrl: '.',
        paths: Object.fromEntries(
          dependencies.map((dep, i) => [
            dep.aliasName,
            [
              relative(
                process.cwd(),
                join(
                  dep.packageDirectory,
                  dependencyOutDirs[i] || '.tsc-out',
                  'src'
                )
              ),
            ],
          ])
        ),
      },
    },
    entries: entryPoints.map((entry) => {
      const input = join(outDir, entry.sourcePath);
      const output = join('./dist/dist', entry.chunkName + '.d.ts');
      return {
        filePath: input,
        outFile: output,
        libraries: {
          inlinedLibraries: Object.keys(packageConfig.devDependencies).filter(
            (f) => !f.startsWith('@types')
          ),
        },
        noCheck: opts?.unstable_ignoreTypeScriptErrors,
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
