// This file is bundled up from './src/*' and needs to be committed
import { join, dirname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert';
import fg from 'fast-glob';
import { ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

function once(fn) {
  let value;
  let calculated = false;
  return () => {
    if (calculated) {
      return value;
    }
    value = fn();
    calculated = true;
    return value;
  };
}

const levels = ["debug", "info", "warn", "error", "fatal"];
const enabledLevelsAfter = (level) => {
  if (level === "off") {
    return [];
  }
  const index = levels.findIndex((item) => item === level);
  if (index === -1) {
    throw new Error("Invalid level");
  }
  return levels.slice(index);
};
const isLevel = (level) => {
  return levels.includes(level);
};
const verbosityFromProcessArgs = (args = process.argv) => {
  const index = args.findIndex((value) => value === "--log-level");
  if (index === -1) {
    return void 0;
  }
  const level = args[index + 1];
  if (level === "silent" || level === "off") {
    return "off";
  }
  if (!isLevel(level)) {
    return void 0;
  }
  return level;
};
const verbosityFromEnv = () => {
  const level = process.env["LOG_LEVEL"];
  if (level === "silent" || level === "off") {
    return "off";
  }
  if (!isLevel(level)) {
    return void 0;
  }
  return level;
};
const getVerbosityConfig = () => {
  const argsLevel = verbosityFromProcessArgs();
  const envLevel = verbosityFromEnv();
  return argsLevel ?? envLevel ?? "info";
};
const noop = (..._args) => {
  return;
};
const log = (...args) => {
  console.log(...args);
};
const error = (...args) => {
  console.error(...args);
};
const shouldEnableTip = () => !process.env["CI"] && !process.stdout.isTTY;
const createLogger = (deps = { getVerbosityConfig, log, error, shouldEnableTip }) => {
  const logLevel = deps.getVerbosityConfig();
  const enabled = enabledLevelsAfter(logLevel);
  return levels.reduce((acc, lvl) => {
    return {
      ...acc,
      [lvl]: enabled.includes(lvl) ? ["fatal", "error"].includes(lvl) ? deps.error : deps.log : noop
    };
  }, {
    logLevel,
    log: enabled.includes("info") ? deps.log : noop,
    tip: enabled.includes("info") && deps.shouldEnableTip() ? deps.log : noop
  });
};
const createDelegatingLogger = (opts) => Object.freeze({
  get logLevel() {
    return opts.parent.logLevel;
  },
  debug(...params) {
    opts.parent.debug(...params);
  },
  info(...params) {
    opts.parent.info(...params);
  },
  log(...params) {
    opts.parent.log(...params);
  },
  tip(...params) {
    opts.parent.tip(...params);
  },
  warn(...params) {
    opts.parent.warn(...params);
  },
  error(...params) {
    opts.parent.error(...params);
  },
  fatal(...params) {
    opts.parent.fatal(...params);
  }
});
let defaultLoggerFactory;
const defaultLogger = once(() => {
  let factory = defaultLoggerFactory;
  if (!factory) {
    factory = () => createLogger();
  }
  return factory();
});
const logger = createDelegatingLogger({
  get parent() {
    return defaultLogger();
  }
});

function onceAsync(fn) {
  let value;
  let inFlight;
  let calculated = false;
  return async () => {
    if (calculated) {
      return value;
    }
    if (inFlight) {
      return inFlight;
    }
    inFlight = Promise.resolve(fn());
    value = await inFlight;
    calculated = true;
    inFlight = null;
    return value;
  };
}

const cwdPackageJsonPath = () => join(process.cwd(), "./package.json");
async function readPackageJsonAt(path) {
  return await readFile(path, "utf-8").then((result) => JSON.parse(result));
}
const readCwdPackageJson = onceAsync(() => readPackageJsonAt(cwdPackageJsonPath()));
async function readPackageJson(path) {
  return process.cwd() === cwdPackageJsonPath() ? await readCwdPackageJson() : await readPackageJsonAt(path);
}

function isTruthy(value) {
  return Boolean(value);
}

const getRepositoryRootScanCandidates = (currentDirectory) => {
  const result = /(.*(?=\/packages\/))|(.*(?=\/node_modules\/))|(.*)/.exec(currentDirectory);
  assert(!!result);
  const [, packagesRoot, nodeModulesRoot] = result;
  return [packagesRoot, nodeModulesRoot].filter(isTruthy);
};
const hasRootMarkers = async (candidates) => {
  const markers = [
    ".git",
    "yarn.lock",
    "pnpm-lock.yaml",
    "package-lock.json",
    "pnpm-workspace.yaml"
  ];
  const markersStream = fg.stream(candidates.flatMap((dir) => markers.map((marker) => join(dir, marker))), {
    markDirectories: true,
    onlyFiles: false
  });
  return new Promise((res) => {
    markersStream.on("data", (entry) => {
      res(dirname(entry));
      if ("destroy" in markersStream) {
        markersStream.destroy();
      }
    });
    markersStream.on("end", () => {
      res(void 0);
    });
  });
};
const prioritizedHasMarkers = (jobs) => {
  if (jobs.length === 0) {
    return Promise.resolve(void 0);
  }
  return new Promise((res) => {
    const results = /* @__PURE__ */ new Map();
    const checkShouldComplete = (index, result) => {
      results.set(index, result);
      for (let i = 0; i < jobs.length; i += 1) {
        const hasResult = results.has(i);
        if (!hasResult) {
          break;
        }
        const result2 = results.get(i);
        if (result2) {
          res(result2);
        }
      }
      if (results.size === jobs.length) {
        res(void 0);
      }
    };
    jobs.forEach((directories, index) => {
      hasRootMarkers(directories).then((result) => {
        checkShouldComplete(index, result);
      }).catch(() => {
        return Promise.resolve(void 0);
      });
    });
  });
};
const repositoryRootPathViaDirectoryScan = async (lookupDirectory) => {
  const uniqueDirname = (path) => {
    if (!path) {
      return;
    }
    const result = dirname(path);
    if (result === path) {
      return;
    }
    return result;
  };
  const parent = uniqueDirname(lookupDirectory);
  const superParent = uniqueDirname(parent);
  return await prioritizedHasMarkers([
    [lookupDirectory],
    getRepositoryRootScanCandidates(lookupDirectory),
    [parent],
    [superParent]
  ].map((dirs) => dirs.filter(isTruthy)).filter((job) => job.length > 0)) || lookupDirectory;
};
const repositoryRootPath = onceAsync(async () => {
  const rootPath = await repositoryRootPathViaDirectoryScan(process.cwd());
  return rootPath;
});

function captureStackTrace(remove = 0) {
  const stackContainer = {
    stack: ""
  };
  Error.captureStackTrace(stackContainer);
  const stackTrace = stackContainer.stack.split("\n").slice(6 + remove).join("\n");
  return {
    stackTrace,
    prepareForRethrow: (err) => {
      const oldStackTrace = err.stack ?? "".split("\n").slice(1).join("\n");
      err.stack = `${err.name || "Error"}: ${err.message}
${oldStackTrace}
${stackTrace}`;
      return err;
    }
  };
}

function isSpawnArgs(args) {
  return !(args[0] instanceof ChildProcess) && typeof args[0] === "string";
}
function spawnWithSpawnParameters(parameters) {
  const [child, [command, args, opts]] = isSpawnArgs(parameters) ? [
    spawn(...parameters),
    parameters
  ] : [
    parameters[0],
    [
      parameters[0].spawnfile,
      parameters[0].spawnargs.slice(1),
      parameters[1]
    ]
  ];
  return {
    child,
    command,
    args,
    opts
  };
}
async function spawnToPromise(...parameters) {
  const { child, command, args, opts } = spawnWithSpawnParameters(parameters);
  const { prepareForRethrow } = captureStackTrace();
  const exitCodes = opts.exitCodes;
  const cwd = opts.cwd ? opts.cwd.toString() : void 0;
  const cmd = () => [command, ...args].join(" ");
  logger.debug([">", cmd()].join(" "), ...cwd ? [`in ${cwd}`] : []);
  await new Promise((res, rej) => child.on("close", (code, signal) => {
    if (typeof code === "number") {
      if (exitCodes !== "inherit" && exitCodes !== "any" && !exitCodes.includes(code)) {
        rej(prepareForRethrow(new Error(`Command "${cmd()}" has failed with code ${code}`)));
      } else {
        res();
      }
    } else if (signal) {
      rej(prepareForRethrow(new Error(`Failed to execute command "${cmd()}" - ${signal}`)));
    } else {
      throw prepareForRethrow(new Error("Expected signal or error code"));
    }
  }).on("error", rej));
  if (exitCodes === "inherit") {
    if (typeof child.exitCode === "number" && (typeof process.exitCode !== "number" || process.exitCode === 0)) {
      process.exitCode = child.exitCode;
    }
  }
}

async function spawnResult(...parameters) {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const combinedData = [];
  const stdoutData = [];
  const stderrData = [];
  const output = opts.output ?? ["stdout", "stderr"];
  if (output.includes("stdout")) {
    assert(!!child.stdout, 'Expected ".stdout" to be defined, which will only be defined if child process is spawned with correct parameters');
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (data) => {
      combinedData.push(data);
      stdoutData.push(data);
    });
  }
  if (output.includes("stderr")) {
    assert(!!child.stderr, 'Expected ".stderr" to be defined, which will only be defined if child process is spawned with correct parameters');
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (data) => {
      combinedData.push(data);
      stderrData.push(data);
    });
  }
  const [result] = await Promise.allSettled([spawnToPromise(child, opts)]);
  return {
    pid: child.pid,
    signal: child.signalCode,
    status: child.exitCode,
    get output() {
      return combinedData;
    },
    get stderr() {
      return stderrData.join("");
    },
    get stdout() {
      return stdoutData.join("");
    },
    get error() {
      return result.status === "rejected" ? result.reason : void 0;
    }
  };
}

const defaultShouldOutput = (result) => {
  return result.error || result.status !== 0 || logger.logLevel === "debug";
};
async function spawnOutputConditional(...parameters) {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const result = await spawnResult(child, opts);
  const shouldOutput = opts.shouldOutput ?? defaultShouldOutput;
  if (shouldOutput(result)) {
    logger.error(result.output.join(""));
  }
  if (result.error) {
    return Promise.reject(result.error);
  }
  return Promise.resolve(result);
}

const getModuleRootDirectoryForImportMetaUrl = (opts) => {
  const __fileName = fileURLToPath(new URL(opts.importMetaUrl));
  const parent = dirname(__fileName);
  const superParent = dirname(parent);
  const isBundledInDist = () => parent.endsWith("/dist");
  const isBundledInBin = () => parent.endsWith("/bin") && !superParent.endsWith("/src");
  if (isBundledInDist() || isBundledInBin()) {
    return fileURLToPath(new URL(`../`, opts.importMetaUrl));
  }
  return fileURLToPath(new URL(`../../`, opts.importMetaUrl));
};
const moduleRootDirectory = once(() => getModuleRootDirectoryForImportMetaUrl({ importMetaUrl: import.meta.url }));

async function isFile(filePath) {
  return await stat(filePath).then((result) => result.isFile()).catch(() => false);
}
async function* iterateNodeModules(startWith, path) {
  let current = startWith;
  while (current !== "/" && current !== "~/") {
    const candidate = join(current, "node_modules", path);
    if (await isFile(candidate)) {
      yield candidate;
    }
    current = dirname(current);
  }
}
async function findBinScript(startWith, binScriptPath) {
  for await (const path of iterateNodeModules(startWith, binScriptPath)) {
    return path;
  }
  return void 0;
}
async function binPath(opts) {
  const useShortcut = opts.useShortcut ?? true;
  const root = moduleRootDirectory();
  if (useShortcut) {
    const bestGuess = join(root, "node_modules", ".bin", opts.binName);
    if (await isFile(bestGuess)) {
      return bestGuess;
    }
  }
  const result = await findBinScript(root, opts.binScriptPath);
  if (result) {
    return result;
  }
  throw new Error(`Cannot find bin ${opts.binName}`);
}

function includesAnyOf(target, hasAnyOfArgs) {
  return hasAnyOfArgs.some((variant) => target.includes(variant));
}
function insertAfterAnyOf(target, insert, hasAnyOfArgs) {
  const index = target.findIndex((value) => hasAnyOfArgs.includes(value));
  if (index === -1) {
    return target;
  }
  const result = [...target];
  result.splice(index + 1, 0, ...insert);
  return result;
}
function cliArgsPipe(transforms, inputArgs) {
  const {
    preArgs,
    inputArgs: modifiedInputArgs,
    postArgs
  } = transforms.reduce((acc, transform) => transform(acc), {
    inputArgs,
    preArgs: [],
    postArgs: []
  });
  return [...preArgs, ...modifiedInputArgs, ...postArgs];
}

