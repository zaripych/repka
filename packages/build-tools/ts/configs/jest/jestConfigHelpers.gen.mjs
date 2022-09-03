// This file is bundled up from './src/*' and needs to be committed
import { dirname, join } from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import assert from 'node:assert';
import { ChildProcess, spawn } from 'node:child_process';
import { load } from 'js-yaml';

function isTruthy(value) {
  return Boolean(value);
}

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

async function isDirectory(path) {
  return stat(path).then((result) => result.isDirectory()).catch(() => void 0);
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

async function* upwardDirectoryWalk(opts) {
  var _a;
  let current = opts.start;
  while (current !== "/" && current !== "~/" && !(((_a = opts.stops) == null ? void 0 : _a.includes(current)) ?? false)) {
    const path = opts.appendPath ? join(current, opts.appendPath) : current;
    const candidate = await opts.test(path);
    if (candidate) {
      yield typeof candidate === "string" ? candidate : path;
    }
    current = dirname(current);
  }
}
async function upwardDirectorySearch(opts) {
  const walk = upwardDirectoryWalk(opts);
  for await (const dir of walk) {
    return dir;
  }
  return void 0;
}

const cwdPackageJsonPath = () => join(process.cwd(), "./package.json");
async function readPackageJsonAt(path) {
  return await readFile(path, "utf-8").then((result) => JSON.parse(result));
}
const readCwdPackageJson = onceAsync(() => readPackageJsonAt(cwdPackageJsonPath()));
async function readPackageJson(path) {
  return process.cwd() === cwdPackageJsonPath() ? await readCwdPackageJson() : await readPackageJsonAt(path);
}

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
  var _a, _b, _c;
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const combinedData = ((_a = opts.buffers) == null ? void 0 : _a.combined) ?? [];
  const stdoutData = ((_b = opts.buffers) == null ? void 0 : _b.stdout) ?? [];
  const stderrData = ((_c = opts.buffers) == null ? void 0 : _c.stderr) ?? [];
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
  for await (const entry of markersStream) {
    assert(typeof entry === "string");
    return dirname(entry);
  }
  return void 0;
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

async function tryReadingPnpmWorkspaceYaml(monorepoRoot) {
  const text = await readFile(join(monorepoRoot, "pnpm-workspace.yaml"), "utf-8");
  const rootPath = load(text);
  return Array.isArray(rootPath.packages) && rootPath.packages.length > 0 ? rootPath.packages : void 0;
}
async function tryReadingPackageJsonWorkspaces(monorepoRoot) {
  const text = await readFile(join(monorepoRoot, "package.json"), "utf-8");
  const packageJson = JSON.parse(text);
  return Array.isArray(packageJson.workspaces) && packageJson.workspaces.length > 0 ? packageJson.workspaces : void 0;
}
const readPackagesGlobsAt = async (monorepoRoot) => {
  const [pnpmWorkspaces, packageJsonWorkspaces] = await Promise.all([
    tryReadingPnpmWorkspaceYaml(monorepoRoot).catch(() => void 0),
    tryReadingPackageJsonWorkspaces(monorepoRoot).catch(() => void 0)
  ]);
  return pnpmWorkspaces || packageJsonWorkspaces || [];
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

async function lookup(opts) {
  return await upwardDirectorySearch({
    start: moduleRootDirectory(),
    appendPath: join("node_modules", opts.lookupPackageName),
    test: isDirectory
  });
}
async function findDevDependency(opts) {
  const lookupPackageName = opts.lookupPackageName;
  return await lookup({
    path: moduleRootDirectory(),
    lookupPackageName
  });
}

async function loadStandardGlobalHook(script, globalConfig, projectConfig) {
  const location = join(projectConfig.rootDir, script);
  const hasHook = await stat(location).then((result) => result.isFile()).catch(() => false);
  return {
    hasHook,
    execute: async () => {
      if (!hasHook) {
        return;
      }
      const result = await import(location);
      if (!result || !result.default) {
        logger.warn(`\u26A0\uFE0F No default export found in "${script}"`);
        return;
      }
      await Promise.resolve(result.default(globalConfig, projectConfig));
    }
  };
}
async function loadCustomGlobalHook(script, projectConfig) {
  const location = join(projectConfig.rootDir, script);
  const hasHook = await stat(location).then((result) => result.isFile()).catch(() => false);
  return {
    hasHook,
    execute: async () => {
      if (!hasHook) {
        return;
      }
      const packageJson = await readPackageJson(join(process.cwd(), "package.json"));
      if (location.endsWith("setup.ts") && typeof packageJson["scripts"] === "object" && packageJson["scripts"]["setup:integration"] === `tsx ${script}`) {
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
    loadCustomGlobalHook(`${script}.ts`, projectConfig)
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL2lzVHJ1dGh5LnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL29uY2UudHMiLCIuLi8uLi8uLi8uLi91dGlscy90cy9zcmMvb25jZUFzeW5jLnRzIiwiLi4vLi4vc3JjL2xvZ2dlci9sb2dnZXIudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNEaXJlY3RvcnkudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeS50cyIsIi4uLy4uL3NyYy91dGlscy91cHdhcmREaXJlY3RvcnlTZWFyY2gudHMiLCIuLi8uLi9zcmMvcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbi50cyIsIi4uLy4uL3NyYy91dGlscy9zdGFja1RyYWNlLnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25Ub1Byb21pc2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdC50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduT3V0cHV0LnRzIiwiLi4vLi4vc3JjL3V0aWxzL2JpblBhdGgudHMiLCIuLi8uLi9zcmMvdXRpbHMvY2xpQXJnc1BpcGUudHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoLnRzIiwiLi4vLi4vc3JjL3R1cmJvLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy91dGlscy9maW5kRGV2RGVwZW5kZW5jeS50cyIsIi4uLy4uL3NyYy9qZXN0L2xvYWRBbmRSdW5HbG9iYWxIb29rLnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdENvbmZpZ0hlbHBlcnMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIGlzVHJ1dGh5PFQ+KFxuICB2YWx1ZTogTm9uTnVsbGFibGU8VD4gfCBmYWxzZSB8IG51bGwgfCB1bmRlZmluZWQgfCAnJyB8IDBcbik6IHZhbHVlIGlzIE5vbk51bGxhYmxlPFQ+IHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUpO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIG9uY2U8VD4oZm46ICgpID0+IFQpOiAoKSA9PiBUIHtcbiAgbGV0IHZhbHVlOiBUO1xuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xuICByZXR1cm4gKCk6IFQgPT4ge1xuICAgIGlmIChjYWxjdWxhdGVkKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHZhbHVlID0gZm4oKTtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZUFzeW5jPFQ+KGZuOiAoKSA9PiBUIHwgUHJvbWlzZTxUPik6ICgpID0+IFByb21pc2U8VD4ge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBpbkZsaWdodDogUHJvbWlzZTxUPiB8IG51bGw7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiBhc3luYyAoKTogUHJvbWlzZTxUPiA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKGluRmxpZ2h0KSB7XG4gICAgICByZXR1cm4gaW5GbGlnaHQ7XG4gICAgfVxuICAgIGluRmxpZ2h0ID0gUHJvbWlzZS5yZXNvbHZlKGZuKCkpO1xuICAgIHZhbHVlID0gYXdhaXQgaW5GbGlnaHQ7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgaW5GbGlnaHQgPSBudWxsO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImltcG9ydCB7IG9uY2UgfSBmcm9tICdAdXRpbHMvdHMnO1xuXG5jb25zdCBsZXZlbHMgPSBbJ2RlYnVnJywgJ2luZm8nLCAnd2FybicsICdlcnJvcicsICdmYXRhbCddIGFzIGNvbnN0O1xuXG50eXBlIExvZ0xldmVsID0gdHlwZW9mIGxldmVsc1tudW1iZXJdO1xuXG50eXBlIFBhcmFtcyA9IFBhcmFtZXRlcnM8dHlwZW9mIGNvbnNvbGUubG9nPjtcblxudHlwZSBMb2dnZXIgPSB7XG4gIGxvZ0xldmVsOiBMb2dMZXZlbDtcbiAgZGVidWcoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgLy8gYWxpYXMgZm9yIGluZm9cbiAgbG9nKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgLy8gc3BlY2lhbCB0cmVhdG1lbnQsIGRpc2FibGVkIG9uIENJL1RUWVxuICB0aXAoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgZXJyb3IoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBmYXRhbCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG59O1xuXG5jb25zdCBlbmFibGVkTGV2ZWxzQWZ0ZXIgPSAobGV2ZWw6IExvZ0xldmVsIHwgJ29mZicpID0+IHtcbiAgaWYgKGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuICBjb25zdCBpbmRleCA9IGxldmVscy5maW5kSW5kZXgoKGl0ZW0pID0+IGl0ZW0gPT09IGxldmVsKTtcbiAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBsZXZlbCcpO1xuICB9XG4gIHJldHVybiBsZXZlbHMuc2xpY2UoaW5kZXgpO1xufTtcblxuY29uc3QgaXNMZXZlbCA9IChsZXZlbD86IHN0cmluZyk6IGxldmVsIGlzIExvZ0xldmVsID0+IHtcbiAgcmV0dXJuIGxldmVscy5pbmNsdWRlcyhsZXZlbCBhcyBMb2dMZXZlbCk7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlGcm9tUHJvY2Vzc0FyZ3MgPSAoXG4gIGFyZ3MgPSBwcm9jZXNzLmFyZ3Zcbik6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xuICBjb25zdCBpbmRleCA9IGFyZ3MuZmluZEluZGV4KCh2YWx1ZSkgPT4gdmFsdWUgPT09ICctLWxvZy1sZXZlbCcpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBjb25zdCBsZXZlbCA9IGFyZ3NbaW5kZXggKyAxXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgdmVyYm9zaXR5RnJvbUVudiA9ICgpOiBMb2dMZXZlbCB8ICdvZmYnIHwgdW5kZWZpbmVkID0+IHtcbiAgY29uc3QgbGV2ZWwgPSBwcm9jZXNzLmVudlsnTE9HX0xFVkVMJ107XG4gIGlmIChsZXZlbCA9PT0gJ3NpbGVudCcgfHwgbGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuICdvZmYnO1xuICB9XG4gIGlmICghaXNMZXZlbChsZXZlbCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBsZXZlbDtcbn07XG5cbmNvbnN0IGdldFZlcmJvc2l0eUNvbmZpZyA9ICgpID0+IHtcbiAgY29uc3QgYXJnc0xldmVsID0gdmVyYm9zaXR5RnJvbVByb2Nlc3NBcmdzKCk7XG4gIGNvbnN0IGVudkxldmVsID0gdmVyYm9zaXR5RnJvbUVudigpO1xuICByZXR1cm4gYXJnc0xldmVsID8/IGVudkxldmVsID8/ICdpbmZvJztcbn07XG5cbmNvbnN0IG5vb3AgPSAoLi4uX2FyZ3M6IFBhcmFtcykgPT4ge1xuICByZXR1cm47XG59O1xuXG5jb25zdCBsb2cgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XG4gIGNvbnNvbGUubG9nKC4uLmFyZ3MpO1xufTtcblxuY29uc3QgZXJyb3IgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XG4gIGNvbnNvbGUuZXJyb3IoLi4uYXJncyk7XG59O1xuXG5jb25zdCBzaG91bGRFbmFibGVUaXAgPSAoKSA9PiAhcHJvY2Vzcy5lbnZbJ0NJJ10gJiYgIXByb2Nlc3Muc3Rkb3V0LmlzVFRZO1xuXG5leHBvcnQgY29uc3QgY3JlYXRlTG9nZ2VyID0gKFxuICBkZXBzID0geyBnZXRWZXJib3NpdHlDb25maWcsIGxvZywgZXJyb3IsIHNob3VsZEVuYWJsZVRpcCB9XG4pID0+IHtcbiAgY29uc3QgbG9nTGV2ZWwgPSBkZXBzLmdldFZlcmJvc2l0eUNvbmZpZygpO1xuICBjb25zdCBlbmFibGVkID0gZW5hYmxlZExldmVsc0FmdGVyKGxvZ0xldmVsKTtcbiAgcmV0dXJuIGxldmVscy5yZWR1Y2UoXG4gICAgKGFjYywgbHZsKSA9PiB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5hY2MsXG4gICAgICAgIFtsdmxdOiBlbmFibGVkLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICA/IFsnZmF0YWwnLCAnZXJyb3InXS5pbmNsdWRlcyhsdmwpXG4gICAgICAgICAgICA/IGRlcHMuZXJyb3JcbiAgICAgICAgICAgIDogZGVwcy5sb2dcbiAgICAgICAgICA6IG5vb3AsXG4gICAgICB9O1xuICAgIH0sXG4gICAge1xuICAgICAgbG9nTGV2ZWwsXG4gICAgICBsb2c6IGVuYWJsZWQuaW5jbHVkZXMoJ2luZm8nKSA/IGRlcHMubG9nIDogbm9vcCxcbiAgICAgIHRpcDogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpICYmIGRlcHMuc2hvdWxkRW5hYmxlVGlwKCkgPyBkZXBzLmxvZyA6IG5vb3AsXG4gICAgfSBhcyBMb2dnZXJcbiAgKTtcbn07XG5cbmNvbnN0IGNyZWF0ZURlbGVnYXRpbmdMb2dnZXIgPSAob3B0czogeyBwYXJlbnQ6IExvZ2dlciB9KTogTG9nZ2VyID0+XG4gIE9iamVjdC5mcmVlemUoe1xuICAgIGdldCBsb2dMZXZlbCgpIHtcbiAgICAgIHJldHVybiBvcHRzLnBhcmVudC5sb2dMZXZlbDtcbiAgICB9LFxuICAgIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5kZWJ1ZyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgaW5mbyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuaW5mbyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgbG9nKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5sb2coLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQudGlwKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC53YXJuKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuZXJyb3IoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5mYXRhbCguLi5wYXJhbXMpO1xuICAgIH0sXG4gIH0pO1xuXG5sZXQgZGVmYXVsdExvZ2dlckZhY3Rvcnk6ICgoKSA9PiBMb2dnZXIpIHwgbnVsbDtcblxuZXhwb3J0IGNvbnN0IGNvbmZpZ3VyZURlZmF1bHRMb2dnZXIgPSAoZmFjdG9yeTogKCkgPT4gTG9nZ2VyKSA9PiB7XG4gIGlmIChkZWZhdWx0TG9nZ2VyRmFjdG9yeSkge1xuICAgIGNvbnN0IGVycm9yID0ge1xuICAgICAgc3RhY2s6ICcnLFxuICAgIH07XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UoZXJyb3IpO1xuICAgIGxvZ2dlci5kZWJ1ZygnQ2Fubm90IG92ZXJyaWRlIGRlZmF1bHQgbG9nZ2VyIG11bHRpcGxlIHRpbWVzJywgZXJyb3Iuc3RhY2spO1xuICAgIHJldHVybjtcbiAgfVxuICBkZWZhdWx0TG9nZ2VyRmFjdG9yeSA9IGZhY3Rvcnk7XG59O1xuXG5jb25zdCBkZWZhdWx0TG9nZ2VyID0gb25jZSgoKSA9PiB7XG4gIGxldCBmYWN0b3J5ID0gZGVmYXVsdExvZ2dlckZhY3Rvcnk7XG4gIGlmICghZmFjdG9yeSkge1xuICAgIGZhY3RvcnkgPSAoKSA9PiBjcmVhdGVMb2dnZXIoKTtcbiAgfVxuICByZXR1cm4gZmFjdG9yeSgpO1xufSk7XG5cbi8qKlxuICogRGVmYXVsdCBsb2dnZXIgaW5zdGFuY2UgY2FuIGJlIGNvbmZpZ3VyZWQgb25jZSBhdCBzdGFydHVwXG4gKi9cbmV4cG9ydCBjb25zdCBsb2dnZXI6IExvZ2dlciA9IGNyZWF0ZURlbGVnYXRpbmdMb2dnZXIoe1xuICBnZXQgcGFyZW50KCkge1xuICAgIHJldHVybiBkZWZhdWx0TG9nZ2VyKCk7XG4gIH0sXG59KTtcbiIsImltcG9ydCB7IHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGlzRGlyZWN0b3J5KHBhdGg6IHN0cmluZykge1xuICByZXR1cm4gc3RhdChwYXRoKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0RpcmVjdG9yeSgpKVxuICAgIC5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xufVxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmV4cG9ydCBjb25zdCBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCA9IChvcHRzOiB7XG4gIGltcG9ydE1ldGFVcmw6IHN0cmluZztcbn0pID0+IHtcbiAgLy8gdGhpcyBpcyBoaWdobHkgZGVwZW5kZW50IG9uIHRoZSBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZVxuICAvLyBhbmQgdGhlIGNvbnRleHQgaW4gd2hpY2ggdGhpcyBmdW5jdGlvbiBpcyBydW4gKGJ1bmRsZWQgY29kZSB2cyB0c3ggLi9zcmMvdHNmaWxlLnRzKVxuICBjb25zdCBfX2ZpbGVOYW1lID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICBjb25zdCBwYXJlbnQgPSBkaXJuYW1lKF9fZmlsZU5hbWUpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IGRpcm5hbWUocGFyZW50KTtcblxuICBjb25zdCBpc0J1bmRsZWRJbkRpc3QgPSAoKSA9PiBwYXJlbnQuZW5kc1dpdGgoJy9kaXN0Jyk7XG4gIGNvbnN0IGlzQnVuZGxlZEluQmluID0gKCkgPT5cbiAgICBwYXJlbnQuZW5kc1dpdGgoJy9iaW4nKSAmJiAhc3VwZXJQYXJlbnQuZW5kc1dpdGgoJy9zcmMnKTtcblxuICBpZiAoaXNCdW5kbGVkSW5EaXN0KCkgfHwgaXNCdW5kbGVkSW5CaW4oKSkge1xuICAgIHJldHVybiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICB9XG5cbiAgLy8gcnVuIHZpYSB0c3ggdG8gYnVpbGQgdGhlIEByZXBrYS1raXQvdHMgaXRzZWxmXG4gIHJldHVybiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uLy4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpO1xufTtcblxuZXhwb3J0IGNvbnN0IG1vZHVsZVJvb3REaXJlY3RvcnkgPSBvbmNlKCgpID0+XG4gIGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsKHsgaW1wb3J0TWV0YVVybDogaW1wb3J0Lm1ldGEudXJsIH0pXG4pO1xuIiwiaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG50eXBlIFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzID0ge1xuICBzdGFydDogc3RyaW5nO1xuICBzdG9wcz86IHN0cmluZ1tdO1xuICBhcHBlbmRQYXRoPzogc3RyaW5nO1xuICB0ZXN0OiAocGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPGJvb2xlYW4gfCBzdHJpbmcgfCB1bmRlZmluZWQ+O1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uKiB1cHdhcmREaXJlY3RvcnlXYWxrKG9wdHM6IFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzKSB7XG4gIGxldCBjdXJyZW50ID0gb3B0cy5zdGFydDtcbiAgd2hpbGUgKFxuICAgIGN1cnJlbnQgIT09ICcvJyAmJlxuICAgIGN1cnJlbnQgIT09ICd+LycgJiZcbiAgICAhKG9wdHMuc3RvcHM/LmluY2x1ZGVzKGN1cnJlbnQpID8/IGZhbHNlKVxuICApIHtcbiAgICBjb25zdCBwYXRoID0gb3B0cy5hcHBlbmRQYXRoID8gam9pbihjdXJyZW50LCBvcHRzLmFwcGVuZFBhdGgpIDogY3VycmVudDtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBhd2FpdCBvcHRzLnRlc3QocGF0aCk7XG4gICAgaWYgKGNhbmRpZGF0ZSkge1xuICAgICAgeWllbGQgdHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ3N0cmluZycgPyBjYW5kaWRhdGUgOiBwYXRoO1xuICAgIH1cbiAgICBjdXJyZW50ID0gZGlybmFtZShjdXJyZW50KTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXB3YXJkRGlyZWN0b3J5U2VhcmNoKG9wdHM6IFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzKSB7XG4gIGNvbnN0IHdhbGsgPSB1cHdhcmREaXJlY3RvcnlXYWxrKG9wdHMpO1xuICBmb3IgYXdhaXQgKGNvbnN0IGRpciBvZiB3YWxrKSB7XG4gICAgcmV0dXJuIGRpcjtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcbmltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBQYWNrYWdlSnNvbiB9IGZyb20gJy4vcGFja2FnZUpzb24nO1xuXG5jb25zdCBjd2RQYWNrYWdlSnNvblBhdGggPSAoKSA9PiBqb2luKHByb2Nlc3MuY3dkKCksICcuL3BhY2thZ2UuanNvbicpO1xuXG5hc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb25BdChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIHJldHVybiBhd2FpdCByZWFkRmlsZShwYXRoLCAndXRmLTgnKS50aGVuKFxuICAgIChyZXN1bHQpID0+IEpTT04ucGFyc2UocmVzdWx0KSBhcyBQYWNrYWdlSnNvblxuICApO1xufVxuXG5leHBvcnQgY29uc3QgcmVhZEN3ZFBhY2thZ2VKc29uID0gb25jZUFzeW5jKCgpID0+XG4gIHJlYWRQYWNrYWdlSnNvbkF0KGN3ZFBhY2thZ2VKc29uUGF0aCgpKVxuKTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbihwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIC8vIGFzc3VtaW5nIGN1cnJlbnQgZGlyZWN0b3J5IGRvZXNuJ3QgY2hhbmdlIHdoaWxlIGFwcCBpcyBydW5uaW5nXG4gIHJldHVybiBwcm9jZXNzLmN3ZCgpID09PSBjd2RQYWNrYWdlSnNvblBhdGgoKVxuICAgID8gYXdhaXQgcmVhZEN3ZFBhY2thZ2VKc29uKClcbiAgICA6IGF3YWl0IHJlYWRQYWNrYWdlSnNvbkF0KHBhdGgpO1xufVxuIiwiLyoqXG4gKiBDYXB0dXJlIHRoZSBzdGFjayB0cmFjZSBhbmQgYWxsb3cgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgdGhyb3duIGluIGFzeW5jaHJvbm91cyBjYWxsYmFja3NcbiAqIHdpdGggYWRkaXRpb25hbCBzdGFjayBpbmZvcm1hdGlvbiBjYXB0dXJlZCBhdCB0aGUgbW9tZW50IG9mIHRoZSBjYWxsIG9mIHRoaXMgZnVuY3Rpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhcHR1cmVTdGFja1RyYWNlKHJlbW92ZSA9IDApIHtcbiAgY29uc3Qgc3RhY2tDb250YWluZXIgPSB7XG4gICAgc3RhY2s6ICcnLFxuICB9O1xuICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShzdGFja0NvbnRhaW5lcik7XG4gIGNvbnN0IHN0YWNrVHJhY2UgPSBzdGFja0NvbnRhaW5lci5zdGFja1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuc2xpY2UoNiArIHJlbW92ZSlcbiAgICAuam9pbignXFxuJyk7XG4gIHJldHVybiB7XG4gICAgLyoqXG4gICAgICogQ2FwdHVyZWQgc3RhY2sgdHJhY2UgaW5mb3JtYXRpb25cbiAgICAgKi9cbiAgICBzdGFja1RyYWNlLFxuICAgIC8qKlxuICAgICAqIENhbiBiZSBjYWxsZWQgaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrIHRvIGVucmljaCBleGNlcHRpb25zIHdpdGggYWRkaXRpb25hbCBpbmZvcm1hdGlvblxuICAgICAqIEBwYXJhbSBlcnIgRXhjZXB0aW9uIHRvIGVucmljaCAtIGl0IGlzIGdvaW5nIHRvIGhhdmUgaXRzIGAuc3RhY2tgIHByb3AgbXV0YXRlZFxuICAgICAqIEByZXR1cm5zIFNhbWUgZXhjZXB0aW9uXG4gICAgICovXG4gICAgcHJlcGFyZUZvclJldGhyb3c6IChlcnI6IEVycm9yKSA9PiB7XG4gICAgICBjb25zdCBvbGRTdGFja1RyYWNlID0gZXJyLnN0YWNrID8/ICcnLnNwbGl0KCdcXG4nKS5zbGljZSgxKS5qb2luKCdcXG4nKTtcbiAgICAgIGVyci5zdGFjayA9IGAke2Vyci5uYW1lIHx8ICdFcnJvcid9OiAke1xuICAgICAgICBlcnIubWVzc2FnZVxuICAgICAgfVxcbiR7b2xkU3RhY2tUcmFjZX1cXG4ke3N0YWNrVHJhY2V9YDtcbiAgICAgIHJldHVybiBlcnI7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHNwYXduIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IEFzc2lnbiB9IGZyb20gJ3V0aWxpdHktdHlwZXMnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IGNhcHR1cmVTdGFja1RyYWNlIH0gZnJvbSAnLi4vdXRpbHMvc3RhY2tUcmFjZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduVG9Qcm9taXNlT3B0cyA9IHtcbiAgLyoqXG4gICAqIFNwZWNpZnkgZXhpdCBjb2RlcyB3aGljaCBzaG91bGQgbm90IHJlc3VsdCBpbiB0aHJvd2luZyBhbiBlcnJvciB3aGVuXG4gICAqIHRoZSBwcm9jZXNzIGhhcyBmaW5pc2hlZCwgZS5nLiBzcGVjaWZ5aW5nIGBbMF1gIG1lYW5zIGlmIHByb2Nlc3MgZmluaXNoZWRcbiAgICogd2l0aCB6ZXJvIGV4aXQgY29kZSB0aGVuIHRoZSBwcm9taXNlIHdpbGwgcmVzb2x2ZSBpbnN0ZWFkIG9mIHJlamVjdGluZy5cbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgc3BlY2lmeSBgaW5oZXJpdGAgdG8gc2F2ZSBzdGF0dXMgY29kZSB0byB0aGUgY3VycmVudCBgcHJvY2Vzcy5leGl0Q29kZWBcbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgY29tcGxldGVseSBpZ25vcmUgdGhlIGV4aXQgY29kZSAoZS5nLiB5b3UgZm9sbG93IHVwIGFuZCBpbnRlcnJvZ2F0ZVxuICAgKiB0aGUgcHJvY2VzcyBjb2RlIG1hbnVhbGx5IGFmdGVyd2FyZHMpXG4gICAqL1xuICBleGl0Q29kZXM6IG51bWJlcltdIHwgJ2luaGVyaXQnIHwgJ2FueSc7XG59O1xuXG50eXBlIFNoYXJlZE9wdHMgPSBQaWNrPFNwYXduT3B0aW9ucywgJ2N3ZCc+O1xuXG50eXBlIFNwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PiA9IFtcbiAgY29tbWFuZDogc3RyaW5nLFxuICBhcmdzOiBSZWFkb25seUFycmF5PHN0cmluZz4sXG4gIG9wdGlvbnM6IEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+XG5dO1xuXG5leHBvcnQgdHlwZSBTcGF3bk9wdGlvbnNXaXRoRXh0cmE8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICBBc3NpZ248U3Bhd25PcHRpb25zLCBFPjtcblxuZXhwb3J0IHR5cGUgU3Bhd25QYXJhbWV0ZXJNaXg8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICB8IFtjcDogQ2hpbGRQcm9jZXNzLCBleHRyYU9wdHM6IEFzc2lnbjxFLCBTaGFyZWRPcHRzPl1cbiAgfCBTcGF3bkFyZ3M8RT47XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgYXJnczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbik6IGFyZ3MgaXMgU3Bhd25BcmdzPEU+IHtcbiAgcmV0dXJuICEoYXJnc1swXSBpbnN0YW5jZW9mIENoaWxkUHJvY2VzcykgJiYgdHlwZW9mIGFyZ3NbMF0gPT09ICdzdHJpbmcnO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzPEUgZXh0ZW5kcyBvYmplY3Q+KFxuICBwYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxFPlxuKSB7XG4gIGNvbnN0IFtjaGlsZCwgW2NvbW1hbmQsIGFyZ3MsIG9wdHNdXSA9IGlzU3Bhd25BcmdzKHBhcmFtZXRlcnMpXG4gICAgPyBbXG4gICAgICAgIHNwYXduKC4uLihwYXJhbWV0ZXJzIGFzIHVua25vd24gYXMgUGFyYW1ldGVyczx0eXBlb2Ygc3Bhd24+KSksXG4gICAgICAgIHBhcmFtZXRlcnMsXG4gICAgICBdXG4gICAgOiBbXG4gICAgICAgIHBhcmFtZXRlcnNbMF0sXG4gICAgICAgIFtcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduZmlsZSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduYXJncy5zbGljZSgxKSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzFdIGFzIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+LFxuICAgICAgICBdLFxuICAgICAgXTtcbiAgcmV0dXJuIHtcbiAgICBjaGlsZCxcbiAgICBjb21tYW5kLFxuICAgIGFyZ3MsXG4gICAgb3B0cyxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduVG9Qcm9taXNlKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHsgY2hpbGQsIGNvbW1hbmQsIGFyZ3MsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgeyBwcmVwYXJlRm9yUmV0aHJvdyB9ID0gY2FwdHVyZVN0YWNrVHJhY2UoKTtcblxuICBjb25zdCBleGl0Q29kZXMgPSBvcHRzLmV4aXRDb2RlcztcblxuICBjb25zdCBjd2QgPSBvcHRzLmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY21kID0gKCkgPT4gW2NvbW1hbmQsIC4uLmFyZ3NdLmpvaW4oJyAnKTtcblxuICBsb2dnZXIuZGVidWcoWyc+JywgY21kKCldLmpvaW4oJyAnKSwgLi4uKGN3ZCA/IFtgaW4gJHtjd2R9YF0gOiBbXSkpO1xuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMsIHJlaikgPT5cbiAgICBjaGlsZFxuICAgICAgLm9uKCdjbG9zZScsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGV4aXRDb2RlcyAhPT0gJ2luaGVyaXQnICYmXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdhbnknICYmXG4gICAgICAgICAgICAhZXhpdENvZGVzLmluY2x1ZGVzKGNvZGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZWooXG4gICAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihgQ29tbWFuZCBcIiR7Y21kKCl9XCIgaGFzIGZhaWxlZCB3aXRoIGNvZGUgJHtjb2RlfWApXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgICByZWooXG4gICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBGYWlsZWQgdG8gZXhlY3V0ZSBjb21tYW5kIFwiJHtjbWQoKX1cIiAtICR7c2lnbmFsfWApXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLm9uKCdlcnJvcicsIHJlailcbiAgKTtcbiAgLy8gaW5oZXJpdCBleGl0IGNvZGVcbiAgaWYgKGV4aXRDb2RlcyA9PT0gJ2luaGVyaXQnKSB7XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIGNoaWxkLmV4aXRDb2RlID09PSAnbnVtYmVyJyAmJlxuICAgICAgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJyB8fCBwcm9jZXNzLmV4aXRDb2RlID09PSAwKVxuICAgICkge1xuICAgICAgcHJvY2Vzcy5leGl0Q29kZSA9IGNoaWxkLmV4aXRDb2RlO1xuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuXG5pbXBvcnQgdHlwZSB7IFNwYXduUGFyYW1ldGVyTWl4LCBTcGF3blRvUHJvbWlzZU9wdHMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcblxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRPcHRzID0ge1xuICBvdXRwdXQ/OlxuICAgIHwgQXJyYXk8J3N0ZG91dCcgfCAnc3RkZXJyJz5cbiAgICB8IFsnc3Rkb3V0JyB8ICdzdGRlcnInLCAuLi5BcnJheTwnc3Rkb3V0JyB8ICdzdGRlcnInPl07XG4gIGJ1ZmZlcnM/OiB7XG4gICAgY29tYmluZWQ/OiBzdHJpbmdbXTtcbiAgICBzdGRvdXQ/OiBzdHJpbmdbXTtcbiAgICBzdGRlcnI/OiBzdHJpbmdbXTtcbiAgfTtcbn0gJiBTcGF3blRvUHJvbWlzZU9wdHM7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0UmV0dXJuID0ge1xuICBwaWQ/OiBudW1iZXI7XG4gIG91dHB1dDogc3RyaW5nW107XG4gIHN0ZG91dDogc3RyaW5nO1xuICBzdGRlcnI6IHN0cmluZztcbiAgc3RhdHVzOiBudW1iZXIgfCBudWxsO1xuICBzaWduYWw6IE5vZGVKUy5TaWduYWxzIHwgbnVsbDtcbiAgZXJyb3I/OiBFcnJvciB8IHVuZGVmaW5lZDtcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blJlc3VsdChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxTcGF3blJlc3VsdFJldHVybj4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IGNvbWJpbmVkRGF0YTogc3RyaW5nW10gPSBvcHRzLmJ1ZmZlcnM/LmNvbWJpbmVkID8/IFtdO1xuICBjb25zdCBzdGRvdXREYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3Rkb3V0ID8/IFtdO1xuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3RkZXJyID8/IFtdO1xuICBjb25zdCBvdXRwdXQgPSBvcHRzLm91dHB1dCA/PyBbJ3N0ZG91dCcsICdzdGRlcnInXTtcbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3Rkb3V0JykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZG91dCxcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRvdXRcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRvdXREYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3RkZXJyJykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZGVycixcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRlcnJcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3NwYXduVG9Qcm9taXNlKGNoaWxkLCBvcHRzKV0pO1xuICByZXR1cm4ge1xuICAgIHBpZDogY2hpbGQucGlkLFxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcbiAgICBzdGF0dXM6IGNoaWxkLmV4aXRDb2RlLFxuICAgIGdldCBvdXRwdXQoKSB7XG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xuICAgIH0sXG4gICAgZ2V0IHN0ZGVycigpIHtcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IHN0ZG91dCgpIHtcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IGVycm9yKCkge1xuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcbiAgICAgICAgPyAocmVzdWx0LnJlYXNvbiBhcyBFcnJvcilcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMsIFNwYXduUmVzdWx0UmV0dXJuIH0gZnJvbSAnLi9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBzcGF3blJlc3VsdCB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwgb3B0cyk7XG4gIHJldHVybiByZXN1bHQub3V0cHV0LmpvaW4oJycpO1xufVxuXG5jb25zdCBkZWZhdWx0U2hvdWxkT3V0cHV0ID0gKHJlc3VsdDogU3Bhd25SZXN1bHRSZXR1cm4pID0+IHtcbiAgcmV0dXJuIHJlc3VsdC5lcnJvciB8fCByZXN1bHQuc3RhdHVzICE9PSAwIHx8IGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJztcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxcbiAgICBTcGF3blJlc3VsdE9wdHMgJiB7XG4gICAgICAvKipcbiAgICAgICAqIEJ5IGRlZmF1bHQgd2lsbCBvdXRwdXQgdG8gYHN0ZGVycmAgd2hlbiBzcGF3biByZXN1bHQgZmFpbGVkIHdpdGggYW4gZXJyb3IsIHdoZW5cbiAgICAgICAqIHN0YXR1cyBjb2RlIGlzIG5vdCB6ZXJvIG9yIHdoZW4gYExvZ2dlci5sb2dMZXZlbGAgaXMgYGRlYnVnYFxuICAgICAgICovXG4gICAgICBzaG91bGRPdXRwdXQ/OiAocmVzdWx0OiBTcGF3blJlc3VsdFJldHVybikgPT4gYm9vbGVhbjtcbiAgICB9XG4gID5cbikge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcbiAgY29uc3Qgc2hvdWxkT3V0cHV0ID0gb3B0cy5zaG91bGRPdXRwdXQgPz8gZGVmYXVsdFNob3VsZE91dHB1dDtcbiAgaWYgKHNob3VsZE91dHB1dChyZXN1bHQpKSB7XG4gICAgbG9nZ2VyLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xuICB9XG4gIGlmIChyZXN1bHQuZXJyb3IpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG59XG4iLCJpbXBvcnQgeyByZWFkRmlsZSwgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuL21vZHVsZVJvb3REaXJlY3RvcnknO1xuXG5hc3luYyBmdW5jdGlvbiBpc0ZpbGUoZmlsZVBhdGg6IHN0cmluZykge1xuICByZXR1cm4gYXdhaXQgc3RhdChmaWxlUGF0aClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24qIGl0ZXJhdGVOb2RlTW9kdWxlcyhzdGFydFdpdGg6IHN0cmluZywgcGF0aDogc3RyaW5nKSB7XG4gIGxldCBjdXJyZW50ID0gc3RhcnRXaXRoO1xuICB3aGlsZSAoY3VycmVudCAhPT0gJy8nICYmIGN1cnJlbnQgIT09ICd+LycpIHtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBqb2luKGN1cnJlbnQsICdub2RlX21vZHVsZXMnLCBwYXRoKTtcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGNhbmRpZGF0ZSkpIHtcbiAgICAgIHlpZWxkIGNhbmRpZGF0ZTtcbiAgICB9XG4gICAgY3VycmVudCA9IGRpcm5hbWUoY3VycmVudCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmluZEJpblNjcmlwdChzdGFydFdpdGg6IHN0cmluZywgYmluU2NyaXB0UGF0aDogc3RyaW5nKSB7XG4gIGZvciBhd2FpdCAoY29uc3QgcGF0aCBvZiBpdGVyYXRlTm9kZU1vZHVsZXMoc3RhcnRXaXRoLCBiaW5TY3JpcHRQYXRoKSkge1xuICAgIHJldHVybiBwYXRoO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBiaW5QYXRoKG9wdHM6IHtcbiAgYmluTmFtZTogc3RyaW5nO1xuICBiaW5TY3JpcHRQYXRoOiBzdHJpbmc7XG4gIHVzZVNob3J0Y3V0PzogYm9vbGVhbjtcbn0pIHtcbiAgY29uc3QgdXNlU2hvcnRjdXQgPSBvcHRzLnVzZVNob3J0Y3V0ID8/IHRydWU7XG4gIGNvbnN0IHJvb3QgPSBtb2R1bGVSb290RGlyZWN0b3J5KCk7XG4gIGlmICh1c2VTaG9ydGN1dCkge1xuICAgIGNvbnN0IGJlc3RHdWVzcyA9IGpvaW4ocm9vdCwgJ25vZGVfbW9kdWxlcycsICcuYmluJywgb3B0cy5iaW5OYW1lKTtcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGJlc3RHdWVzcykpIHtcbiAgICAgIHJldHVybiBiZXN0R3Vlc3M7XG4gICAgfVxuICB9XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZpbmRCaW5TY3JpcHQocm9vdCwgb3B0cy5iaW5TY3JpcHRQYXRoKTtcbiAgaWYgKHJlc3VsdCkge1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgZmluZCBiaW4gJHtvcHRzLmJpbk5hbWV9YCk7XG59XG5cbmZ1bmN0aW9uIHNjcmlwdEZyb21QYWNrYWdlSnNvbihvcHRzOiB7XG4gIGJpbk5hbWU6IHN0cmluZztcbiAgcGFja2FnZUpzb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufSkge1xuICBjb25zdCBjYW5kaWRhdGUgPSBvcHRzLnBhY2thZ2VKc29uWydiaW4nXTtcbiAgaWYgKHR5cGVvZiBjYW5kaWRhdGUgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgY2FuZGlkYXRlID09PSAnb2JqZWN0JyAmJiBjYW5kaWRhdGUgIT09IG51bGwpIHtcbiAgICBjb25zdCBlbnRyeSA9IChjYW5kaWRhdGUgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPilbb3B0cy5iaW5OYW1lXTtcbiAgICBpZiAodHlwZW9mIGVudHJ5ID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGVudHJ5O1xuICAgIH1cbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGV0ZXJtaW5lQmluU2NyaXB0UGF0aChvcHRzOiB7XG4gIGJpbk5hbWU6IHN0cmluZztcbiAgYmluUGFja2FnZU5hbWU6IHN0cmluZztcbn0pIHtcbiAgZm9yIGF3YWl0IChjb25zdCBwYXRoIG9mIGl0ZXJhdGVOb2RlTW9kdWxlcyhcbiAgICBtb2R1bGVSb290RGlyZWN0b3J5KCksXG4gICAgam9pbihvcHRzLmJpblBhY2thZ2VOYW1lLCAncGFja2FnZS5qc29uJylcbiAgKSkge1xuICAgIGNvbnN0IHBrZyA9IGF3YWl0IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpXG4gICAgICAudGhlbigodGV4dCkgPT4gSlNPTi5wYXJzZSh0ZXh0KSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgIC5jYXRjaCgoKSA9PiBudWxsKTtcbiAgICBpZiAoIXBrZykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc2NyaXB0UGF0aCA9IHNjcmlwdEZyb21QYWNrYWdlSnNvbih7XG4gICAgICBiaW5OYW1lOiBvcHRzLmJpbk5hbWUsXG4gICAgICBwYWNrYWdlSnNvbjogcGtnLFxuICAgIH0pO1xuICAgIGlmICghc2NyaXB0UGF0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgY2FuZGlkYXRlID0gam9pbihkaXJuYW1lKHBhdGgpLCBzY3JpcHRQYXRoKTtcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGNhbmRpZGF0ZSkpIHtcbiAgICAgIHJldHVybiBqb2luKG9wdHMuYmluUGFja2FnZU5hbWUsIHNjcmlwdFBhdGgpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIGluY2x1ZGVzQW55T2YodGFyZ2V0OiBzdHJpbmdbXSwgaGFzQW55T2ZBcmdzOiBzdHJpbmdbXSkge1xuICByZXR1cm4gaGFzQW55T2ZBcmdzLnNvbWUoKHZhcmlhbnQpID0+IHRhcmdldC5pbmNsdWRlcyh2YXJpYW50KSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbnNlcnRBZnRlckFueU9mKFxuICB0YXJnZXQ6IHN0cmluZ1tdLFxuICBpbnNlcnQ6IHN0cmluZ1tdLFxuICBoYXNBbnlPZkFyZ3M6IHN0cmluZ1tdXG4pIHtcbiAgY29uc3QgaW5kZXggPSB0YXJnZXQuZmluZEluZGV4KCh2YWx1ZSkgPT4gaGFzQW55T2ZBcmdzLmluY2x1ZGVzKHZhbHVlKSk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICByZXR1cm4gdGFyZ2V0O1xuICB9XG4gIGNvbnN0IHJlc3VsdCA9IFsuLi50YXJnZXRdO1xuICByZXN1bHQuc3BsaWNlKGluZGV4ICsgMSwgMCwgLi4uaW5zZXJ0KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUFyZ3NGcm9tKFxuICB0YXJnZXQ6IHN0cmluZ1tdLFxuICBhcmdzOiBBcnJheTxzdHJpbmcgfCBSZWdFeHA+LFxuICBvcHRzPzogeyBudW1WYWx1ZXM6IG51bWJlciB9XG4pIHtcbiAgY29uc3QgcmVzdWx0ID0gWy4uLnRhcmdldF07XG4gIGZvciAoY29uc3QgYXJnIG9mIGFyZ3MpIHtcbiAgICBjb25zdCBpbmRleCA9IHRhcmdldC5maW5kSW5kZXgoKHZhbHVlKSA9PlxuICAgICAgdHlwZW9mIGFyZyA9PT0gJ3N0cmluZycgPyB2YWx1ZSA9PT0gYXJnIDogYXJnLnRlc3QodmFsdWUpXG4gICAgKTtcbiAgICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgICByZXN1bHQuc3BsaWNlKGluZGV4LCBvcHRzPy5udW1WYWx1ZXMgPyBvcHRzLm51bVZhbHVlcyArIDEgOiAxKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUlucHV0QXJncyhcbiAgYXJnczogQXJyYXk8c3RyaW5nIHwgUmVnRXhwPixcbiAgb3B0cz86IHsgbnVtVmFsdWVzOiBudW1iZXIgfVxuKSB7XG4gIHJldHVybiAoc3RhdGU6IENsaUFyZ3MpID0+IHtcbiAgICByZXR1cm4ge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBpbnB1dEFyZ3M6IHJlbW92ZUFyZ3NGcm9tKHN0YXRlLmlucHV0QXJncywgYXJncywgb3B0cyksXG4gICAgfTtcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNldERlZmF1bHRBcmdzKFxuICBhcmdzOiBbc3RyaW5nLCAuLi5zdHJpbmdbXV0sXG4gIHZhbHVlczogc3RyaW5nW10gPSBbXSxcbiAgY29uZGl0aW9uPzogKHN0YXRlOiBDbGlBcmdzKSA9PiBib29sZWFuLFxuICBhcHBseT86IChhcmdzOiBzdHJpbmdbXSwgc3RhdGU6IENsaUFyZ3MpID0+IENsaUFyZ3Ncbikge1xuICByZXR1cm4gKHN0YXRlOiBDbGlBcmdzKSA9PiB7XG4gICAgaWYgKGNvbmRpdGlvbikge1xuICAgICAgaWYgKCFjb25kaXRpb24oc3RhdGUpKSB7XG4gICAgICAgIHJldHVybiBzdGF0ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGluY2x1ZGVzQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBhcmdzKSkge1xuICAgICAgcmV0dXJuIHN0YXRlO1xuICAgIH1cbiAgICBjb25zdCBzZXQ6IE5vbk51bGxhYmxlPHR5cGVvZiBhcHBseT4gPSBhcHBseVxuICAgICAgPyBhcHBseVxuICAgICAgOiAoYXJncywgdG8pID0+ICh7XG4gICAgICAgICAgLi4udG8sXG4gICAgICAgICAgcHJlQXJnczogWy4uLnN0YXRlLnByZUFyZ3MsIC4uLmFyZ3NdLFxuICAgICAgICB9KTtcbiAgICByZXR1cm4gc2V0KFthcmdzWzBdLCAuLi52YWx1ZXNdLCBzdGF0ZSk7XG4gIH07XG59XG5cbmV4cG9ydCBjb25zdCByZW1vdmVMb2dMZXZlbE9wdGlvbiA9ICgpID0+XG4gIHJlbW92ZUlucHV0QXJncyhbJy0tbG9nLWxldmVsJ10sIHsgbnVtVmFsdWVzOiAxIH0pO1xuXG5leHBvcnQgdHlwZSBDbGlBcmdzID0ge1xuICAvKipcbiAgICogRXh0cmEgYXJndW1lbnRzIHRoYXQgZ28gYmVmb3JlIGFyZ3VtZW50cyBwYXNzZWQgaW4gYnkgdGhlIHVzZXJcbiAgICovXG4gIHByZUFyZ3M6IHN0cmluZ1tdO1xuICAvKipcbiAgICogQXJndW1lbnRzIGFzIHBhc3NlZCBpbiBieSB0aGUgdXNlciwgY291bGQgYmUgbW9kaWZpZWQgYnlcbiAgICogdHJhbnNmb3JtcyB0aGF0IGNvbWUgYmVmb3JlIGN1cnJlbnRcbiAgICovXG4gIGlucHV0QXJnczogc3RyaW5nW107XG4gIC8qKlxuICAgKiBFeHRyYSBhcmd1bWVudHMgdGhhdCBnbyBhZnRlciBhcmd1bWVudHMgcGFzc2VkIGluIGJ5IHRoZSB1c2VyXG4gICAqL1xuICBwb3N0QXJnczogc3RyaW5nW107XG59O1xuXG5leHBvcnQgdHlwZSBDbGlBcmdzVHJhbnNmb3JtID0gKHN0YXRlOiBDbGlBcmdzKSA9PiBDbGlBcmdzO1xuXG5leHBvcnQgZnVuY3Rpb24gY2xpQXJnc1BpcGUoXG4gIHRyYW5zZm9ybXM6IENsaUFyZ3NUcmFuc2Zvcm1bXSxcbiAgaW5wdXRBcmdzOiBzdHJpbmdbXVxuKSB7XG4gIGNvbnN0IHtcbiAgICBwcmVBcmdzLFxuICAgIGlucHV0QXJnczogbW9kaWZpZWRJbnB1dEFyZ3MsXG4gICAgcG9zdEFyZ3MsXG4gIH0gPSB0cmFuc2Zvcm1zLnJlZHVjZTxDbGlBcmdzPigoYWNjLCB0cmFuc2Zvcm0pID0+IHRyYW5zZm9ybShhY2MpLCB7XG4gICAgaW5wdXRBcmdzLFxuICAgIHByZUFyZ3M6IFtdLFxuICAgIHBvc3RBcmdzOiBbXSxcbiAgfSk7XG4gIHJldHVybiBbLi4ucHJlQXJncywgLi4ubW9kaWZpZWRJbnB1dEFyZ3MsIC4uLnBvc3RBcmdzXTtcbn1cbiIsImltcG9ydCB7IGlzVHJ1dGh5LCBvbmNlQXN5bmMgfSBmcm9tICdAdXRpbHMvdHMnO1xuaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0JztcbmltcG9ydCB7IGRpcm5hbWUsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5jb25zdCBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzID0gKGN1cnJlbnREaXJlY3Rvcnk6IHN0cmluZykgPT4ge1xuICAvLyBoYXZpbmcgJ3BhY2thZ2VzLyonIGluIHRoZSByb290IG9mIGEgbW9ub3JlcG8gaXMgc3VwZXIgY29tbW9uXG4gIGNvbnN0IHJlc3VsdCA9IC8oLiooPz1cXC9wYWNrYWdlc1xcLykpfCguKig/PVxcL25vZGVfbW9kdWxlc1xcLykpfCguKikvLmV4ZWMoXG4gICAgY3VycmVudERpcmVjdG9yeVxuICApO1xuICBhc3NlcnQoISFyZXN1bHQpO1xuICBjb25zdCBbLCBwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdF0gPSByZXN1bHQ7XG4gIHJldHVybiBbcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdLmZpbHRlcihpc1RydXRoeSk7XG59O1xuXG4vLyByZXR1cm5zIHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2hpY2ggaGFzIG1vbm9yZXBvIG1hcmtlcnMsIG11bHRpcGxlXG4vLyBkaXJlY3RvcmllcyBjYW4gaGF2ZSB0aGVtIC0gd2hpY2hldmVyIHJlYWQgZmlyc3Qgd2lsbCBiZSByZXR1cm5lZFxuLy8gc28gaWYgb3JkZXIgaXMgaW1wb3J0YW50IC0gc2Nhbm5pbmcgc2hvdWxkIGJlIHNlcGFyYXRlZCB0byBtdWx0aXBsZSBqb2JzXG4vLyB2aWEgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnNcbmNvbnN0IGhhc1Jvb3RNYXJrZXJzID0gYXN5bmMgKGNhbmRpZGF0ZXM6IHN0cmluZ1tdKSA9PiB7XG4gIGNvbnN0IG1hcmtlcnMgPSBbXG4gICAgJy5naXQnLFxuICAgICd5YXJuLmxvY2snLFxuICAgICdwbnBtLWxvY2sueWFtbCcsXG4gICAgJ3BhY2thZ2UtbG9jay5qc29uJyxcbiAgICAncG5wbS13b3Jrc3BhY2UueWFtbCcsXG4gIF07XG4gIGNvbnN0IG1hcmtlcnNTdHJlYW0gPSBmZy5zdHJlYW0oXG4gICAgY2FuZGlkYXRlcy5mbGF0TWFwKChkaXIpID0+IG1hcmtlcnMubWFwKChtYXJrZXIpID0+IGpvaW4oZGlyLCBtYXJrZXIpKSksXG4gICAge1xuICAgICAgbWFya0RpcmVjdG9yaWVzOiB0cnVlLFxuICAgICAgb25seUZpbGVzOiBmYWxzZSxcbiAgICB9XG4gICk7XG4gIGZvciBhd2FpdCAoY29uc3QgZW50cnkgb2YgbWFya2Vyc1N0cmVhbSkge1xuICAgIGFzc2VydCh0eXBlb2YgZW50cnkgPT09ICdzdHJpbmcnKTtcbiAgICByZXR1cm4gZGlybmFtZShlbnRyeSk7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbmNvbnN0IHByaW9yaXRpemVkSGFzTWFya2VycyA9IChqb2JzOiBzdHJpbmdbXVtdKSA9PiB7XG4gIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgfVxuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPigocmVzKSA9PiB7XG4gICAgY29uc3QgcmVzdWx0cyA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmcgfCB1bmRlZmluZWQ+KCk7XG5cbiAgICBjb25zdCBjaGVja1Nob3VsZENvbXBsZXRlID0gKGluZGV4OiBudW1iZXIsIHJlc3VsdDogc3RyaW5nIHwgdW5kZWZpbmVkKSA9PiB7XG4gICAgICByZXN1bHRzLnNldChpbmRleCwgcmVzdWx0KTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgam9icy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBoYXNSZXN1bHQgPSByZXN1bHRzLmhhcyhpKTtcbiAgICAgICAgaWYgKCFoYXNSZXN1bHQpIHtcbiAgICAgICAgICAvLyBpZiBhIGpvYiB3aXRoIGhpZ2hlc3QgcHJpb3JpdHkgaGFzbid0IGZpbmlzaGVkIHlldFxuICAgICAgICAgIC8vIHRoZW4gd2FpdCBmb3IgaXRcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXN1bHQgPSByZXN1bHRzLmdldChpKTtcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIC8vIGpvYiBmaW5pc2hlZCBhbmQgd2UgZm91bmQgbWFya2VycywgYWxzbyBhbGwgam9ic1xuICAgICAgICAgIC8vIHdpdGggaGlnaGVyIHByaW9yaXR5IGZpbmlzaGVkIGFuZCB0aGV5IGRvbid0IGhhdmVcbiAgICAgICAgICAvLyBhbnkgbWFya2VycyAtIHdlIGFyZSBkb25lXG4gICAgICAgICAgcmVzKHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHRzLnNpemUgPT09IGpvYnMubGVuZ3RoKSB7XG4gICAgICAgIC8vIGFsbCBqb2JzIGZpbmlzaGVkIC0gbm8gbWFya2VycyBmb3VuZFxuICAgICAgICByZXModW5kZWZpbmVkKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgam9icy5mb3JFYWNoKChkaXJlY3RvcmllcywgaW5kZXgpID0+IHtcbiAgICAgIGhhc1Jvb3RNYXJrZXJzKGRpcmVjdG9yaWVzKVxuICAgICAgICAudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgICAgY2hlY2tTaG91bGRDb21wbGV0ZShpbmRleCwgcmVzdWx0KTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBpZ25vcmVcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn07XG5cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuID0gYXN5bmMgKFxuICBsb29rdXBEaXJlY3Rvcnk6IHN0cmluZ1xuKSA9PiB7XG4gIGNvbnN0IHVuaXF1ZURpcm5hbWUgPSAocGF0aD86IHN0cmluZykgPT4ge1xuICAgIGlmICghcGF0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBkaXJuYW1lKHBhdGgpO1xuICAgIGlmIChyZXN1bHQgPT09IHBhdGgpIHtcbiAgICAgIC8vIGUuZy4gdGhlIHBhdGggd2FzIGFscmVhZHkgYSByb290IFwiL1wiXG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgY29uc3QgcGFyZW50ID0gdW5pcXVlRGlybmFtZShsb29rdXBEaXJlY3RvcnkpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IHVuaXF1ZURpcm5hbWUocGFyZW50KTtcblxuICByZXR1cm4gKFxuICAgIChhd2FpdCBwcmlvcml0aXplZEhhc01hcmtlcnMoXG4gICAgICAvLyBzY2FuIGluIG1vc3QgbGlrZWx5IGxvY2F0aW9ucyBmaXJzdCB3aXRoIGN1cnJlbnQgbG9va3VwIGRpcmVjdG9yeSB0YWtpbmcgcHJpb3JpdHlcbiAgICAgIFtcbiAgICAgICAgW2xvb2t1cERpcmVjdG9yeV0sXG4gICAgICAgIGdldFJlcG9zaXRvcnlSb290U2NhbkNhbmRpZGF0ZXMobG9va3VwRGlyZWN0b3J5KSxcbiAgICAgICAgLy8gc2NhbiAyIGRpcmVjdG9yaWVzIHVwd2FyZHNcbiAgICAgICAgW3BhcmVudF0sXG4gICAgICAgIFtzdXBlclBhcmVudF0sXG4gICAgICBdXG4gICAgICAgIC5tYXAoKGRpcnMpID0+IGRpcnMuZmlsdGVyKGlzVHJ1dGh5KSlcbiAgICAgICAgLmZpbHRlcigoam9iKSA9PiBqb2IubGVuZ3RoID4gMClcbiAgICApKSB8fCBsb29rdXBEaXJlY3RvcnkgLyogZmFsbGJhY2sgdG8gY3VycmVudCBkaXJlY3RvcnkgaW4gd29yc2Ugc2NlbmFyaW8gKi9cbiAgKTtcbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIHJlcG9zaXRvcnkgcm9vdCBwYXRoIGJ5IHNjYW5uaW5nIGN1cnJlbnQgYW5kIHBhcmVudCBkaXJlY3Rvcmllc1xuICogYW5kIGxvb2tpbmcgZm9yIG1hcmtlciBmaWxlcy9kaXJzIGxpa2U6XG4gKlxuICogLSAuZ2l0XG4gKiAtIHBhY2thZ2UtbG9jay5qc29uXG4gKiAtIHlhcm4ubG9ja1xuICogLSBwbnBtLWxvY2sueWFtbFxuICogLSBwbnBtLXdvcmtzcGFjZS55YW1sXG4gKi9cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGggPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290UGF0aCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4ocHJvY2Vzcy5jd2QoKSk7XG4gIHJldHVybiByb290UGF0aDtcbn0pO1xuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnNXaXRoRXh0cmEgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IFNwYXduUmVzdWx0T3B0cyB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBiaW5QYXRoIH0gZnJvbSAnLi91dGlscy9iaW5QYXRoJztcbmltcG9ydCB0eXBlIHsgQ2xpQXJncyB9IGZyb20gJy4vdXRpbHMvY2xpQXJnc1BpcGUnO1xuaW1wb3J0IHsgY2xpQXJnc1BpcGUgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGluc2VydEFmdGVyQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGluY2x1ZGVzQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuZXhwb3J0IHR5cGUgVGFza1R5cGVzID1cbiAgfCAnbGludCdcbiAgfCAnYnVpbGQnXG4gIHwgJ3Rlc3QnXG4gIHwgJ2RlY2xhcmF0aW9ucydcbiAgfCAnaW50ZWdyYXRpb24nXG4gIHwgJ3NldHVwOmludGVncmF0aW9uJ1xuICB8IChzdHJpbmcgJiB7XG4gICAgICBfYWxsb3dTdHJpbmdzPzogdW5kZWZpbmVkO1xuICAgIH0pO1xuXG5leHBvcnQgY29uc3QgdHVyYm9CaW5QYXRoID0gKCkgPT5cbiAgYmluUGF0aCh7XG4gICAgYmluTmFtZTogJ3R1cmJvJyxcbiAgICBiaW5TY3JpcHRQYXRoOiAndHVyYm8vYmluL3R1cmJvJyxcbiAgfSk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYXNUdXJib0pzb24oKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICByZXR1cm4gYXdhaXQgc3RhdChqb2luKGN3ZCwgJ3R1cmJvLmpzb24nKSlcbiAgICAudGhlbigocmVzKSA9PiByZXMuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhc3NUdXJib0ZvcmNlRW52KGFyZ3M6IHN0cmluZ1tdKSB7XG4gIHJldHVybiBpbmNsdWRlc0FueU9mKGFyZ3MsIFsncnVuJ10pICYmIGluY2x1ZGVzQW55T2YoYXJncywgWyctLWZvcmNlJ10pXG4gICAgPyB7XG4gICAgICAgIFRVUkJPX0ZPUkNFOiAnMScsXG4gICAgICB9XG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbmhlcml0VHVyYm9Gb3JjZUFyZ0Zyb21FbnYoKSB7XG4gIHJldHVybiAoc3RhdGU6IENsaUFyZ3MpID0+ICh7XG4gICAgLi4uc3RhdGUsXG4gICAgaW5wdXRBcmdzOlxuICAgICAgaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsncnVuJ10pICYmXG4gICAgICAhaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsnLS1mb3JjZSddKSAmJlxuICAgICAgcHJvY2Vzcy5lbnZbJ1RVUkJPX0ZPUkNFJ11cbiAgICAgICAgPyBpbnNlcnRBZnRlckFueU9mKHN0YXRlLmlucHV0QXJncywgWyctLWZvcmNlJ10sIFsncnVuJ10pXG4gICAgICAgIDogc3RhdGUuaW5wdXRBcmdzLFxuICB9KTtcbn1cblxuLyoqXG4gKiBSdW4gb25lIG9mIHRoZSBkZXYgcGlwZWxpbmUgdGFza3MgdXNpbmcgVHVyYm8gZm9yIGEgc2luZ2xlIHBhY2thZ2VcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlKG9wdHM6IHtcbiAgdGFza3M6IFtUYXNrVHlwZXMsIC4uLlRhc2tUeXBlc1tdXTtcbiAgcGFja2FnZURpcj86IHN0cmluZztcbiAgc3Bhd25PcHRzOiBPbWl0PFNwYXduT3B0aW9uc1dpdGhFeHRyYTxTcGF3blJlc3VsdE9wdHM+LCAnY3dkJz47XG59KSB7XG4gIGNvbnN0IHJvb3REaXIgPSBvcHRzLnBhY2thZ2VEaXIgPz8gcHJvY2Vzcy5jd2QoKTtcbiAgY29uc3QgY3dkID0gYXdhaXQgcmVwb3NpdG9yeVJvb3RQYXRoKCk7XG4gIHJldHVybiBhd2FpdCBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAgIGF3YWl0IHR1cmJvQmluUGF0aCgpLFxuICAgIGNsaUFyZ3NQaXBlKFxuICAgICAgW2luaGVyaXRUdXJib0ZvcmNlQXJnRnJvbUVudigpXSxcbiAgICAgIFtcbiAgICAgICAgJ3J1bicsXG4gICAgICAgIC4uLm9wdHMudGFza3MsXG4gICAgICAgICctLWZpbHRlcj0nICsgcm9vdERpci5yZXBsYWNlKGN3ZCwgJy4nKSxcbiAgICAgICAgJy0tb3V0cHV0LWxvZ3M9bmV3LW9ubHknLFxuICAgICAgXVxuICAgICksXG4gICAge1xuICAgICAgLi4ub3B0cy5zcGF3bk9wdHMsXG4gICAgICBjd2QsXG4gICAgfVxuICApO1xufVxuIiwiaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcbmltcG9ydCB7IGxvYWQgfSBmcm9tICdqcy15YW1sJztcbmltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiB0cnlSZWFkaW5nUG5wbVdvcmtzcGFjZVlhbWwobW9ub3JlcG9Sb290OiBzdHJpbmcpIHtcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHJlYWRGaWxlKFxuICAgIGpvaW4obW9ub3JlcG9Sb290LCAncG5wbS13b3Jrc3BhY2UueWFtbCcpLFxuICAgICd1dGYtOCdcbiAgKTtcbiAgY29uc3Qgcm9vdFBhdGggPSBsb2FkKHRleHQpIGFzIHtcbiAgICBwYWNrYWdlcz86IHN0cmluZ1tdO1xuICB9O1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShyb290UGF0aC5wYWNrYWdlcykgJiYgcm9vdFBhdGgucGFja2FnZXMubGVuZ3RoID4gMFxuICAgID8gcm9vdFBhdGgucGFja2FnZXNcbiAgICA6IHVuZGVmaW5lZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdHJ5UmVhZGluZ1BhY2thZ2VKc29uV29ya3NwYWNlcyhtb25vcmVwb1Jvb3Q6IHN0cmluZykge1xuICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVhZEZpbGUoam9pbihtb25vcmVwb1Jvb3QsICdwYWNrYWdlLmpzb24nKSwgJ3V0Zi04Jyk7XG4gIGNvbnN0IHBhY2thZ2VKc29uID0gSlNPTi5wYXJzZSh0ZXh0KSBhcyB7XG4gICAgd29ya3NwYWNlcz86IHN0cmluZ1tdO1xuICB9O1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShwYWNrYWdlSnNvbi53b3Jrc3BhY2VzKSAmJlxuICAgIHBhY2thZ2VKc29uLndvcmtzcGFjZXMubGVuZ3RoID4gMFxuICAgID8gcGFja2FnZUpzb24ud29ya3NwYWNlc1xuICAgIDogdW5kZWZpbmVkO1xufVxuXG5jb25zdCByZWFkUGFja2FnZXNHbG9ic0F0ID0gYXN5bmMgKG1vbm9yZXBvUm9vdDogc3RyaW5nKSA9PiB7XG4gIGNvbnN0IFtwbnBtV29ya3NwYWNlcywgcGFja2FnZUpzb25Xb3Jrc3BhY2VzXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICB0cnlSZWFkaW5nUG5wbVdvcmtzcGFjZVlhbWwobW9ub3JlcG9Sb290KS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpLFxuICAgIHRyeVJlYWRpbmdQYWNrYWdlSnNvbldvcmtzcGFjZXMobW9ub3JlcG9Sb290KS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpLFxuICBdKTtcbiAgcmV0dXJuIHBucG1Xb3Jrc3BhY2VzIHx8IHBhY2thZ2VKc29uV29ya3NwYWNlcyB8fCBbXTtcbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIG1vbm9yZXBvIHBhY2thZ2VzIGdsb2IgYnkgcmVhZGluZyBvbmUgb2YgdGhlIHN1cHBvcnRlZFxuICogZmlsZXNcbiAqXG4gKiBOT1RFOiBvbmx5IHBucG0gaXMgc3VwcG9ydGVkIGF0IHRoZSBtb21lbnRcbiAqL1xuZXhwb3J0IGNvbnN0IHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMgPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290ID0gYXdhaXQgcmVwb3NpdG9yeVJvb3RQYXRoKCk7XG4gIGNvbnN0IHBhY2thZ2VzR2xvYnMgPSBhd2FpdCByZWFkUGFja2FnZXNHbG9ic0F0KHJvb3QpO1xuICByZXR1cm4ge1xuICAgIHJvb3QsXG4gICAgcGFja2FnZXNHbG9icyxcbiAgfTtcbn0pO1xuIiwiaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgaGFzVHVyYm9Kc29uIH0gZnJvbSAnLi4vdHVyYm8nO1xuaW1wb3J0IHsgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyB9IGZyb20gJy4vcmVhZFBhY2thZ2VzR2xvYnMnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uKCkge1xuICBjb25zdCBbeyByb290LCBwYWNrYWdlc0dsb2JzIH0sIGhhc1R1cmJvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzKCksXG4gICAgaGFzVHVyYm9Kc29uKCksXG4gIF0pO1xuICBpZiAocGFja2FnZXNHbG9icy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4ge1xuICAgICAgcm9vdCxcbiAgICAgIHBhY2thZ2VzR2xvYnMsXG4gICAgICBwYWNrYWdlTG9jYXRpb25zOiBbXSxcbiAgICAgIGhhc1R1cmJvLFxuICAgICAgdHlwZTogJ3NpbmdsZS1wYWNrYWdlJyBhcyBjb25zdCxcbiAgICB9O1xuICB9XG4gIGNvbnN0IHBhY2thZ2VMb2NhdGlvbnMgPSBhd2FpdCBmZyhcbiAgICBwYWNrYWdlc0dsb2JzLm1hcCgoZ2xvYikgPT4gYCR7Z2xvYn0vcGFja2FnZS5qc29uYCksXG4gICAge1xuICAgICAgY3dkOiByb290LFxuICAgIH1cbiAgKTtcbiAgcmV0dXJuIHtcbiAgICByb290LFxuICAgIHBhY2thZ2VzR2xvYnMsXG4gICAgcGFja2FnZUxvY2F0aW9uczogcGFja2FnZUxvY2F0aW9ucy5tYXAoKGxvY2F0aW9uKSA9PiBkaXJuYW1lKGxvY2F0aW9uKSksXG4gICAgaGFzVHVyYm8sXG4gICAgdHlwZTogJ211bHRpcGxlLXBhY2thZ2VzJyBhcyBjb25zdCxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBpc0RpcmVjdG9yeSB9IGZyb20gJy4vaXNEaXJlY3RvcnknO1xuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4vbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5pbXBvcnQgeyB1cHdhcmREaXJlY3RvcnlTZWFyY2ggfSBmcm9tICcuL3Vwd2FyZERpcmVjdG9yeVNlYXJjaCc7XG5cbmV4cG9ydCB7IHJlYWRQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuZXhwb3J0IHsgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uIH0gZnJvbSAnLi9sb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24nO1xuZXhwb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiBsb29rdXAob3B0czogeyBwYXRoOiBzdHJpbmc7IGxvb2t1cFBhY2thZ2VOYW1lOiBzdHJpbmcgfSkge1xuICByZXR1cm4gYXdhaXQgdXB3YXJkRGlyZWN0b3J5U2VhcmNoKHtcbiAgICBzdGFydDogbW9kdWxlUm9vdERpcmVjdG9yeSgpLFxuICAgIGFwcGVuZFBhdGg6IGpvaW4oJ25vZGVfbW9kdWxlcycsIG9wdHMubG9va3VwUGFja2FnZU5hbWUpLFxuICAgIHRlc3Q6IGlzRGlyZWN0b3J5LFxuICB9KTtcbn1cblxuLyoqXG4gKiBMb29rdXAgbG9jYXRpb24gZm9yIGRldkRlcGVuZGVuY2llcyBvZiBcIkByZXBrYS1raXQvdHNcIiAtIHRoaXMgZnVuY3Rpb24gd2lsbFxuICogbG9va3VwIGZvciBcIm9wdHMubG9va3VwUGFja2FnZU5hbWVcIlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmluZERldkRlcGVuZGVuY3kob3B0czogeyBsb29rdXBQYWNrYWdlTmFtZTogc3RyaW5nIH0pIHtcbiAgY29uc3QgbG9va3VwUGFja2FnZU5hbWUgPSBvcHRzLmxvb2t1cFBhY2thZ2VOYW1lO1xuXG4gIHJldHVybiBhd2FpdCBsb29rdXAoe1xuICAgIHBhdGg6IG1vZHVsZVJvb3REaXJlY3RvcnkoKSxcbiAgICBsb29rdXBQYWNrYWdlTmFtZSxcbiAgfSk7XG59XG4iLCJpbXBvcnQgdHlwZSB7IENvbmZpZyB9IGZyb20gJ0BqZXN0L3R5cGVzJztcbmltcG9ydCB7IHN0YXQgfSBmcm9tICdmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAncGF0aCc7XG5cbmltcG9ydCB7IHNwYXduT3V0cHV0Q29uZGl0aW9uYWwgfSBmcm9tICcuLi9jaGlsZC1wcm9jZXNzJztcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgcmVhZFBhY2thZ2VKc29uIH0gZnJvbSAnLi4vcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbic7XG5pbXBvcnQgeyBydW5UdXJib1Rhc2tzRm9yU2luZ2xlUGFja2FnZSB9IGZyb20gJy4uL3R1cmJvJztcblxuYXN5bmMgZnVuY3Rpb24gbG9hZFN0YW5kYXJkR2xvYmFsSG9vayhcbiAgc2NyaXB0OiBzdHJpbmcsXG4gIGdsb2JhbENvbmZpZzogQ29uZmlnLkdsb2JhbENvbmZpZyxcbiAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWdcbikge1xuICBjb25zdCBsb2NhdGlvbiA9IGpvaW4ocHJvamVjdENvbmZpZy5yb290RGlyLCBzY3JpcHQpO1xuICBjb25zdCBoYXNIb29rID0gYXdhaXQgc3RhdChsb2NhdGlvbilcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbiAgcmV0dXJuIHtcbiAgICBoYXNIb29rLFxuICAgIGV4ZWN1dGU6IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghaGFzSG9vaykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCByZXN1bHQgPSAoYXdhaXQgaW1wb3J0KGxvY2F0aW9uKSkgYXNcbiAgICAgICAgfCB7XG4gICAgICAgICAgICBkZWZhdWx0PzogKFxuICAgICAgICAgICAgICBnbG9iYWxDb25maWc6IENvbmZpZy5HbG9iYWxDb25maWcsXG4gICAgICAgICAgICAgIHByb2plY3RDb25maWc6IENvbmZpZy5Qcm9qZWN0Q29uZmlnXG4gICAgICAgICAgICApID0+IFByb21pc2U8dm9pZD47XG4gICAgICAgICAgfVxuICAgICAgICB8IHVuZGVmaW5lZDtcbiAgICAgIGlmICghcmVzdWx0IHx8ICFyZXN1bHQuZGVmYXVsdCkge1xuICAgICAgICBsb2dnZXIud2Fybihg4pqg77iPIE5vIGRlZmF1bHQgZXhwb3J0IGZvdW5kIGluIFwiJHtzY3JpcHR9XCJgKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgYXdhaXQgUHJvbWlzZS5yZXNvbHZlKHJlc3VsdC5kZWZhdWx0KGdsb2JhbENvbmZpZywgcHJvamVjdENvbmZpZykpO1xuICAgIH0sXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRDdXN0b21HbG9iYWxIb29rKFxuICBzY3JpcHQ6IHN0cmluZyxcbiAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWdcbikge1xuICBjb25zdCBsb2NhdGlvbiA9IGpvaW4ocHJvamVjdENvbmZpZy5yb290RGlyLCBzY3JpcHQpO1xuICBjb25zdCBoYXNIb29rID0gYXdhaXQgc3RhdChsb2NhdGlvbilcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbiAgcmV0dXJuIHtcbiAgICBoYXNIb29rLFxuICAgIGV4ZWN1dGU6IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghaGFzSG9vaykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBwYWNrYWdlSnNvbiA9IGF3YWl0IHJlYWRQYWNrYWdlSnNvbihcbiAgICAgICAgam9pbihwcm9jZXNzLmN3ZCgpLCAncGFja2FnZS5qc29uJylcbiAgICAgICk7XG5cbiAgICAgIGlmIChcbiAgICAgICAgbG9jYXRpb24uZW5kc1dpdGgoJ3NldHVwLnRzJykgJiZcbiAgICAgICAgdHlwZW9mIHBhY2thZ2VKc29uWydzY3JpcHRzJ10gPT09ICdvYmplY3QnICYmXG4gICAgICAgIHBhY2thZ2VKc29uWydzY3JpcHRzJ11bJ3NldHVwOmludGVncmF0aW9uJ10gPT09IGB0c3ggJHtzY3JpcHR9YFxuICAgICAgKSB7XG4gICAgICAgIGF3YWl0IHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlKHtcbiAgICAgICAgICB0YXNrczogWydzZXR1cDppbnRlZ3JhdGlvbiddLFxuICAgICAgICAgIHNwYXduT3B0czoge1xuICAgICAgICAgICAgZXhpdENvZGVzOiBbMF0sXG4gICAgICAgICAgICBlbnY6IHtcbiAgICAgICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgICAgIExPR19MRVZFTDogbG9nZ2VyLmxvZ0xldmVsLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHNwYXduT3V0cHV0Q29uZGl0aW9uYWwoJ3RzeCcsIFtsb2NhdGlvbl0sIHtcbiAgICAgICAgICBleGl0Q29kZXM6IFswXSxcbiAgICAgICAgICBlbnY6IHtcbiAgICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgICAgTE9HX0xFVkVMOiBsb2dnZXIubG9nTGV2ZWwsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRBbmRSdW5HbG9iYWxIb29rKFxuICBzY3JpcHQ6IHN0cmluZyxcbiAgZ2xvYmFsQ29uZmlnOiBDb25maWcuR2xvYmFsQ29uZmlnLFxuICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZyxcbiAgdGlwPzogc3RyaW5nXG4pIHtcbiAgY29uc3QgW3N0YW5kYXJkLCBjdXN0b21dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIGxvYWRTdGFuZGFyZEdsb2JhbEhvb2soYCR7c2NyaXB0fS5tanNgLCBnbG9iYWxDb25maWcsIHByb2plY3RDb25maWcpLFxuICAgIGxvYWRDdXN0b21HbG9iYWxIb29rKGAke3NjcmlwdH0udHNgLCBwcm9qZWN0Q29uZmlnKSxcbiAgXSk7XG4gIGlmICghY3VzdG9tLmhhc0hvb2sgJiYgdGlwKSB7XG4gICAgbG9nZ2VyLnRpcCh0aXApO1xuICB9XG4gIGF3YWl0IHN0YW5kYXJkLmV4ZWN1dGUoKTtcbiAgYXdhaXQgY3VzdG9tLmV4ZWN1dGUoKTtcbn1cbiIsImltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBmaW5kRGV2RGVwZW5kZW5jeSB9IGZyb20gJy4uL3V0aWxzL2ZpbmREZXZEZXBlbmRlbmN5JztcblxuZXhwb3J0IHsgcmVhZFBhY2thZ2VKc29uIH0gZnJvbSAnLi4vcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbic7XG5leHBvcnQgeyBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24gfSBmcm9tICcuLi91dGlscy9sb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24nO1xuZXhwb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi4vdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoJztcbmV4cG9ydCB7IGxvYWRBbmRSdW5HbG9iYWxIb29rIH0gZnJvbSAnLi9sb2FkQW5kUnVuR2xvYmFsSG9vayc7XG5cbmV4cG9ydCBjb25zdCBqZXN0UGx1Z2luUm9vdCA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZpbmREZXZEZXBlbmRlbmN5KHtcbiAgICBsb29rdXBQYWNrYWdlTmFtZTogJ2VzYnVpbGQtamVzdCcsXG4gIH0pO1xuICBpZiAoIXJlc3VsdCkge1xuICAgIGxvZ2dlci53YXJuKFxuICAgICAgJ0plc3QgcGx1Z2lucyByb290IGNhbm5vdCBiZSBkZXRlcm1pbmVkLiBEbyB5b3UgaGF2ZSBcIkByZXBrYS1raXQvdHNcIiBpbiBkZXZEZXBlbmRlbmNpZXMgYXQgdGhlIG1vbm9yZXBvIHJvb3Qgb3IgYXQgdGhlIGxvY2FsIHBhY2thZ2U/J1xuICAgICk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJykge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdGb3VuZCBqZXN0IHBsdWdpbnMgcm9vdCBhdCcsIGRpcm5hbWUocmVzdWx0KSk7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQgPyBkaXJuYW1lKHJlc3VsdCkgOiAnLic7XG59KTtcbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBTyxTQUFBLFFBQUEsQ0FDTCxLQUN5QixFQUFBO0FBQ3pCLEVBQUEsT0FBTyxRQUFRLEtBQUssQ0FBQSxDQUFBO0FBQ3RCOztBQ0pPLFNBQUEsSUFBQSxDQUFpQixFQUFzQixFQUFBO0FBQzVDLEVBQUksSUFBQSxLQUFBLENBQUE7QUFDSixFQUFBLElBQUksVUFBYSxHQUFBLEtBQUEsQ0FBQTtBQUNqQixFQUFBLE9BQU8sTUFBUztBQUNkLElBQUEsSUFBSSxVQUFZLEVBQUE7QUFDZCxNQUFPLE9BQUEsS0FBQSxDQUFBO0FBQUEsS0FDVDtBQUNBLElBQUEsS0FBQSxHQUFRLEVBQUcsRUFBQSxDQUFBO0FBQ1gsSUFBYSxVQUFBLEdBQUEsSUFBQSxDQUFBO0FBQ2IsSUFBTyxPQUFBLEtBQUEsQ0FBQTtBQUFBLEdBQ1QsQ0FBQTtBQUNGOztBQ1hPLFNBQUEsU0FBQSxDQUFzQixFQUE0QyxFQUFBO0FBQ3ZFLEVBQUksSUFBQSxLQUFBLENBQUE7QUFDSixFQUFJLElBQUEsUUFBQSxDQUFBO0FBQ0osRUFBQSxJQUFJLFVBQWEsR0FBQSxLQUFBLENBQUE7QUFDakIsRUFBQSxPQUFPLFlBQXdCO0FBQzdCLElBQUEsSUFBSSxVQUFZLEVBQUE7QUFDZCxNQUFPLE9BQUEsS0FBQSxDQUFBO0FBQUEsS0FDVDtBQUNB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
