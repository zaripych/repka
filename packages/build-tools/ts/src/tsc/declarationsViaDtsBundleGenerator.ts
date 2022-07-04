import type {
  CompilationOptions,
  EntryPointConfig,
} from 'dts-bundle-generator';
import { writeFile } from 'node:fs/promises';
import { join } from 'path';

import { spawnToPromise } from '../child-process';
import type { PackageConfigBuilder } from '../config/loadNodePackageConfigs';
import { loadNodePackageConfigs } from '../config/loadNodePackageConfigs';
import { logger } from '../logger/logger';
import { isTruthy } from '../utils/isTruthy';
import { modulesBinPath } from '../utils/modulesBinPath';

export type DeclarationsOpts = {
  /**
   * Override core configuration options that are normally read from package.json
   */
  packageConfig?: PackageConfigBuilder;
};

// not exported unfortunately
type BundlerConfig = {
  compilationOptions: CompilationOptions;
  entries: EntryPointConfig[];
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
  const configFilePath = join(process.cwd(), 'dts-config.json');
  await writeFile(
    join(process.cwd(), 'dts-config.json'),
    JSON.stringify(dtsBundleGeneratorConfigFile)
  );
  await spawnToPromise(
    modulesBinPath('dts-bundle-generator'),
    [
      '--config',
      configFilePath,
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
}