const turboBinPath = () => binPath({
  binName: "turbo",
  binScriptPath: "turbo/bin/turbo"
});
async function hasTurboJson() {
  const cwd = await repositoryRootPath();
  return await stat(join(cwd, "turbo.json")).then((res) => res.isFile()).catch(() => false);
}
function inheritTurboForceArgFromEnv() {
  return (state) => ({
    ...state,
    inputArgs: includesAnyOf(state.inputArgs, ["run"]) && !includesAnyOf(state.inputArgs, ["--force"]) && process.env["TURBO_FORCE"] ? insertAfterAnyOf(state.inputArgs, ["--force"], ["run"]) : state.inputArgs
  });
}
async function runTurboTasksForSinglePackage(opts) {
  const rootDir = opts.packageDir ?? process.cwd();
  const cwd = await repositoryRootPath();
  return await spawnOutputConditional(await turboBinPath(), cliArgsPipe([inheritTurboForceArgFromEnv()], [
    "run",
    ...opts.tasks,
    "--filter=" + rootDir.replace(cwd, "."),
    "--output-logs=new-only"
  ]), {
    ...opts.spawnOpts,
    cwd
  });
}

const readPackagesGlobsAt = async (monorepoRoot) => {
  try {
    const text = await readFile(join(monorepoRoot, "pnpm-workspace.yaml"), "utf-8");
    const rootPath = load(text);
    return rootPath.packages ?? [];
  } catch (err) {
    logger.debug(err);
    return [];
  }
};
const readMonorepoPackagesGlobs = onceAsync(async () => {
  const root = await repositoryRootPath();
  const packagesGlobs = await readPackagesGlobsAt(root);
  return {
    root,
    packagesGlobs
  };
});

async function loadRepositoryConfiguration() {
  const [{ root, packagesGlobs }, hasTurbo] = await Promise.all([
    readMonorepoPackagesGlobs(),
    hasTurboJson()
  ]);
  if (packagesGlobs.length === 0) {
    return {
      root,
      packagesGlobs,
      packageLocations: [],
      hasTurbo,
      type: "single-package"
    };
  }
  const packageLocations = await fg(packagesGlobs.map((glob) => `${glob}/package.json`), {
    cwd: root
  });
  return {
    root,
    packagesGlobs,
    packageLocations: packageLocations.map((location) => dirname(location)),
    hasTurbo,
    type: "multiple-packages"
  };
}

async function testPath(opts) {
  const path = join(opts.root, `node_modules/${opts.wrapperPackageName}/node_modules/${opts.lookupPackageName}`);
  return stat(path).then((result) => result.isDirectory() ? path : void 0).catch(() => void 0);
}
async function testLocalAndRoot({
  wrapperPackageName,
  lookupPackageName,
  repoRootPathPromise
}) {
  const localPromise = testPath({
    root: process.cwd(),
    wrapperPackageName,
    lookupPackageName
  });
  const repoRootPath = await repoRootPathPromise;
  if (repoRootPath === process.cwd()) {
    const local = await localPromise;
    if (local) {
      return local;
    }
  } else {
    const rootPromise = testPath({
      root: repoRootPath,
      wrapperPackageName,
      lookupPackageName
    });
    const local = await localPromise;
    if (local) {
      return local;
    }
    const root = await rootPromise;
    if (root) {
      return root;
    }
  }
  return void 0;
}
function packageName([key, value]) {
  if (value.startsWith("workspace:")) {
    const result = /workspace:(.*)@(.*)/.exec(value);
    if (result) {
      const [, packageName2] = result;
      if (packageName2) {
        return packageName2;
      }
    }
  }
  if (value.startsWith("npm:")) {
    const result = /npm:(.*)@(.*)/.exec(value);
    if (result) {
      const [, packageName2] = result;
      if (packageName2) {
        return packageName2;
      }
    }
  }
  return key;
}
async function findDevDependency(opts) {
  const wrapperPackageName = opts.wrapperPackageName ?? "@repka-kit/ts";
  const lookupPackageName = opts.lookupPackageName;
  const repoRootPathPromise = repositoryRootPath();
  const defaultResult = await testPath({
    root: process.cwd(),
    lookupPackageName,
    wrapperPackageName
  });
  if (defaultResult) {
    return defaultResult;
  }
  const wrapperAliasName = await readCwdPackageJson().then((result) => {
    const dependency = Object.entries(result.devDependencies || {}).find((dependency2) => packageName(dependency2) === wrapperPackageName);
    return dependency ? dependency[0] : void 0;
  }).catch((err) => {
    logger.warn("Cannot read package json", err);
    return void 0;
  });
  if (!wrapperAliasName) {
    const repoRootPath = await repoRootPathPromise;
    if (repoRootPath !== process.cwd()) {
      return await testPath({
        root: repoRootPath,
        lookupPackageName,
        wrapperPackageName
      });
    }
    return void 0;
  }
  const aliasResult = await testLocalAndRoot({
    repoRootPathPromise,
    lookupPackageName,
    wrapperPackageName: wrapperAliasName
  });
  return aliasResult;
}

async function loadStandardGlobalHook(script, globalConfig, projectConfig) {
  const hasHook = await stat(script).then((result) => result.isFile()).catch(() => false);
  return {
    hasHook,
    execute: async () => {
      if (!hasHook) {
        return;
      }
      const location = join(process.cwd(), script);
      const result = await import(location);
      if (!result || !result.default) {
        logger.warn(`\u26A0\uFE0F No default export found in "${script}"`);
        return;
      }
      await Promise.resolve(result.default(globalConfig, projectConfig));
    }
  };
}
async function loadCustomGlobalHook(script) {
  const hasHook = await stat(script).then((result) => result.isFile()).catch(() => false);
  return {
    hasHook,
    execute: async () => {
      if (!hasHook) {
        return;
      }
      const location = join(process.cwd(), script);
      const packageJson = await readPackageJson(join(process.cwd(), "package.json"));
      if (script.endsWith("setup.ts") && typeof packageJson["scripts"] === "object" && packageJson["scripts"]["setup:integration"] === `tsx ${script}`) {
        await runTurboTasksForSinglePackage({
          tasks: ["setup:integration"],
          spawnOpts: {
            exitCodes: [0],
            env: {
              ...process.env,
              LOG_LEVEL: logger.logLevel
            }
          }
        });
      } else {
        await spawnOutputConditional("tsx", [location], {
          exitCodes: [0],
          env: {
            ...process.env,
            LOG_LEVEL: logger.logLevel
          }
        });
      }
    }
  };
}
async function loadAndRunGlobalHook(script, globalConfig, projectConfig, tip) {
  const [standard, custom] = await Promise.all([
    loadStandardGlobalHook(`${script}.mjs`, globalConfig, projectConfig),
    loadCustomGlobalHook(`${script}.ts`)
  ]);
  if (!custom.hasHook && tip) {
    logger.tip(tip);
  }
  await standard.execute();
  await custom.execute();
}

const jestPluginRoot = onceAsync(async () => {
  const result = await findDevDependency({
    lookupPackageName: "esbuild-jest"
  });
  if (!result) {
    logger.warn('Jest plugins root cannot be determined. Do you have "@repka-kit/ts" in devDependencies at the monorepo root or at the local package?');
  } else {
    if (logger.logLevel === "debug") {
      logger.debug("Found jest plugins root at", dirname(result));
    }
  }
  return result ? dirname(result) : ".";
});

