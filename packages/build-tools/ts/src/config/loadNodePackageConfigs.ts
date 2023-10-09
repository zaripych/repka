import { join } from 'node:path';

import type {
  PackageJson,
  PackageJsonExports,
} from '../package-json/packageJson';
import { readPackageJson } from '../package-json/readPackageJson';
import type {
  NodePackageConfig,
  PackageBinEntryPoint,
  PackageExportsEntryPoint,
} from './nodePackageConfig';
import { validateBinEntryPoints } from './validateBinEntryPoints';
import { validateEntryPoints } from './validateEntryPoints';
import { validatePackageJson } from './validatePackageJson';

type BuildEntryPointsResult = {
  entryPoints: PackageExportsEntryPoint[];
  ignoredEntryPoints?: Record<string, PackageJsonExports>;
};

type BuildBinEntryPointsResult = {
  binEntryPoints: PackageBinEntryPoint[];
  ignoredBinEntryPoints?: Record<string, string>;
};

export type BuilderDeps = {
  buildConfig: () => NodePackageConfig | Promise<NodePackageConfig>;
  readPackageJson: () => PackageJson | Promise<PackageJson>;
  buildEntryPoints: () =>
    | BuildEntryPointsResult
    | Promise<BuildEntryPointsResult>;
  buildBinEntryPoints: () =>
    | BuildBinEntryPointsResult
    | Promise<BuildBinEntryPointsResult>;
};

export type PackageConfigBuilder = (opts: BuilderDeps) => BuilderDeps;

/**
 * Convert package.json to our config
 */
async function tryBuildingPackageConfig(
  deps: Pick<
    BuilderDeps,
    'readPackageJson' | 'buildEntryPoints' | 'buildBinEntryPoints'
  >,
  customized: boolean
): Promise<NodePackageConfig> {
  const packageJson = await deps.readPackageJson();

  if (!customized) {
    // provide more robust error messages when reading from package.json
    validatePackageJson(packageJson);
  }

  const name = packageJson.name;
  if (!name) {
    throw new Error('"name" of the package is not specified');
  }

  const version = packageJson.version;
  if (!version) {
    throw new Error('"version" of the package is not specified');
  }

  const entryPointsBuildResult = await deps.buildEntryPoints();
  const binEntryPointsBuildResult = await deps.buildBinEntryPoints();

  if (
    entryPointsBuildResult.entryPoints.length === 0 &&
    binEntryPointsBuildResult.binEntryPoints.length === 0
  ) {
    throw new Error(
      "The package doesn't have any entry points, nothing to bundle!"
    );
  }

  return {
    name,
    version,
    dependencies: packageJson.dependencies || {},
    devDependencies: packageJson.devDependencies || {},
    ...entryPointsBuildResult,
    ...binEntryPointsBuildResult,
  };
}

export async function loadNodePackageConfigs(opts?: {
  packageConfig?: PackageConfigBuilder;
  directory?: string;
}) {
  const directory = opts?.directory || process.cwd();

  const deps: BuilderDeps = {
    readPackageJson: () => readPackageJson(join(directory, 'package.json')),

    buildConfig: () => tryBuildingPackageConfig(deps, false),

    buildEntryPoints: () =>
      Promise.resolve(deps.readPackageJson()).then((packageJson) =>
        validateEntryPoints({
          exportEntry: packageJson.exports || {},
          packageDirectory: directory,
        })
      ),

    buildBinEntryPoints: () =>
      Promise.resolve(deps.readPackageJson()).then((packageJson) =>
        validateBinEntryPoints({
          packageName: packageJson.name,
          packageDirectory: directory,
          bin: packageJson.bin,
        })
      ),
  };

  const customDeps = opts?.packageConfig ? opts.packageConfig(deps) : deps;

  return await tryBuildingPackageConfig(customDeps, customDeps !== deps);
}
