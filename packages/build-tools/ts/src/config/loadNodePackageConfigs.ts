import type {
  PackageJson,
  PackageJsonExports,
} from '../package-json/packageJson';
import { readCwdPackageJson } from '../package-json/readPackageJson';
import type {
  NodePackageConfig,
  PackageBinEntryPoint,
  PackageExportsEntryPoint,
} from './nodePackageConfig';
import { validateEntryPoints } from './validateEntryPoints';
import { validatePackageJson } from './validatePackageJson';
import { validatePackageJsonBins } from './validatePackageJsonBins';

type BuildEntryPointsResult =
  | PackageExportsEntryPoint[]
  | {
      entryPoints: PackageExportsEntryPoint[];
      ignored: Record<string, PackageJsonExports>;
    };

export type BuilderDeps = {
  buildConfig: () => NodePackageConfig | Promise<NodePackageConfig>;
  readPackageJson: () => PackageJson | Promise<PackageJson>;
  buildEntryPoints: () =>
    | BuildEntryPointsResult
    | Promise<BuildEntryPointsResult>;
  buildBinEntryPoints: () =>
    | PackageBinEntryPoint[]
    | Promise<PackageBinEntryPoint[]>;
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
  const entryPointsBuildResultPromise = deps.buildEntryPoints();
  const binEntryPoints = deps.buildBinEntryPoints();
  const entryPointsBuildResult = await Promise.resolve(
    entryPointsBuildResultPromise
  );
  const entryPointsBuildResultParsed = Array.isArray(entryPointsBuildResult)
    ? {
        entryPoints: entryPointsBuildResult,
        ignored: {},
      }
    : entryPointsBuildResult;
  if (entryPointsBuildResultParsed.entryPoints.length === 0) {
    throw new Error(
      "The package doesn't have any entry points, nothing to bundle!"
    );
  }
  return {
    name,
    version,
    dependencies: packageJson.dependencies || {},
    devDependencies: packageJson.devDependencies || {},
    entryPoints: entryPointsBuildResultParsed.entryPoints,
    ignoredEntryPoints: entryPointsBuildResultParsed.ignored,
    binEntryPoints: await binEntryPoints,
  };
}

export async function loadNodePackageConfigs(opts?: {
  packageConfig?: PackageConfigBuilder;
}) {
  const deps: BuilderDeps = {
    readPackageJson: () => readCwdPackageJson(),
    buildConfig: () => tryBuildingPackageConfig(deps, false),
    buildEntryPoints: () =>
      Promise.resolve(deps.readPackageJson()).then((packageJson) =>
        validateEntryPoints(packageJson.exports || {})
      ),
    buildBinEntryPoints: () =>
      Promise.resolve(deps.readPackageJson()).then((packageJson) =>
        validatePackageJsonBins({
          packageName: packageJson.name,
          bin: packageJson.bin,
        })
      ),
  };

  const customDeps = opts?.packageConfig ? opts.packageConfig(deps) : deps;

  return await tryBuildingPackageConfig(customDeps, customDeps !== deps);
}