export { jestPluginRoot, loadAndRunGlobalHook, loadRepositoryConfiguration, readPackageJson, repositoryRootPath };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWxzL29uY2UudHMiLCIuLi8uLi9zcmMvbG9nZ2VyL2xvZ2dlci50cyIsIi4uLy4uL3NyYy91dGlscy9vbmNlQXN5bmMudHMiLCIuLi8uLi9zcmMvcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbi50cyIsIi4uLy4uL3NyYy91dGlscy9pc1RydXRoeS50cyIsIi4uLy4uL3NyYy91dGlscy9yZXBvc2l0b3J5Um9vdFBhdGgudHMiLCIuLi8uLi9zcmMvdXRpbHMvc3RhY2tUcmFjZS50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduVG9Qcm9taXNlLnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25SZXN1bHQudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3bk91dHB1dC50cyIsIi4uLy4uL3NyYy91dGlscy9tb2R1bGVSb290RGlyZWN0b3J5LnRzIiwiLi4vLi4vc3JjL3V0aWxzL2JpblBhdGgudHMiLCIuLi8uLi9zcmMvdXRpbHMvY2xpQXJnc1BpcGUudHMiLCIuLi8uLi9zcmMvdHVyYm8udHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVhZFBhY2thZ2VzR2xvYnMudHMiLCIuLi8uLi9zcmMvdXRpbHMvbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2ZpbmREZXZEZXBlbmRlbmN5LnRzIiwiLi4vLi4vc3JjL2plc3QvbG9hZEFuZFJ1bkdsb2JhbEhvb2sudHMiLCIuLi8uLi9zcmMvamVzdC9qZXN0Q29uZmlnSGVscGVycy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZnVuY3Rpb24gb25jZTxUPihmbjogKCkgPT4gVCk6ICgpID0+IFQge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiAoKTogVCA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdmFsdWUgPSBmbigpO1xuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImltcG9ydCB7IG9uY2UgfSBmcm9tICcuLi91dGlscy9vbmNlJztcblxuY29uc3QgbGV2ZWxzID0gWydkZWJ1ZycsICdpbmZvJywgJ3dhcm4nLCAnZXJyb3InLCAnZmF0YWwnXSBhcyBjb25zdDtcblxudHlwZSBMb2dMZXZlbCA9IHR5cGVvZiBsZXZlbHNbbnVtYmVyXTtcblxudHlwZSBQYXJhbXMgPSBQYXJhbWV0ZXJzPHR5cGVvZiBjb25zb2xlLmxvZz47XG5cbnR5cGUgTG9nZ2VyID0ge1xuICBsb2dMZXZlbDogTG9nTGV2ZWw7XG4gIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgaW5mbyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIC8vIGFsaWFzIGZvciBpbmZvXG4gIGxvZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIC8vIHNwZWNpYWwgdHJlYXRtZW50LCBkaXNhYmxlZCBvbiBDSS9UVFlcbiAgdGlwKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgd2FybiguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGVycm9yKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgZmF0YWwoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xufTtcblxuY29uc3QgZW5hYmxlZExldmVsc0FmdGVyID0gKGxldmVsOiBMb2dMZXZlbCB8ICdvZmYnKSA9PiB7XG4gIGlmIChsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgY29uc3QgaW5kZXggPSBsZXZlbHMuZmluZEluZGV4KChpdGVtKSA9PiBpdGVtID09PSBsZXZlbCk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbGV2ZWwnKTtcbiAgfVxuICByZXR1cm4gbGV2ZWxzLnNsaWNlKGluZGV4KTtcbn07XG5cbmNvbnN0IGlzTGV2ZWwgPSAobGV2ZWw/OiBzdHJpbmcpOiBsZXZlbCBpcyBMb2dMZXZlbCA9PiB7XG4gIHJldHVybiBsZXZlbHMuaW5jbHVkZXMobGV2ZWwgYXMgTG9nTGV2ZWwpO1xufTtcblxuY29uc3QgdmVyYm9zaXR5RnJvbVByb2Nlc3NBcmdzID0gKFxuICBhcmdzID0gcHJvY2Vzcy5hcmd2XG4pOiBMb2dMZXZlbCB8ICdvZmYnIHwgdW5kZWZpbmVkID0+IHtcbiAgY29uc3QgaW5kZXggPSBhcmdzLmZpbmRJbmRleCgodmFsdWUpID0+IHZhbHVlID09PSAnLS1sb2ctbGV2ZWwnKTtcbiAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgY29uc3QgbGV2ZWwgPSBhcmdzW2luZGV4ICsgMV07XG4gIGlmIChsZXZlbCA9PT0gJ3NpbGVudCcgfHwgbGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuICdvZmYnO1xuICB9XG4gIGlmICghaXNMZXZlbChsZXZlbCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBsZXZlbDtcbn07XG5cbmNvbnN0IHZlcmJvc2l0eUZyb21FbnYgPSAoKTogTG9nTGV2ZWwgfCAnb2ZmJyB8IHVuZGVmaW5lZCA9PiB7XG4gIGNvbnN0IGxldmVsID0gcHJvY2Vzcy5lbnZbJ0xPR19MRVZFTCddO1xuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiAnb2ZmJztcbiAgfVxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5jb25zdCBnZXRWZXJib3NpdHlDb25maWcgPSAoKSA9PiB7XG4gIGNvbnN0IGFyZ3NMZXZlbCA9IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncygpO1xuICBjb25zdCBlbnZMZXZlbCA9IHZlcmJvc2l0eUZyb21FbnYoKTtcbiAgcmV0dXJuIGFyZ3NMZXZlbCA/PyBlbnZMZXZlbCA/PyAnaW5mbyc7XG59O1xuXG5jb25zdCBub29wID0gKC4uLl9hcmdzOiBQYXJhbXMpID0+IHtcbiAgcmV0dXJuO1xufTtcblxuY29uc3QgbG9nID0gKC4uLmFyZ3M6IFBhcmFtcykgPT4ge1xuICBjb25zb2xlLmxvZyguLi5hcmdzKTtcbn07XG5cbmNvbnN0IGVycm9yID0gKC4uLmFyZ3M6IFBhcmFtcykgPT4ge1xuICBjb25zb2xlLmVycm9yKC4uLmFyZ3MpO1xufTtcblxuY29uc3Qgc2hvdWxkRW5hYmxlVGlwID0gKCkgPT4gIXByb2Nlc3MuZW52WydDSSddICYmICFwcm9jZXNzLnN0ZG91dC5pc1RUWTtcblxuZXhwb3J0IGNvbnN0IGNyZWF0ZUxvZ2dlciA9IChcbiAgZGVwcyA9IHsgZ2V0VmVyYm9zaXR5Q29uZmlnLCBsb2csIGVycm9yLCBzaG91bGRFbmFibGVUaXAgfVxuKSA9PiB7XG4gIGNvbnN0IGxvZ0xldmVsID0gZGVwcy5nZXRWZXJib3NpdHlDb25maWcoKTtcbiAgY29uc3QgZW5hYmxlZCA9IGVuYWJsZWRMZXZlbHNBZnRlcihsb2dMZXZlbCk7XG4gIHJldHVybiBsZXZlbHMucmVkdWNlKFxuICAgIChhY2MsIGx2bCkgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uYWNjLFxuICAgICAgICBbbHZsXTogZW5hYmxlZC5pbmNsdWRlcyhsdmwpXG4gICAgICAgICAgPyBbJ2ZhdGFsJywgJ2Vycm9yJ10uaW5jbHVkZXMobHZsKVxuICAgICAgICAgICAgPyBkZXBzLmVycm9yXG4gICAgICAgICAgICA6IGRlcHMubG9nXG4gICAgICAgICAgOiBub29wLFxuICAgICAgfTtcbiAgICB9LFxuICAgIHtcbiAgICAgIGxvZ0xldmVsLFxuICAgICAgbG9nOiBlbmFibGVkLmluY2x1ZGVzKCdpbmZvJykgPyBkZXBzLmxvZyA6IG5vb3AsXG4gICAgICB0aXA6IGVuYWJsZWQuaW5jbHVkZXMoJ2luZm8nKSAmJiBkZXBzLnNob3VsZEVuYWJsZVRpcCgpID8gZGVwcy5sb2cgOiBub29wLFxuICAgIH0gYXMgTG9nZ2VyXG4gICk7XG59O1xuXG5jb25zdCBjcmVhdGVEZWxlZ2F0aW5nTG9nZ2VyID0gKG9wdHM6IHsgcGFyZW50OiBMb2dnZXIgfSk6IExvZ2dlciA9PlxuICBPYmplY3QuZnJlZXplKHtcbiAgICBnZXQgbG9nTGV2ZWwoKSB7XG4gICAgICByZXR1cm4gb3B0cy5wYXJlbnQubG9nTGV2ZWw7XG4gICAgfSxcbiAgICBkZWJ1ZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuZGVidWcoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGluZm8oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmluZm8oLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGxvZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQubG9nKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICB0aXAoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LnRpcCguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgd2FybiguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQud2FybiguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgZXJyb3IoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmVycm9yKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBmYXRhbCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuZmF0YWwoLi4ucGFyYW1zKTtcbiAgICB9LFxuICB9KTtcblxubGV0IGRlZmF1bHRMb2dnZXJGYWN0b3J5OiAoKCkgPT4gTG9nZ2VyKSB8IG51bGw7XG5cbmV4cG9ydCBjb25zdCBjb25maWd1cmVEZWZhdWx0TG9nZ2VyID0gKGZhY3Rvcnk6ICgpID0+IExvZ2dlcikgPT4ge1xuICBpZiAoZGVmYXVsdExvZ2dlckZhY3RvcnkpIHtcbiAgICBjb25zdCBlcnJvciA9IHtcbiAgICAgIHN0YWNrOiAnJyxcbiAgICB9O1xuICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKGVycm9yKTtcbiAgICBsb2dnZXIuZGVidWcoJ0Nhbm5vdCBvdmVycmlkZSBkZWZhdWx0IGxvZ2dlciBtdWx0aXBsZSB0aW1lcycsIGVycm9yLnN0YWNrKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZGVmYXVsdExvZ2dlckZhY3RvcnkgPSBmYWN0b3J5O1xufTtcblxuY29uc3QgZGVmYXVsdExvZ2dlciA9IG9uY2UoKCkgPT4ge1xuICBsZXQgZmFjdG9yeSA9IGRlZmF1bHRMb2dnZXJGYWN0b3J5O1xuICBpZiAoIWZhY3RvcnkpIHtcbiAgICBmYWN0b3J5ID0gKCkgPT4gY3JlYXRlTG9nZ2VyKCk7XG4gIH1cbiAgcmV0dXJuIGZhY3RvcnkoKTtcbn0pO1xuXG4vKipcbiAqIERlZmF1bHQgbG9nZ2VyIGluc3RhbmNlIGNhbiBiZSBjb25maWd1cmVkIG9uY2UgYXQgc3RhcnR1cFxuICovXG5leHBvcnQgY29uc3QgbG9nZ2VyOiBMb2dnZXIgPSBjcmVhdGVEZWxlZ2F0aW5nTG9nZ2VyKHtcbiAgZ2V0IHBhcmVudCgpIHtcbiAgICByZXR1cm4gZGVmYXVsdExvZ2dlcigpO1xuICB9LFxufSk7XG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZUFzeW5jPFQ+KGZuOiAoKSA9PiBUIHwgUHJvbWlzZTxUPik6ICgpID0+IFByb21pc2U8VD4ge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBpbkZsaWdodDogUHJvbWlzZTxUPiB8IG51bGw7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiBhc3luYyAoKTogUHJvbWlzZTxUPiA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKGluRmxpZ2h0KSB7XG4gICAgICByZXR1cm4gaW5GbGlnaHQ7XG4gICAgfVxuICAgIGluRmxpZ2h0ID0gUHJvbWlzZS5yZXNvbHZlKGZuKCkpO1xuICAgIHZhbHVlID0gYXdhaXQgaW5GbGlnaHQ7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgaW5GbGlnaHQgPSBudWxsO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnLi4vdXRpbHMvb25jZUFzeW5jJztcbmltcG9ydCB0eXBlIHsgUGFja2FnZUpzb24gfSBmcm9tICcuL3BhY2thZ2VKc29uJztcblxuY29uc3QgY3dkUGFja2FnZUpzb25QYXRoID0gKCkgPT4gam9pbihwcm9jZXNzLmN3ZCgpLCAnLi9wYWNrYWdlLmpzb24nKTtcblxuYXN5bmMgZnVuY3Rpb24gcmVhZFBhY2thZ2VKc29uQXQocGF0aDogc3RyaW5nKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xuICByZXR1cm4gYXdhaXQgcmVhZEZpbGUocGF0aCwgJ3V0Zi04JykudGhlbihcbiAgICAocmVzdWx0KSA9PiBKU09OLnBhcnNlKHJlc3VsdCkgYXMgUGFja2FnZUpzb25cbiAgKTtcbn1cblxuZXhwb3J0IGNvbnN0IHJlYWRDd2RQYWNrYWdlSnNvbiA9IG9uY2VBc3luYygoKSA9PlxuICByZWFkUGFja2FnZUpzb25BdChjd2RQYWNrYWdlSnNvblBhdGgoKSlcbik7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb24ocGF0aDogc3RyaW5nKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xuICAvLyBhc3N1bWluZyBjdXJyZW50IGRpcmVjdG9yeSBkb2Vzbid0IGNoYW5nZSB3aGlsZSBhcHAgaXMgcnVubmluZ1xuICByZXR1cm4gcHJvY2Vzcy5jd2QoKSA9PT0gY3dkUGFja2FnZUpzb25QYXRoKClcbiAgICA/IGF3YWl0IHJlYWRDd2RQYWNrYWdlSnNvbigpXG4gICAgOiBhd2FpdCByZWFkUGFja2FnZUpzb25BdChwYXRoKTtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBpc1RydXRoeTxUPihcbiAgdmFsdWU6IE5vbk51bGxhYmxlPFQ+IHwgZmFsc2UgfCBudWxsIHwgdW5kZWZpbmVkIHwgJycgfCAwXG4pOiB2YWx1ZSBpcyBOb25OdWxsYWJsZTxUPiB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlKTtcbn1cbiIsImltcG9ydCBhc3NlcnQgZnJvbSAnYXNzZXJ0JztcbmltcG9ydCBmZyBmcm9tICdmYXN0LWdsb2InO1xuaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgeyBpc1RydXRoeSB9IGZyb20gJy4vaXNUcnV0aHknO1xuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnLi9vbmNlQXN5bmMnO1xuXG5jb25zdCBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzID0gKGN1cnJlbnREaXJlY3Rvcnk6IHN0cmluZykgPT4ge1xuICAvLyBoYXZpbmcgJ3BhY2thZ2VzLyonIGluIHRoZSByb290IG9mIGEgbW9ub3JlcG8gaXMgc3VwZXIgY29tbW9uXG4gIGNvbnN0IHJlc3VsdCA9IC8oLiooPz1cXC9wYWNrYWdlc1xcLykpfCguKig/PVxcL25vZGVfbW9kdWxlc1xcLykpfCguKikvLmV4ZWMoXG4gICAgY3VycmVudERpcmVjdG9yeVxuICApO1xuICBhc3NlcnQoISFyZXN1bHQpO1xuICBjb25zdCBbLCBwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdF0gPSByZXN1bHQ7XG4gIHJldHVybiBbcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdLmZpbHRlcihpc1RydXRoeSk7XG59O1xuXG4vLyByZXR1cm5zIHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2hpY2ggaGFzIG1vbm9yZXBvIG1hcmtlcnMsIG11bHRpcGxlXG4vLyBkaXJlY3RvcmllcyBjYW4gaGF2ZSB0aGVtIC0gd2hpY2hldmVyIHJlYWQgZmlyc3Qgd2lsbCBiZSByZXR1cm5lZFxuLy8gc28gaWYgb3JkZXIgaXMgaW1wb3J0YW50IC0gc2Nhbm5pbmcgc2hvdWxkIGJlIHNlcGFyYXRlZCB0byBtdWx0aXBsZSBqb2JzXG4vLyB2aWEgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnNcbmNvbnN0IGhhc1Jvb3RNYXJrZXJzID0gYXN5bmMgKGNhbmRpZGF0ZXM6IHN0cmluZ1tdKSA9PiB7XG4gIGNvbnN0IG1hcmtlcnMgPSBbXG4gICAgJy5naXQnLFxuICAgICd5YXJuLmxvY2snLFxuICAgICdwbnBtLWxvY2sueWFtbCcsXG4gICAgJ3BhY2thZ2UtbG9jay5qc29uJyxcbiAgICAncG5wbS13b3Jrc3BhY2UueWFtbCcsXG4gIF07XG4gIGNvbnN0IG1hcmtlcnNTdHJlYW0gPSBmZy5zdHJlYW0oXG4gICAgY2FuZGlkYXRlcy5mbGF0TWFwKChkaXIpID0+IG1hcmtlcnMubWFwKChtYXJrZXIpID0+IGpvaW4oZGlyLCBtYXJrZXIpKSksXG4gICAge1xuICAgICAgbWFya0RpcmVjdG9yaWVzOiB0cnVlLFxuICAgICAgb25seUZpbGVzOiBmYWxzZSxcbiAgICB9XG4gICk7XG4gIHJldHVybiBuZXcgUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+KChyZXMpID0+IHtcbiAgICBtYXJrZXJzU3RyZWFtLm9uKCdkYXRhJywgKGVudHJ5OiBzdHJpbmcpID0+IHtcbiAgICAgIHJlcyhkaXJuYW1lKGVudHJ5KSk7XG4gICAgICBpZiAoJ2Rlc3Ryb3knIGluIG1hcmtlcnNTdHJlYW0pIHtcbiAgICAgICAgKG1hcmtlcnNTdHJlYW0gYXMgdW5rbm93biBhcyB7IGRlc3Ryb3k6ICgpID0+IHZvaWQgfSkuZGVzdHJveSgpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIG1hcmtlcnNTdHJlYW0ub24oJ2VuZCcsICgpID0+IHtcbiAgICAgIHJlcyh1bmRlZmluZWQpO1xuICAgIH0pO1xuICB9KTtcbn07XG5cbmNvbnN0IHByaW9yaXRpemVkSGFzTWFya2VycyA9IChqb2JzOiBzdHJpbmdbXVtdKSA9PiB7XG4gIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgfVxuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPigocmVzKSA9PiB7XG4gICAgY29uc3QgcmVzdWx0cyA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmcgfCB1bmRlZmluZWQ+KCk7XG5cbiAgICBjb25zdCBjaGVja1Nob3VsZENvbXBsZXRlID0gKGluZGV4OiBudW1iZXIsIHJlc3VsdDogc3RyaW5nIHwgdW5kZWZpbmVkKSA9PiB7XG4gICAgICByZXN1bHRzLnNldChpbmRleCwgcmVzdWx0KTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgam9icy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBoYXNSZXN1bHQgPSByZXN1bHRzLmhhcyhpKTtcbiAgICAgICAgaWYgKCFoYXNSZXN1bHQpIHtcbiAgICAgICAgICAvLyBpZiBhIGpvYiB3aXRoIGhpZ2hlc3QgcHJpb3JpdHkgaGFzbid0IGZpbmlzaGVkIHlldFxuICAgICAgICAgIC8vIHRoZW4gd2FpdCBmb3IgaXRcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXN1bHQgPSByZXN1bHRzLmdldChpKTtcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIC8vIGpvYiBmaW5pc2hlZCBhbmQgd2UgZm91bmQgbWFya2VycywgYWxzbyBhbGwgam9ic1xuICAgICAgICAgIC8vIHdpdGggaGlnaGVyIHByaW9yaXR5IGZpbmlzaGVkIGFuZCB0aGV5IGRvbid0IGhhdmVcbiAgICAgICAgICAvLyBhbnkgbWFya2VycyAtIHdlIGFyZSBkb25lXG4gICAgICAgICAgcmVzKHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHRzLnNpemUgPT09IGpvYnMubGVuZ3RoKSB7XG4gICAgICAgIC8vIGFsbCBqb2JzIGZpbmlzaGVkIC0gbm8gbWFya2VycyBmb3VuZFxuICAgICAgICByZXModW5kZWZpbmVkKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgam9icy5mb3JFYWNoKChkaXJlY3RvcmllcywgaW5kZXgpID0+IHtcbiAgICAgIGhhc1Jvb3RNYXJrZXJzKGRpcmVjdG9yaWVzKVxuICAgICAgICAudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgICAgY2hlY2tTaG91bGRDb21wbGV0ZShpbmRleCwgcmVzdWx0KTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBpZ25vcmVcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn07XG5cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuID0gYXN5bmMgKFxuICBsb29rdXBEaXJlY3Rvcnk6IHN0cmluZ1xuKSA9PiB7XG4gIGNvbnN0IHVuaXF1ZURpcm5hbWUgPSAocGF0aD86IHN0cmluZykgPT4ge1xuICAgIGlmICghcGF0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBkaXJuYW1lKHBhdGgpO1xuICAgIGlmIChyZXN1bHQgPT09IHBhdGgpIHtcbiAgICAgIC8vIGUuZy4gdGhlIHBhdGggd2FzIGFscmVhZHkgYSByb290IFwiL1wiXG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgY29uc3QgcGFyZW50ID0gdW5pcXVlRGlybmFtZShsb29rdXBEaXJlY3RvcnkpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IHVuaXF1ZURpcm5hbWUocGFyZW50KTtcblxuICByZXR1cm4gKFxuICAgIChhd2FpdCBwcmlvcml0aXplZEhhc01hcmtlcnMoXG4gICAgICAvLyBzY2FuIGluIG1vc3QgbGlrZWx5IGxvY2F0aW9ucyBmaXJzdCB3aXRoIGN1cnJlbnQgbG9va3VwIGRpcmVjdG9yeSB0YWtpbmcgcHJpb3JpdHlcbiAgICAgIFtcbiAgICAgICAgW2xvb2t1cERpcmVjdG9yeV0sXG4gICAgICAgIGdldFJlcG9zaXRvcnlSb290U2NhbkNhbmRpZGF0ZXMobG9va3VwRGlyZWN0b3J5KSxcbiAgICAgICAgLy8gc2NhbiAyIGRpcmVjdG9yaWVzIHVwd2FyZHNcbiAgICAgICAgW3BhcmVudF0sXG4gICAgICAgIFtzdXBlclBhcmVudF0sXG4gICAgICBdXG4gICAgICAgIC5tYXAoKGRpcnMpID0+IGRpcnMuZmlsdGVyKGlzVHJ1dGh5KSlcbiAgICAgICAgLmZpbHRlcigoam9iKSA9PiBqb2IubGVuZ3RoID4gMClcbiAgICApKSB8fCBsb29rdXBEaXJlY3RvcnkgLyogZmFsbGJhY2sgdG8gY3VycmVudCBkaXJlY3RvcnkgaW4gd29yc2Ugc2NlbmFyaW8gKi9cbiAgKTtcbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIHJlcG9zaXRvcnkgcm9vdCBwYXRoIGJ5IHNjYW5uaW5nIGN1cnJlbnQgYW5kIHBhcmVudCBkaXJlY3Rvcmllc1xuICogYW5kIGxvb2tpbmcgZm9yIG1hcmtlciBmaWxlcy9kaXJzIGxpa2U6XG4gKlxuICogLSAuZ2l0XG4gKiAtIHBhY2thZ2UtbG9jay5qc29uXG4gKiAtIHlhcm4ubG9ja1xuICogLSBwbnBtLWxvY2sueWFtbFxuICogLSBwbnBtLXdvcmtzcGFjZS55YW1sXG4gKi9cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGggPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290UGF0aCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4ocHJvY2Vzcy5jd2QoKSk7XG4gIHJldHVybiByb290UGF0aDtcbn0pO1xuIiwiLyoqXG4gKiBDYXB0dXJlIHRoZSBzdGFjayB0cmFjZSBhbmQgYWxsb3cgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgdGhyb3duIGluIGFzeW5jaHJvbm91cyBjYWxsYmFja3NcbiAqIHdpdGggYWRkaXRpb25hbCBzdGFjayBpbmZvcm1hdGlvbiBjYXB0dXJlZCBhdCB0aGUgbW9tZW50IG9mIHRoZSBjYWxsIG9mIHRoaXMgZnVuY3Rpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhcHR1cmVTdGFja1RyYWNlKHJlbW92ZSA9IDApIHtcbiAgY29uc3Qgc3RhY2tDb250YWluZXIgPSB7XG4gICAgc3RhY2s6ICcnLFxuICB9O1xuICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShzdGFja0NvbnRhaW5lcik7XG4gIGNvbnN0IHN0YWNrVHJhY2UgPSBzdGFja0NvbnRhaW5lci5zdGFja1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuc2xpY2UoNiArIHJlbW92ZSlcbiAgICAuam9pbignXFxuJyk7XG4gIHJldHVybiB7XG4gICAgLyoqXG4gICAgICogQ2FwdHVyZWQgc3RhY2sgdHJhY2UgaW5mb3JtYXRpb25cbiAgICAgKi9cbiAgICBzdGFja1RyYWNlLFxuICAgIC8qKlxuICAgICAqIENhbiBiZSBjYWxsZWQgaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrIHRvIGVucmljaCBleGNlcHRpb25zIHdpdGggYWRkaXRpb25hbCBpbmZvcm1hdGlvblxuICAgICAqIEBwYXJhbSBlcnIgRXhjZXB0aW9uIHRvIGVucmljaCAtIGl0IGlzIGdvaW5nIHRvIGhhdmUgaXRzIGAuc3RhY2tgIHByb3AgbXV0YXRlZFxuICAgICAqIEByZXR1cm5zIFNhbWUgZXhjZXB0aW9uXG4gICAgICovXG4gICAgcHJlcGFyZUZvclJldGhyb3c6IChlcnI6IEVycm9yKSA9PiB7XG4gICAgICBjb25zdCBvbGRTdGFja1RyYWNlID0gZXJyLnN0YWNrID8/ICcnLnNwbGl0KCdcXG4nKS5zbGljZSgxKS5qb2luKCdcXG4nKTtcbiAgICAgIGVyci5zdGFjayA9IGAke2Vyci5uYW1lIHx8ICdFcnJvcid9OiAke1xuICAgICAgICBlcnIubWVzc2FnZVxuICAgICAgfVxcbiR7b2xkU3RhY2tUcmFjZX1cXG4ke3N0YWNrVHJhY2V9YDtcbiAgICAgIHJldHVybiBlcnI7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHNwYXduIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IEFzc2lnbiB9IGZyb20gJ3V0aWxpdHktdHlwZXMnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IGNhcHR1cmVTdGFja1RyYWNlIH0gZnJvbSAnLi4vdXRpbHMvc3RhY2tUcmFjZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduVG9Qcm9taXNlT3B0cyA9IHtcbiAgLyoqXG4gICAqIFNwZWNpZnkgZXhpdCBjb2RlcyB3aGljaCBzaG91bGQgbm90IHJlc3VsdCBpbiB0aHJvd2luZyBhbiBlcnJvciB3aGVuXG4gICAqIHRoZSBwcm9jZXNzIGhhcyBmaW5pc2hlZCwgZS5nLiBzcGVjaWZ5aW5nIGBbMF1gIG1lYW5zIGlmIHByb2Nlc3MgZmluaXNoZWRcbiAgICogd2l0aCB6ZXJvIGV4aXQgY29kZSB0aGVuIHRoZSBwcm9taXNlIHdpbGwgcmVzb2x2ZSBpbnN0ZWFkIG9mIHJlamVjdGluZy5cbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgc3BlY2lmeSBgaW5oZXJpdGAgdG8gc2F2ZSBzdGF0dXMgY29kZSB0byB0aGUgY3VycmVudCBgcHJvY2Vzcy5leGl0Q29kZWBcbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgY29tcGxldGVseSBpZ25vcmUgdGhlIGV4aXQgY29kZSAoZS5nLiB5b3UgZm9sbG93IHVwIGFuZCBpbnRlcnJvZ2F0ZVxuICAgKiB0aGUgcHJvY2VzcyBjb2RlIG1hbnVhbGx5IGFmdGVyd2FyZHMpXG4gICAqL1xuICBleGl0Q29kZXM6IG51bWJlcltdIHwgJ2luaGVyaXQnIHwgJ2FueSc7XG59O1xuXG50eXBlIFNoYXJlZE9wdHMgPSBQaWNrPFNwYXduT3B0aW9ucywgJ2N3ZCc+O1xuXG50eXBlIFNwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PiA9IFtcbiAgY29tbWFuZDogc3RyaW5nLFxuICBhcmdzOiBSZWFkb25seUFycmF5PHN0cmluZz4sXG4gIG9wdGlvbnM6IEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+XG5dO1xuXG5leHBvcnQgdHlwZSBTcGF3bk9wdGlvbnNXaXRoRXh0cmE8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICBBc3NpZ248U3Bhd25PcHRpb25zLCBFPjtcblxuZXhwb3J0IHR5cGUgU3Bhd25QYXJhbWV0ZXJNaXg8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICB8IFtjcDogQ2hpbGRQcm9jZXNzLCBleHRyYU9wdHM6IEFzc2lnbjxFLCBTaGFyZWRPcHRzPl1cbiAgfCBTcGF3bkFyZ3M8RT47XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgYXJnczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbik6IGFyZ3MgaXMgU3Bhd25BcmdzPEU+IHtcbiAgcmV0dXJuICEoYXJnc1swXSBpbnN0YW5jZW9mIENoaWxkUHJvY2VzcykgJiYgdHlwZW9mIGFyZ3NbMF0gPT09ICdzdHJpbmcnO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzPEUgZXh0ZW5kcyBvYmplY3Q+KFxuICBwYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxFPlxuKSB7XG4gIGNvbnN0IFtjaGlsZCwgW2NvbW1hbmQsIGFyZ3MsIG9wdHNdXSA9IGlzU3Bhd25BcmdzKHBhcmFtZXRlcnMpXG4gICAgPyBbXG4gICAgICAgIHNwYXduKC4uLihwYXJhbWV0ZXJzIGFzIHVua25vd24gYXMgUGFyYW1ldGVyczx0eXBlb2Ygc3Bhd24+KSksXG4gICAgICAgIHBhcmFtZXRlcnMsXG4gICAgICBdXG4gICAgOiBbXG4gICAgICAgIHBhcmFtZXRlcnNbMF0sXG4gICAgICAgIFtcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduZmlsZSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduYXJncy5zbGljZSgxKSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzFdIGFzIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+LFxuICAgICAgICBdLFxuICAgICAgXTtcbiAgcmV0dXJuIHtcbiAgICBjaGlsZCxcbiAgICBjb21tYW5kLFxuICAgIGFyZ3MsXG4gICAgb3B0cyxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduVG9Qcm9taXNlKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHsgY2hpbGQsIGNvbW1hbmQsIGFyZ3MsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgeyBwcmVwYXJlRm9yUmV0aHJvdyB9ID0gY2FwdHVyZVN0YWNrVHJhY2UoKTtcblxuICBjb25zdCBleGl0Q29kZXMgPSBvcHRzLmV4aXRDb2RlcztcblxuICBjb25zdCBjd2QgPSBvcHRzLmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY21kID0gKCkgPT4gW2NvbW1hbmQsIC4uLmFyZ3NdLmpvaW4oJyAnKTtcblxuICBsb2dnZXIuZGVidWcoWyc+JywgY21kKCldLmpvaW4oJyAnKSwgLi4uKGN3ZCA/IFtgaW4gJHtjd2R9YF0gOiBbXSkpO1xuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMsIHJlaikgPT5cbiAgICBjaGlsZFxuICAgICAgLm9uKCdjbG9zZScsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGV4aXRDb2RlcyAhPT0gJ2luaGVyaXQnICYmXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdhbnknICYmXG4gICAgICAgICAgICAhZXhpdENvZGVzLmluY2x1ZGVzKGNvZGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZWooXG4gICAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihgQ29tbWFuZCBcIiR7Y21kKCl9XCIgaGFzIGZhaWxlZCB3aXRoIGNvZGUgJHtjb2RlfWApXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgICByZWooXG4gICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBGYWlsZWQgdG8gZXhlY3V0ZSBjb21tYW5kIFwiJHtjbWQoKX1cIiAtICR7c2lnbmFsfWApXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLm9uKCdlcnJvcicsIHJlailcbiAgKTtcbiAgLy8gaW5oZXJpdCBleGl0IGNvZGVcbiAgaWYgKGV4aXRDb2RlcyA9PT0gJ2luaGVyaXQnKSB7XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIGNoaWxkLmV4aXRDb2RlID09PSAnbnVtYmVyJyAmJlxuICAgICAgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJyB8fCBwcm9jZXNzLmV4aXRDb2RlID09PSAwKVxuICAgICkge1xuICAgICAgcHJvY2Vzcy5leGl0Q29kZSA9IGNoaWxkLmV4aXRDb2RlO1xuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuXG5pbXBvcnQgdHlwZSB7IFNwYXduUGFyYW1ldGVyTWl4LCBTcGF3blRvUHJvbWlzZU9wdHMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcblxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRPcHRzID0ge1xuICBvdXRwdXQ/OiBbJ3N0ZG91dCcgfCAnc3RkZXJyJywgLi4uQXJyYXk8J3N0ZG91dCcgfCAnc3RkZXJyJz5dO1xufSAmIFNwYXduVG9Qcm9taXNlT3B0cztcblxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRSZXR1cm4gPSB7XG4gIHBpZD86IG51bWJlcjtcbiAgb3V0cHV0OiBzdHJpbmdbXTtcbiAgc3Rkb3V0OiBzdHJpbmc7XG4gIHN0ZGVycjogc3RyaW5nO1xuICBzdGF0dXM6IG51bWJlciB8IG51bGw7XG4gIHNpZ25hbDogTm9kZUpTLlNpZ25hbHMgfCBudWxsO1xuICBlcnJvcj86IEVycm9yIHwgdW5kZWZpbmVkO1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduUmVzdWx0KFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxTcGF3blJlc3VsdE9wdHM+XG4pOiBQcm9taXNlPFNwYXduUmVzdWx0UmV0dXJuPiB7XG4gIGNvbnN0IHsgY2hpbGQsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgY29tYmluZWREYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGRvdXREYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBvdXRwdXQgPSBvcHRzLm91dHB1dCA/PyBbJ3N0ZG91dCcsICdzdGRlcnInXTtcbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3Rkb3V0JykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZG91dCxcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRvdXRcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRvdXREYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3RkZXJyJykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZGVycixcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRlcnJcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3NwYXduVG9Qcm9taXNlKGNoaWxkLCBvcHRzKV0pO1xuICByZXR1cm4ge1xuICAgIHBpZDogY2hpbGQucGlkLFxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcbiAgICBzdGF0dXM6IGNoaWxkLmV4aXRDb2RlLFxuICAgIGdldCBvdXRwdXQoKSB7XG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xuICAgIH0sXG4gICAgZ2V0IHN0ZGVycigpIHtcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IHN0ZG91dCgpIHtcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IGVycm9yKCkge1xuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcbiAgICAgICAgPyAocmVzdWx0LnJlYXNvbiBhcyBFcnJvcilcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMsIFNwYXduUmVzdWx0UmV0dXJuIH0gZnJvbSAnLi9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBzcGF3blJlc3VsdCB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwgb3B0cyk7XG4gIHJldHVybiByZXN1bHQub3V0cHV0LmpvaW4oJycpO1xufVxuXG5jb25zdCBkZWZhdWx0U2hvdWxkT3V0cHV0ID0gKHJlc3VsdDogU3Bhd25SZXN1bHRSZXR1cm4pID0+IHtcbiAgcmV0dXJuIHJlc3VsdC5lcnJvciB8fCByZXN1bHQuc3RhdHVzICE9PSAwIHx8IGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJztcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxcbiAgICBTcGF3blJlc3VsdE9wdHMgJiB7XG4gICAgICAvKipcbiAgICAgICAqIEJ5IGRlZmF1bHQgd2lsbCBvdXRwdXQgdG8gYHN0ZGVycmAgd2hlbiBzcGF3biByZXN1bHQgZmFpbGVkIHdpdGggYW4gZXJyb3IsIHdoZW5cbiAgICAgICAqIHN0YXR1cyBjb2RlIGlzIG5vdCB6ZXJvIG9yIHdoZW4gYExvZ2dlci5sb2dMZXZlbGAgaXMgYGRlYnVnYFxuICAgICAgICovXG4gICAgICBzaG91bGRPdXRwdXQ/OiAocmVzdWx0OiBTcGF3blJlc3VsdFJldHVybikgPT4gYm9vbGVhbjtcbiAgICB9XG4gID5cbikge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcbiAgY29uc3Qgc2hvdWxkT3V0cHV0ID0gb3B0cy5zaG91bGRPdXRwdXQgPz8gZGVmYXVsdFNob3VsZE91dHB1dDtcbiAgaWYgKHNob3VsZE91dHB1dChyZXN1bHQpKSB7XG4gICAgbG9nZ2VyLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xuICB9XG4gIGlmIChyZXN1bHQuZXJyb3IpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG59XG4iLCJpbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmltcG9ydCB7IG9uY2UgfSBmcm9tICcuL29uY2UnO1xuXG5leHBvcnQgY29uc3QgZ2V0TW9kdWxlUm9vdERpcmVjdG9yeUZvckltcG9ydE1ldGFVcmwgPSAob3B0czoge1xuICBpbXBvcnRNZXRhVXJsOiBzdHJpbmc7XG59KSA9PiB7XG4gIC8vIHRoaXMgaXMgaGlnaGx5IGRlcGVuZGVudCBvbiB0aGUgb3V0cHV0IGRpcmVjdG9yeSBzdHJ1Y3R1cmVcbiAgLy8gYW5kIHRoZSBjb250ZXh0IGluIHdoaWNoIHRoaXMgZnVuY3Rpb24gaXMgcnVuIChidW5kbGVkIGNvZGUgdnMgdHN4IC4vc3JjL3RzZmlsZS50cylcbiAgY29uc3QgX19maWxlTmFtZSA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChvcHRzLmltcG9ydE1ldGFVcmwpKTtcbiAgY29uc3QgcGFyZW50ID0gZGlybmFtZShfX2ZpbGVOYW1lKTtcbiAgY29uc3Qgc3VwZXJQYXJlbnQgPSBkaXJuYW1lKHBhcmVudCk7XG5cbiAgY29uc3QgaXNCdW5kbGVkSW5EaXN0ID0gKCkgPT4gcGFyZW50LmVuZHNXaXRoKCcvZGlzdCcpO1xuICBjb25zdCBpc0J1bmRsZWRJbkJpbiA9ICgpID0+XG4gICAgcGFyZW50LmVuZHNXaXRoKCcvYmluJykgJiYgIXN1cGVyUGFyZW50LmVuZHNXaXRoKCcvc3JjJyk7XG5cbiAgaWYgKGlzQnVuZGxlZEluRGlzdCgpIHx8IGlzQnVuZGxlZEluQmluKCkpIHtcbiAgICByZXR1cm4gZmlsZVVSTFRvUGF0aChuZXcgVVJMKGAuLi9gLCBvcHRzLmltcG9ydE1ldGFVcmwpKTtcbiAgfVxuXG4gIC8vIHJ1biB2aWEgdHN4IHRvIGJ1aWxkIHRoZSBAcmVwa2Eta2l0L3RzIGl0c2VsZlxuICByZXR1cm4gZmlsZVVSTFRvUGF0aChuZXcgVVJMKGAuLi8uLi9gLCBvcHRzLmltcG9ydE1ldGFVcmwpKTtcbn07XG5cbmV4cG9ydCBjb25zdCBtb2R1bGVSb290RGlyZWN0b3J5ID0gb25jZSgoKSA9PlxuICBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCh7IGltcG9ydE1ldGFVcmw6IGltcG9ydC5tZXRhLnVybCB9KVxuKTtcbiIsImltcG9ydCB7IHJlYWRGaWxlLCBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBkaXJuYW1lLCBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4vbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5cbmFzeW5jIGZ1bmN0aW9uIGlzRmlsZShmaWxlUGF0aDogc3RyaW5nKSB7XG4gIHJldHVybiBhd2FpdCBzdGF0KGZpbGVQYXRoKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xufVxuXG5hc3luYyBmdW5jdGlvbiogaXRlcmF0ZU5vZGVNb2R1bGVzKHN0YXJ0V2l0aDogc3RyaW5nLCBwYXRoOiBzdHJpbmcpIHtcbiAgbGV0IGN1cnJlbnQgPSBzdGFydFdpdGg7XG4gIHdoaWxlIChjdXJyZW50ICE9PSAnLycgJiYgY3VycmVudCAhPT0gJ34vJykge1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGpvaW4oY3VycmVudCwgJ25vZGVfbW9kdWxlcycsIHBhdGgpO1xuICAgIGlmIChhd2FpdCBpc0ZpbGUoY2FuZGlkYXRlKSkge1xuICAgICAgeWllbGQgY2FuZGlkYXRlO1xuICAgIH1cbiAgICBjdXJyZW50ID0gZGlybmFtZShjdXJyZW50KTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBmaW5kQmluU2NyaXB0KHN0YXJ0V2l0aDogc3RyaW5nLCBiaW5TY3JpcHRQYXRoOiBzdHJpbmcpIHtcbiAgZm9yIGF3YWl0IChjb25zdCBwYXRoIG9mIGl0ZXJhdGVOb2RlTW9kdWxlcyhzdGFydFdpdGgsIGJpblNjcmlwdFBhdGgpKSB7XG4gICAgcmV0dXJuIHBhdGg7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJpblBhdGgob3B0czoge1xuICBiaW5OYW1lOiBzdHJpbmc7XG4gIGJpblNjcmlwdFBhdGg6IHN0cmluZztcbiAgdXNlU2hvcnRjdXQ/OiBib29sZWFuO1xufSkge1xuICBjb25zdCB1c2VTaG9ydGN1dCA9IG9wdHMudXNlU2hvcnRjdXQgPz8gdHJ1ZTtcbiAgY29uc3Qgcm9vdCA9IG1vZHVsZVJvb3REaXJlY3RvcnkoKTtcbiAgaWYgKHVzZVNob3J0Y3V0KSB7XG4gICAgY29uc3QgYmVzdEd1ZXNzID0gam9pbihyb290LCAnbm9kZV9tb2R1bGVzJywgJy5iaW4nLCBvcHRzLmJpbk5hbWUpO1xuICAgIGlmIChhd2FpdCBpc0ZpbGUoYmVzdEd1ZXNzKSkge1xuICAgICAgcmV0dXJuIGJlc3RHdWVzcztcbiAgICB9XG4gIH1cbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmluZEJpblNjcmlwdChyb290LCBvcHRzLmJpblNjcmlwdFBhdGgpO1xuICBpZiAocmVzdWx0KSB7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBmaW5kIGJpbiAke29wdHMuYmluTmFtZX1gKTtcbn1cblxuZnVuY3Rpb24gc2NyaXB0RnJvbVBhY2thZ2VKc29uKG9wdHM6IHtcbiAgYmluTmFtZTogc3RyaW5nO1xuICBwYWNrYWdlSnNvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59KSB7XG4gIGNvbnN0IGNhbmRpZGF0ZSA9IG9wdHMucGFja2FnZUpzb25bJ2JpbiddO1xuICBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gY2FuZGlkYXRlO1xuICB9IGVsc2UgaWYgKHR5cGVvZiBjYW5kaWRhdGUgPT09ICdvYmplY3QnICYmIGNhbmRpZGF0ZSAhPT0gbnVsbCkge1xuICAgIGNvbnN0IGVudHJ5ID0gKGNhbmRpZGF0ZSBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KVtvcHRzLmJpbk5hbWVdO1xuICAgIGlmICh0eXBlb2YgZW50cnkgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gZW50cnk7XG4gICAgfVxuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZXRlcm1pbmVCaW5TY3JpcHRQYXRoKG9wdHM6IHtcbiAgYmluTmFtZTogc3RyaW5nO1xuICBiaW5QYWNrYWdlTmFtZTogc3RyaW5nO1xufSkge1xuICBmb3IgYXdhaXQgKGNvbnN0IHBhdGggb2YgaXRlcmF0ZU5vZGVNb2R1bGVzKFxuICAgIG1vZHVsZVJvb3REaXJlY3RvcnkoKSxcbiAgICBqb2luKG9wdHMuYmluUGFja2FnZU5hbWUsICdwYWNrYWdlLmpzb24nKVxuICApKSB7XG4gICAgY29uc3QgcGtnID0gYXdhaXQgcmVhZEZpbGUocGF0aCwgJ3V0Zi04JylcbiAgICAgIC50aGVuKCh0ZXh0KSA9PiBKU09OLnBhcnNlKHRleHQpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgLmNhdGNoKCgpID0+IG51bGwpO1xuICAgIGlmICghcGtnKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzY3JpcHRQYXRoID0gc2NyaXB0RnJvbVBhY2thZ2VKc29uKHtcbiAgICAgIGJpbk5hbWU6IG9wdHMuYmluTmFtZSxcbiAgICAgIHBhY2thZ2VKc29uOiBwa2csXG4gICAgfSk7XG4gICAgaWYgKCFzY3JpcHRQYXRoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBjYW5kaWRhdGUgPSBqb2luKGRpcm5hbWUocGF0aCksIHNjcmlwdFBhdGgpO1xuICAgIGlmIChhd2FpdCBpc0ZpbGUoY2FuZGlkYXRlKSkge1xuICAgICAgcmV0dXJuIGpvaW4ob3B0cy5iaW5QYWNrYWdlTmFtZSwgc2NyaXB0UGF0aCk7XG4gICAgfVxuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gaW5jbHVkZXNBbnlPZih0YXJnZXQ6IHN0cmluZ1tdLCBoYXNBbnlPZkFyZ3M6IHN0cmluZ1tdKSB7XG4gIHJldHVybiBoYXNBbnlPZkFyZ3Muc29tZSgodmFyaWFudCkgPT4gdGFyZ2V0LmluY2x1ZGVzKHZhcmlhbnQpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluc2VydEFmdGVyQW55T2YoXG4gIHRhcmdldDogc3RyaW5nW10sXG4gIGluc2VydDogc3RyaW5nW10sXG4gIGhhc0FueU9mQXJnczogc3RyaW5nW11cbikge1xuICBjb25zdCBpbmRleCA9IHRhcmdldC5maW5kSW5kZXgoKHZhbHVlKSA9PiBoYXNBbnlPZkFyZ3MuaW5jbHVkZXModmFsdWUpKTtcbiAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgIHJldHVybiB0YXJnZXQ7XG4gIH1cbiAgY29uc3QgcmVzdWx0ID0gWy4uLnRhcmdldF07XG4gIHJlc3VsdC5zcGxpY2UoaW5kZXggKyAxLCAwLCAuLi5pbnNlcnQpO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlQXJnc0Zyb20oXG4gIHRhcmdldDogc3RyaW5nW10sXG4gIGFyZ3M6IEFycmF5PHN0cmluZyB8IFJlZ0V4cD4sXG4gIG9wdHM/OiB7IG51bVZhbHVlczogbnVtYmVyIH1cbikge1xuICBjb25zdCByZXN1bHQgPSBbLi4udGFyZ2V0XTtcbiAgZm9yIChjb25zdCBhcmcgb2YgYXJncykge1xuICAgIGNvbnN0IGluZGV4ID0gdGFyZ2V0LmZpbmRJbmRleCgodmFsdWUpID0+XG4gICAgICB0eXBlb2YgYXJnID09PSAnc3RyaW5nJyA/IHZhbHVlID09PSBhcmcgOiBhcmcudGVzdCh2YWx1ZSlcbiAgICApO1xuICAgIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICAgIHJlc3VsdC5zcGxpY2UoaW5kZXgsIG9wdHM/Lm51bVZhbHVlcyA/IG9wdHMubnVtVmFsdWVzICsgMSA6IDEpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlSW5wdXRBcmdzKFxuICBhcmdzOiBBcnJheTxzdHJpbmcgfCBSZWdFeHA+LFxuICBvcHRzPzogeyBudW1WYWx1ZXM6IG51bWJlciB9XG4pIHtcbiAgcmV0dXJuIChzdGF0ZTogQ2xpQXJncykgPT4ge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIGlucHV0QXJnczogcmVtb3ZlQXJnc0Zyb20oc3RhdGUuaW5wdXRBcmdzLCBhcmdzLCBvcHRzKSxcbiAgICB9O1xuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2V0RGVmYXVsdEFyZ3MoXG4gIGFyZ3M6IFtzdHJpbmcsIC4uLnN0cmluZ1tdXSxcbiAgdmFsdWVzOiBzdHJpbmdbXSA9IFtdLFxuICBjb25kaXRpb24/OiAoc3RhdGU6IENsaUFyZ3MpID0+IGJvb2xlYW4sXG4gIGFwcGx5PzogKGFyZ3M6IHN0cmluZ1tdLCBzdGF0ZTogQ2xpQXJncykgPT4gQ2xpQXJnc1xuKSB7XG4gIHJldHVybiAoc3RhdGU6IENsaUFyZ3MpID0+IHtcbiAgICBpZiAoY29uZGl0aW9uKSB7XG4gICAgICBpZiAoIWNvbmRpdGlvbihzdGF0ZSkpIHtcbiAgICAgICAgcmV0dXJuIHN0YXRlO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIGFyZ3MpKSB7XG4gICAgICByZXR1cm4gc3RhdGU7XG4gICAgfVxuICAgIGNvbnN0IHNldDogTm9uTnVsbGFibGU8dHlwZW9mIGFwcGx5PiA9IGFwcGx5XG4gICAgICA/IGFwcGx5XG4gICAgICA6IChhcmdzLCB0bykgPT4gKHtcbiAgICAgICAgICAuLi50byxcbiAgICAgICAgICBwcmVBcmdzOiBbLi4uc3RhdGUucHJlQXJncywgLi4uYXJnc10sXG4gICAgICAgIH0pO1xuICAgIHJldHVybiBzZXQoW2FyZ3NbMF0sIC4uLnZhbHVlc10sIHN0YXRlKTtcbiAgfTtcbn1cblxuZXhwb3J0IGNvbnN0IHJlbW92ZUxvZ0xldmVsT3B0aW9uID0gKCkgPT5cbiAgcmVtb3ZlSW5wdXRBcmdzKFsnLS1sb2ctbGV2ZWwnXSwgeyBudW1WYWx1ZXM6IDEgfSk7XG5cbmV4cG9ydCB0eXBlIENsaUFyZ3MgPSB7XG4gIC8qKlxuICAgKiBFeHRyYSBhcmd1bWVudHMgdGhhdCBnbyBiZWZvcmUgYXJndW1lbnRzIHBhc3NlZCBpbiBieSB0aGUgdXNlclxuICAgKi9cbiAgcHJlQXJnczogc3RyaW5nW107XG4gIC8qKlxuICAgKiBBcmd1bWVudHMgYXMgcGFzc2VkIGluIGJ5IHRoZSB1c2VyLCBjb3VsZCBiZSBtb2RpZmllZCBieVxuICAgKiB0cmFuc2Zvcm1zIHRoYXQgY29tZSBiZWZvcmUgY3VycmVudFxuICAgKi9cbiAgaW5wdXRBcmdzOiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIEV4dHJhIGFyZ3VtZW50cyB0aGF0IGdvIGFmdGVyIGFyZ3VtZW50cyBwYXNzZWQgaW4gYnkgdGhlIHVzZXJcbiAgICovXG4gIHBvc3RBcmdzOiBzdHJpbmdbXTtcbn07XG5cbmV4cG9ydCB0eXBlIENsaUFyZ3NUcmFuc2Zvcm0gPSAoc3RhdGU6IENsaUFyZ3MpID0+IENsaUFyZ3M7XG5cbmV4cG9ydCBmdW5jdGlvbiBjbGlBcmdzUGlwZShcbiAgdHJhbnNmb3JtczogQ2xpQXJnc1RyYW5zZm9ybVtdLFxuICBpbnB1dEFyZ3M6IHN0cmluZ1tdXG4pIHtcbiAgY29uc3Qge1xuICAgIHByZUFyZ3MsXG4gICAgaW5wdXRBcmdzOiBtb2RpZmllZElucHV0QXJncyxcbiAgICBwb3N0QXJncyxcbiAgfSA9IHRyYW5zZm9ybXMucmVkdWNlPENsaUFyZ3M+KChhY2MsIHRyYW5zZm9ybSkgPT4gdHJhbnNmb3JtKGFjYyksIHtcbiAgICBpbnB1dEFyZ3MsXG4gICAgcHJlQXJnczogW10sXG4gICAgcG9zdEFyZ3M6IFtdLFxuICB9KTtcbiAgcmV0dXJuIFsuLi5wcmVBcmdzLCAuLi5tb2RpZmllZElucHV0QXJncywgLi4ucG9zdEFyZ3NdO1xufVxuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnNXaXRoRXh0cmEgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IFNwYXduUmVzdWx0T3B0cyB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBiaW5QYXRoIH0gZnJvbSAnLi91dGlscy9iaW5QYXRoJztcbmltcG9ydCB0eXBlIHsgQ2xpQXJncyB9IGZyb20gJy4vdXRpbHMvY2xpQXJnc1BpcGUnO1xuaW1wb3J0IHsgY2xpQXJnc1BpcGUgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGluc2VydEFmdGVyQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGluY2x1ZGVzQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuZXhwb3J0IHR5cGUgVGFza1R5cGVzID1cbiAgfCAnbGludCdcbiAgfCAnYnVpbGQnXG4gIHwgJ3Rlc3QnXG4gIHwgJ2RlY2xhcmF0aW9ucydcbiAgfCAnaW50ZWdyYXRpb24nXG4gIHwgJ3NldHVwOmludGVncmF0aW9uJ1xuICB8IChzdHJpbmcgJiB7XG4gICAgICBfYWxsb3dTdHJpbmdzPzogdW5kZWZpbmVkO1xuICAgIH0pO1xuXG5leHBvcnQgY29uc3QgdHVyYm9CaW5QYXRoID0gKCkgPT5cbiAgYmluUGF0aCh7XG4gICAgYmluTmFtZTogJ3R1cmJvJyxcbiAgICBiaW5TY3JpcHRQYXRoOiAndHVyYm8vYmluL3R1cmJvJyxcbiAgfSk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYXNUdXJib0pzb24oKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICByZXR1cm4gYXdhaXQgc3RhdChqb2luKGN3ZCwgJ3R1cmJvLmpzb24nKSlcbiAgICAudGhlbigocmVzKSA9PiByZXMuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhc3NUdXJib0ZvcmNlRW52KGFyZ3M6IHN0cmluZ1tdKSB7XG4gIHJldHVybiBpbmNsdWRlc0FueU9mKGFyZ3MsIFsncnVuJ10pICYmIGluY2x1ZGVzQW55T2YoYXJncywgWyctLWZvcmNlJ10pXG4gICAgPyB7XG4gICAgICAgIFRVUkJPX0ZPUkNFOiAnMScsXG4gICAgICB9XG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbmhlcml0VHVyYm9Gb3JjZUFyZ0Zyb21FbnYoKSB7XG4gIHJldHVybiAoc3RhdGU6IENsaUFyZ3MpID0+ICh7XG4gICAgLi4uc3RhdGUsXG4gICAgaW5wdXRBcmdzOlxuICAgICAgaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsncnVuJ10pICYmXG4gICAgICAhaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsnLS1mb3JjZSddKSAmJlxuICAgICAgcHJvY2Vzcy5lbnZbJ1RVUkJPX0ZPUkNFJ11cbiAgICAgICAgPyBpbnNlcnRBZnRlckFueU9mKHN0YXRlLmlucHV0QXJncywgWyctLWZvcmNlJ10sIFsncnVuJ10pXG4gICAgICAgIDogc3RhdGUuaW5wdXRBcmdzLFxuICB9KTtcbn1cblxuLyoqXG4gKiBSdW4gb25lIG9mIHRoZSBkZXYgcGlwZWxpbmUgdGFza3MgdXNpbmcgVHVyYm8gZm9yIGEgc2luZ2xlIHBhY2thZ2VcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlKG9wdHM6IHtcbiAgdGFza3M6IFtUYXNrVHlwZXMsIC4uLlRhc2tUeXBlc1tdXTtcbiAgcGFja2FnZURpcj86IHN0cmluZztcbiAgc3Bhd25PcHRzOiBPbWl0PFNwYXduT3B0aW9uc1dpdGhFeHRyYTxTcGF3blJlc3VsdE9wdHM+LCAnY3dkJz47XG59KSB7XG4gIGNvbnN0IHJvb3REaXIgPSBvcHRzLnBhY2thZ2VEaXIgPz8gcHJvY2Vzcy5jd2QoKTtcbiAgY29uc3QgY3dkID0gYXdhaXQgcmVwb3NpdG9yeVJvb3RQYXRoKCk7XG4gIHJldHVybiBhd2FpdCBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAgIGF3YWl0IHR1cmJvQmluUGF0aCgpLFxuICAgIGNsaUFyZ3NQaXBlKFxuICAgICAgW2luaGVyaXRUdXJib0ZvcmNlQXJnRnJvbUVudigpXSxcbiAgICAgIFtcbiAgICAgICAgJ3J1bicsXG4gICAgICAgIC4uLm9wdHMudGFza3MsXG4gICAgICAgICctLWZpbHRlcj0nICsgcm9vdERpci5yZXBsYWNlKGN3ZCwgJy4nKSxcbiAgICAgICAgJy0tb3V0cHV0LWxvZ3M9bmV3LW9ubHknLFxuICAgICAgXVxuICAgICksXG4gICAge1xuICAgICAgLi4ub3B0cy5zcGF3bk9wdHMsXG4gICAgICBjd2QsXG4gICAgfVxuICApO1xufVxuIiwiaW1wb3J0IHsgbG9hZCB9IGZyb20gJ2pzLXlhbWwnO1xuaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJy4vb25jZUFzeW5jJztcbmltcG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuY29uc3QgcmVhZFBhY2thZ2VzR2xvYnNBdCA9IGFzeW5jIChtb25vcmVwb1Jvb3Q6IHN0cmluZykgPT4ge1xuICB0cnkge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShcbiAgICAgIGpvaW4obW9ub3JlcG9Sb290LCAncG5wbS13b3Jrc3BhY2UueWFtbCcpLFxuICAgICAgJ3V0Zi04J1xuICAgICk7XG4gICAgY29uc3Qgcm9vdFBhdGggPSBsb2FkKHRleHQpIGFzIHtcbiAgICAgIHBhY2thZ2VzPzogc3RyaW5nW107XG4gICAgfTtcbiAgICByZXR1cm4gcm9vdFBhdGgucGFja2FnZXMgPz8gW107XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci5kZWJ1ZyhlcnIpO1xuICAgIHJldHVybiBbXTtcbiAgfVxufTtcblxuLyoqXG4gKiBEZXRlcm1pbmUgbW9ub3JlcG8gcGFja2FnZXMgZ2xvYiBieSByZWFkaW5nIG9uZSBvZiB0aGUgc3VwcG9ydGVkXG4gKiBmaWxlc1xuICpcbiAqIE5PVEU6IG9ubHkgcG5wbSBpcyBzdXBwb3J0ZWQgYXQgdGhlIG1vbWVudFxuICovXG5leHBvcnQgY29uc3QgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHJvb3QgPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGgoKTtcbiAgY29uc3QgcGFja2FnZXNHbG9icyA9IGF3YWl0IHJlYWRQYWNrYWdlc0dsb2JzQXQocm9vdCk7XG4gIHJldHVybiB7XG4gICAgcm9vdCxcbiAgICBwYWNrYWdlc0dsb2JzLFxuICB9O1xufSk7XG4iLCJpbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBoYXNUdXJib0pzb24gfSBmcm9tICcuLi90dXJibyc7XG5pbXBvcnQgeyByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzIH0gZnJvbSAnLi9yZWFkUGFja2FnZXNHbG9icyc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24oKSB7XG4gIGNvbnN0IFt7IHJvb3QsIHBhY2thZ2VzR2xvYnMgfSwgaGFzVHVyYm9dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMoKSxcbiAgICBoYXNUdXJib0pzb24oKSxcbiAgXSk7XG4gIGlmIChwYWNrYWdlc0dsb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB7XG4gICAgICByb290LFxuICAgICAgcGFja2FnZXNHbG9icyxcbiAgICAgIHBhY2thZ2VMb2NhdGlvbnM6IFtdLFxuICAgICAgaGFzVHVyYm8sXG4gICAgICB0eXBlOiAnc2luZ2xlLXBhY2thZ2UnIGFzIGNvbnN0LFxuICAgIH07XG4gIH1cbiAgY29uc3QgcGFja2FnZUxvY2F0aW9ucyA9IGF3YWl0IGZnKFxuICAgIHBhY2thZ2VzR2xvYnMubWFwKChnbG9iKSA9PiBgJHtnbG9ifS9wYWNrYWdlLmpzb25gKSxcbiAgICB7XG4gICAgICBjd2Q6IHJvb3QsXG4gICAgfVxuICApO1xuICByZXR1cm4ge1xuICAgIHJvb3QsXG4gICAgcGFja2FnZXNHbG9icyxcbiAgICBwYWNrYWdlTG9jYXRpb25zOiBwYWNrYWdlTG9jYXRpb25zLm1hcCgobG9jYXRpb24pID0+IGRpcm5hbWUobG9jYXRpb24pKSxcbiAgICBoYXNUdXJibyxcbiAgICB0eXBlOiAnbXVsdGlwbGUtcGFja2FnZXMnIGFzIGNvbnN0LFxuICB9O1xufVxuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgcmVhZEN3ZFBhY2thZ2VKc29uIH0gZnJvbSAnLi4vcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbic7XG5pbXBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3JlcG9zaXRvcnlSb290UGF0aCc7XG5cbmV4cG9ydCB7IHJlYWRQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuZXhwb3J0IHsgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uIH0gZnJvbSAnLi9sb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24nO1xuZXhwb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiB0ZXN0UGF0aChvcHRzOiB7XG4gIHJvb3Q6IHN0cmluZztcbiAgd3JhcHBlclBhY2thZ2VOYW1lOiBzdHJpbmc7XG4gIGxvb2t1cFBhY2thZ2VOYW1lOiBzdHJpbmc7XG59KSB7XG4gIGNvbnN0IHBhdGggPSBqb2luKFxuICAgIG9wdHMucm9vdCxcbiAgICBgbm9kZV9tb2R1bGVzLyR7b3B0cy53cmFwcGVyUGFja2FnZU5hbWV9L25vZGVfbW9kdWxlcy8ke29wdHMubG9va3VwUGFja2FnZU5hbWV9YFxuICApO1xuICByZXR1cm4gc3RhdChwYXRoKVxuICAgIC50aGVuKChyZXN1bHQpID0+IChyZXN1bHQuaXNEaXJlY3RvcnkoKSA/IHBhdGggOiB1bmRlZmluZWQpKVxuICAgIC5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xufVxuXG5hc3luYyBmdW5jdGlvbiB0ZXN0TG9jYWxBbmRSb290KHtcbiAgd3JhcHBlclBhY2thZ2VOYW1lLFxuICBsb29rdXBQYWNrYWdlTmFtZSxcbiAgcmVwb1Jvb3RQYXRoUHJvbWlzZSxcbn06IHtcbiAgcmVwb1Jvb3RQYXRoUHJvbWlzZTogUHJvbWlzZTxzdHJpbmc+O1xuICB3cmFwcGVyUGFja2FnZU5hbWU6IHN0cmluZztcbiAgbG9va3VwUGFja2FnZU5hbWU6IHN0cmluZztcbn0pIHtcbiAgY29uc3QgbG9jYWxQcm9taXNlID0gdGVzdFBhdGgoe1xuICAgIHJvb3Q6IHByb2Nlc3MuY3dkKCksXG4gICAgd3JhcHBlclBhY2thZ2VOYW1lLFxuICAgIGxvb2t1cFBhY2thZ2VOYW1lLFxuICB9KTtcbiAgY29uc3QgcmVwb1Jvb3RQYXRoID0gYXdhaXQgcmVwb1Jvb3RQYXRoUHJvbWlzZTtcbiAgaWYgKHJlcG9Sb290UGF0aCA9PT0gcHJvY2Vzcy5jd2QoKSkge1xuICAgIGNvbnN0IGxvY2FsID0gYXdhaXQgbG9jYWxQcm9taXNlO1xuICAgIGlmIChsb2NhbCkge1xuICAgICAgcmV0dXJuIGxvY2FsO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyB0ZXN0IG1vbm9yZXBvIHJvb3QgYXMgd2VsbDpcbiAgICBjb25zdCByb290UHJvbWlzZSA9IHRlc3RQYXRoKHtcbiAgICAgIHJvb3Q6IHJlcG9Sb290UGF0aCxcbiAgICAgIHdyYXBwZXJQYWNrYWdlTmFtZSxcbiAgICAgIGxvb2t1cFBhY2thZ2VOYW1lLFxuICAgIH0pO1xuICAgIGNvbnN0IGxvY2FsID0gYXdhaXQgbG9jYWxQcm9taXNlO1xuICAgIGlmIChsb2NhbCkge1xuICAgICAgcmV0dXJuIGxvY2FsO1xuICAgIH1cbiAgICBjb25zdCByb290ID0gYXdhaXQgcm9vdFByb21pc2U7XG4gICAgaWYgKHJvb3QpIHtcbiAgICAgIHJldHVybiByb290O1xuICAgIH1cbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBwYWNrYWdlTmFtZShba2V5LCB2YWx1ZV06IFtzdHJpbmcsIHN0cmluZ10pIHtcbiAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgoJ3dvcmtzcGFjZTonKSkge1xuICAgIC8vIHdvcmtzcGFjZTpwYWNrYWdlQHNlbS52ZXIueFxuICAgIGNvbnN0IHJlc3VsdCA9IC93b3Jrc3BhY2U6KC4qKUAoLiopLy5leGVjKHZhbHVlKTtcbiAgICBpZiAocmVzdWx0KSB7XG4gICAgICBjb25zdCBbLCBwYWNrYWdlTmFtZV0gPSByZXN1bHQ7XG4gICAgICBpZiAocGFja2FnZU5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHBhY2thZ2VOYW1lO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBpZiAodmFsdWUuc3RhcnRzV2l0aCgnbnBtOicpKSB7XG4gICAgLy8gbnBtOnBhY2thZ2VAc2VtLnZlci54XG4gICAgY29uc3QgcmVzdWx0ID0gL25wbTooLiopQCguKikvLmV4ZWModmFsdWUpO1xuICAgIGlmIChyZXN1bHQpIHtcbiAgICAgIGNvbnN0IFssIHBhY2thZ2VOYW1lXSA9IHJlc3VsdDtcbiAgICAgIGlmIChwYWNrYWdlTmFtZSkge1xuICAgICAgICByZXR1cm4gcGFja2FnZU5hbWU7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBrZXk7XG59XG5cbi8qKlxuICogTG9va3VwIGxvY2F0aW9uIGZvciBkZXZEZXBlbmRlbmNpZXMgb2YgXCJAcmVwa2Eta2l0L3RzXCIgLSB0aGlzIGZ1bmN0aW9uIHdpbGxcbiAqIGxvb2t1cCBmb3IgXCJvcHRzLmxvb2t1cFBhY2thZ2VOYW1lXCIsIGl0IGZhdm91cnMgdGhlIGxvY2FsIC4vbm9kZV9tb2R1bGVzLyBwYXRoXG4gKiBhbmQgZmFsbHMgYmFjayB0byB0aGUgbW9ub3JlcG8gcm9vdC5cbiAqXG4gKiBUaGlzIHdpbGwgYWxzbyB0cnkgdG8gbG9va3VwIGFsaWFzIG9mIHRoZSBcIkByZXBrYS1raXQvdHNcIiBwYWNrYWdlIGFuZCBpZiB0aGF0IGlzIGRlZmluZWRcbiAqIHdpbGwgdHJ5IHRvIGZpbmQgdGhlIGRlcGVuZGVuY2llcyBpbiB0aGUgZGVwZW5kZW5jaWVzIG9mIHRoZSBhbGlhc2VkIHBhY2thZ2UuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmaW5kRGV2RGVwZW5kZW5jeShvcHRzOiB7XG4gIHdyYXBwZXJQYWNrYWdlTmFtZT86IHN0cmluZztcbiAgbG9va3VwUGFja2FnZU5hbWU6IHN0cmluZztcbn0pIHtcbiAgY29uc3Qgd3JhcHBlclBhY2thZ2VOYW1lID0gb3B0cy53cmFwcGVyUGFja2FnZU5hbWUgPz8gJ0ByZXBrYS1raXQvdHMnO1xuICBjb25zdCBsb29rdXBQYWNrYWdlTmFtZSA9IG9wdHMubG9va3VwUGFja2FnZU5hbWU7XG4gIC8vIHN0YXJ0IGxvb2tpbmcgdXAgdGhlIHJlcG9zaXRvcnkgcm9vdCB0byBjaGVjayBtb25vcmVwbyBzY2VuYXJpb3M6XG4gIGNvbnN0IHJlcG9Sb290UGF0aFByb21pc2UgPSByZXBvc2l0b3J5Um9vdFBhdGgoKTtcblxuICBjb25zdCBkZWZhdWx0UmVzdWx0ID0gYXdhaXQgdGVzdFBhdGgoe1xuICAgIHJvb3Q6IHByb2Nlc3MuY3dkKCksXG4gICAgbG9va3VwUGFja2FnZU5hbWUsXG4gICAgd3JhcHBlclBhY2thZ2VOYW1lLFxuICB9KTtcbiAgaWYgKGRlZmF1bHRSZXN1bHQpIHtcbiAgICByZXR1cm4gZGVmYXVsdFJlc3VsdDtcbiAgfVxuXG4gIC8vIGxvb2t1cCBmb3IgYWx0ZXJuYXRpdmUgbmFtZSBvZiBAcmVwa2Eta2l0L3RzXG4gIGNvbnN0IHdyYXBwZXJBbGlhc05hbWUgPSBhd2FpdCByZWFkQ3dkUGFja2FnZUpzb24oKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgIGNvbnN0IGRlcGVuZGVuY3kgPSBPYmplY3QuZW50cmllcyhyZXN1bHQuZGV2RGVwZW5kZW5jaWVzIHx8IHt9KS5maW5kKFxuICAgICAgICAoZGVwZW5kZW5jeSkgPT4gcGFja2FnZU5hbWUoZGVwZW5kZW5jeSkgPT09IHdyYXBwZXJQYWNrYWdlTmFtZVxuICAgICAgKTtcbiAgICAgIHJldHVybiBkZXBlbmRlbmN5ID8gZGVwZW5kZW5jeVswXSA6IHVuZGVmaW5lZDtcbiAgICB9KVxuICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICBsb2dnZXIud2FybignQ2Fubm90IHJlYWQgcGFja2FnZSBqc29uJywgZXJyKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfSk7XG5cbiAgaWYgKCF3cmFwcGVyQWxpYXNOYW1lKSB7XG4gICAgLy8gdGhlIG9ubHkgYWx0ZXJuYXRpdmUgbm93IGlzIHRoZSByZXBvc2l0b3J5IHJvb3RcbiAgICBjb25zdCByZXBvUm9vdFBhdGggPSBhd2FpdCByZXBvUm9vdFBhdGhQcm9taXNlO1xuICAgIGlmIChyZXBvUm9vdFBhdGggIT09IHByb2Nlc3MuY3dkKCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0ZXN0UGF0aCh7XG4gICAgICAgIHJvb3Q6IHJlcG9Sb290UGF0aCxcbiAgICAgICAgbG9va3VwUGFja2FnZU5hbWUsXG4gICAgICAgIHdyYXBwZXJQYWNrYWdlTmFtZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgY29uc3QgYWxpYXNSZXN1bHQgPSBhd2FpdCB0ZXN0TG9jYWxBbmRSb290KHtcbiAgICByZXBvUm9vdFBhdGhQcm9taXNlLFxuICAgIGxvb2t1cFBhY2thZ2VOYW1lLFxuICAgIHdyYXBwZXJQYWNrYWdlTmFtZTogd3JhcHBlckFsaWFzTmFtZSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFsaWFzUmVzdWx0O1xufVxuIiwiaW1wb3J0IHR5cGUgeyBDb25maWcgfSBmcm9tICdAamVzdC90eXBlcyc7XG5pbXBvcnQgeyBzdGF0IH0gZnJvbSAnZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgeyBzcGF3bk91dHB1dENvbmRpdGlvbmFsIH0gZnJvbSAnLi4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IHJlYWRQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuaW1wb3J0IHsgcnVuVHVyYm9UYXNrc0ZvclNpbmdsZVBhY2thZ2UgfSBmcm9tICcuLi90dXJibyc7XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRTdGFuZGFyZEdsb2JhbEhvb2soXG4gIHNjcmlwdDogc3RyaW5nLFxuICBnbG9iYWxDb25maWc6IENvbmZpZy5HbG9iYWxDb25maWcsXG4gIHByb2plY3RDb25maWc6IENvbmZpZy5Qcm9qZWN0Q29uZmlnXG4pIHtcbiAgY29uc3QgaGFzSG9vayA9IGF3YWl0IHN0YXQoc2NyaXB0KVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuICByZXR1cm4ge1xuICAgIGhhc0hvb2ssXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFoYXNIb29rKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxvY2F0aW9uID0gam9pbihwcm9jZXNzLmN3ZCgpLCBzY3JpcHQpO1xuICAgICAgY29uc3QgcmVzdWx0ID0gKGF3YWl0IGltcG9ydChsb2NhdGlvbikpIGFzXG4gICAgICAgIHwge1xuICAgICAgICAgICAgZGVmYXVsdD86IChcbiAgICAgICAgICAgICAgZ2xvYmFsQ29uZmlnOiBDb25maWcuR2xvYmFsQ29uZmlnLFxuICAgICAgICAgICAgICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZ1xuICAgICAgICAgICAgKSA9PiBQcm9taXNlPHZvaWQ+O1xuICAgICAgICAgIH1cbiAgICAgICAgfCB1bmRlZmluZWQ7XG4gICAgICBpZiAoIXJlc3VsdCB8fCAhcmVzdWx0LmRlZmF1bHQpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oYOKaoO+4jyBObyBkZWZhdWx0IGV4cG9ydCBmb3VuZCBpbiBcIiR7c2NyaXB0fVwiYCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGF3YWl0IFByb21pc2UucmVzb2x2ZShyZXN1bHQuZGVmYXVsdChnbG9iYWxDb25maWcsIHByb2plY3RDb25maWcpKTtcbiAgICB9LFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBsb2FkQ3VzdG9tR2xvYmFsSG9vayhzY3JpcHQ6IHN0cmluZykge1xuICBjb25zdCBoYXNIb29rID0gYXdhaXQgc3RhdChzY3JpcHQpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gcmVzdWx0LmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG4gIHJldHVybiB7XG4gICAgaGFzSG9vayxcbiAgICBleGVjdXRlOiBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIWhhc0hvb2spIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgbG9jYXRpb24gPSBqb2luKHByb2Nlc3MuY3dkKCksIHNjcmlwdCk7XG4gICAgICBjb25zdCBwYWNrYWdlSnNvbiA9IGF3YWl0IHJlYWRQYWNrYWdlSnNvbihcbiAgICAgICAgam9pbihwcm9jZXNzLmN3ZCgpLCAncGFja2FnZS5qc29uJylcbiAgICAgICk7XG5cbiAgICAgIGlmIChcbiAgICAgICAgc2NyaXB0LmVuZHNXaXRoKCdzZXR1cC50cycpICYmXG4gICAgICAgIHR5cGVvZiBwYWNrYWdlSnNvblsnc2NyaXB0cyddID09PSAnb2JqZWN0JyAmJlxuICAgICAgICBwYWNrYWdlSnNvblsnc2NyaXB0cyddWydzZXR1cDppbnRlZ3JhdGlvbiddID09PSBgdHN4ICR7c2NyaXB0fWBcbiAgICAgICkge1xuICAgICAgICBhd2FpdCBydW5UdXJib1Rhc2tzRm9yU2luZ2xlUGFja2FnZSh7XG4gICAgICAgICAgdGFza3M6IFsnc2V0dXA6aW50ZWdyYXRpb24nXSxcbiAgICAgICAgICBzcGF3bk9wdHM6IHtcbiAgICAgICAgICAgIGV4aXRDb2RlczogWzBdLFxuICAgICAgICAgICAgZW52OiB7XG4gICAgICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgICAgICBMT0dfTEVWRUw6IGxvZ2dlci5sb2dMZXZlbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBzcGF3bk91dHB1dENvbmRpdGlvbmFsKCd0c3gnLCBbbG9jYXRpb25dLCB7XG4gICAgICAgICAgZXhpdENvZGVzOiBbMF0sXG4gICAgICAgICAgZW52OiB7XG4gICAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICAgIExPR19MRVZFTDogbG9nZ2VyLmxvZ0xldmVsLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkQW5kUnVuR2xvYmFsSG9vayhcbiAgc2NyaXB0OiBzdHJpbmcsXG4gIGdsb2JhbENvbmZpZzogQ29uZmlnLkdsb2JhbENvbmZpZyxcbiAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWcsXG4gIHRpcD86IHN0cmluZ1xuKSB7XG4gIGNvbnN0IFtzdGFuZGFyZCwgY3VzdG9tXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICBsb2FkU3RhbmRhcmRHbG9iYWxIb29rKGAke3NjcmlwdH0ubWpzYCwgZ2xvYmFsQ29uZmlnLCBwcm9qZWN0Q29uZmlnKSxcbiAgICBsb2FkQ3VzdG9tR2xvYmFsSG9vayhgJHtzY3JpcHR9LnRzYCksXG4gIF0pO1xuICBpZiAoIWN1c3RvbS5oYXNIb29rICYmIHRpcCkge1xuICAgIGxvZ2dlci50aXAodGlwKTtcbiAgfVxuICBhd2FpdCBzdGFuZGFyZC5leGVjdXRlKCk7XG4gIGF3YWl0IGN1c3RvbS5leGVjdXRlKCk7XG59XG4iLCJpbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBmaW5kRGV2RGVwZW5kZW5jeSB9IGZyb20gJy4uL3V0aWxzL2ZpbmREZXZEZXBlbmRlbmN5JztcbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJy4uL3V0aWxzL29uY2VBc3luYyc7XG5cbmV4cG9ydCB7IHJlYWRQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuZXhwb3J0IHsgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uIH0gZnJvbSAnLi4vdXRpbHMvbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uJztcbmV4cG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4uL3V0aWxzL3JlcG9zaXRvcnlSb290UGF0aCc7XG5leHBvcnQgeyBsb2FkQW5kUnVuR2xvYmFsSG9vayB9IGZyb20gJy4vbG9hZEFuZFJ1bkdsb2JhbEhvb2snO1xuXG5leHBvcnQgY29uc3QgamVzdFBsdWdpblJvb3QgPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBmaW5kRGV2RGVwZW5kZW5jeSh7XG4gICAgbG9va3VwUGFja2FnZU5hbWU6ICdlc2J1aWxkLWplc3QnLFxuICB9KTtcbiAgaWYgKCFyZXN1bHQpIHtcbiAgICBsb2dnZXIud2FybihcbiAgICAgICdKZXN0IHBsdWdpbnMgcm9vdCBjYW5ub3QgYmUgZGV0ZXJtaW5lZC4gRG8geW91IGhhdmUgXCJAcmVwa2Eta2l0L3RzXCIgaW4gZGV2RGVwZW5kZW5jaWVzIGF0IHRoZSBtb25vcmVwbyByb290IG9yIGF0IHRoZSBsb2NhbCBwYWNrYWdlPydcbiAgICApO1xuICB9IGVsc2Uge1xuICAgIGlmIChsb2dnZXIubG9nTGV2ZWwgPT09ICdkZWJ1ZycpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnRm91bmQgamVzdCBwbHVnaW5zIHJvb3QgYXQnLCBkaXJuYW1lKHJlc3VsdCkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0ID8gZGlybmFtZShyZXN1bHQpIDogJy4nO1xufSk7XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQU8sU0FBQSxJQUFBLENBQWlCLEVBQXNCLEVBQUE7QUFDNUMsRUFBSSxJQUFBLEtBQUEsQ0FBQTtBQUNKLEVBQUEsSUFBSSxVQUFhLEdBQUEsS0FBQSxDQUFBO0FBQ2pCLEVBQUEsT0FBTyxNQUFTO0FBQ2QsSUFBQSxJQUFJLFVBQVksRUFBQTtBQUNkLE1BQU8sT0FBQSxLQUFBLENB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
