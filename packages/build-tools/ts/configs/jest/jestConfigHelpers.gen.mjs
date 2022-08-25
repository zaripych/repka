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
  return rootPath.packages ?? [];
}
async function tryReadingPackageJsonWorkspaces(monorepoRoot) {
  const text = await readFile(join(monorepoRoot, "package.json"), "utf-8");
  const packageJson = JSON.parse(text);
  return Array.isArray(packageJson.workspaces) ? packageJson.workspaces : [];
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL2lzVHJ1dGh5LnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL29uY2UudHMiLCIuLi8uLi8uLi8uLi91dGlscy90cy9zcmMvb25jZUFzeW5jLnRzIiwiLi4vLi4vc3JjL2xvZ2dlci9sb2dnZXIudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNEaXJlY3RvcnkudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeS50cyIsIi4uLy4uL3NyYy91dGlscy91cHdhcmREaXJlY3RvcnlTZWFyY2gudHMiLCIuLi8uLi9zcmMvcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbi50cyIsIi4uLy4uL3NyYy91dGlscy9zdGFja1RyYWNlLnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25Ub1Byb21pc2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdC50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduT3V0cHV0LnRzIiwiLi4vLi4vc3JjL3V0aWxzL2JpblBhdGgudHMiLCIuLi8uLi9zcmMvdXRpbHMvY2xpQXJnc1BpcGUudHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoLnRzIiwiLi4vLi4vc3JjL3R1cmJvLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy91dGlscy9maW5kRGV2RGVwZW5kZW5jeS50cyIsIi4uLy4uL3NyYy9qZXN0L2xvYWRBbmRSdW5HbG9iYWxIb29rLnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdENvbmZpZ0hlbHBlcnMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIGlzVHJ1dGh5PFQ+KFxuICB2YWx1ZTogTm9uTnVsbGFibGU8VD4gfCBmYWxzZSB8IG51bGwgfCB1bmRlZmluZWQgfCAnJyB8IDBcbik6IHZhbHVlIGlzIE5vbk51bGxhYmxlPFQ+IHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUpO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIG9uY2U8VD4oZm46ICgpID0+IFQpOiAoKSA9PiBUIHtcbiAgbGV0IHZhbHVlOiBUO1xuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xuICByZXR1cm4gKCk6IFQgPT4ge1xuICAgIGlmIChjYWxjdWxhdGVkKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHZhbHVlID0gZm4oKTtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZUFzeW5jPFQ+KGZuOiAoKSA9PiBUIHwgUHJvbWlzZTxUPik6ICgpID0+IFByb21pc2U8VD4ge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBpbkZsaWdodDogUHJvbWlzZTxUPiB8IG51bGw7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiBhc3luYyAoKTogUHJvbWlzZTxUPiA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKGluRmxpZ2h0KSB7XG4gICAgICByZXR1cm4gaW5GbGlnaHQ7XG4gICAgfVxuICAgIGluRmxpZ2h0ID0gUHJvbWlzZS5yZXNvbHZlKGZuKCkpO1xuICAgIHZhbHVlID0gYXdhaXQgaW5GbGlnaHQ7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgaW5GbGlnaHQgPSBudWxsO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImltcG9ydCB7IG9uY2UgfSBmcm9tICdAdXRpbHMvdHMnO1xuXG5jb25zdCBsZXZlbHMgPSBbJ2RlYnVnJywgJ2luZm8nLCAnd2FybicsICdlcnJvcicsICdmYXRhbCddIGFzIGNvbnN0O1xuXG50eXBlIExvZ0xldmVsID0gdHlwZW9mIGxldmVsc1tudW1iZXJdO1xuXG50eXBlIFBhcmFtcyA9IFBhcmFtZXRlcnM8dHlwZW9mIGNvbnNvbGUubG9nPjtcblxudHlwZSBMb2dnZXIgPSB7XG4gIGxvZ0xldmVsOiBMb2dMZXZlbDtcbiAgZGVidWcoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgLy8gYWxpYXMgZm9yIGluZm9cbiAgbG9nKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgLy8gc3BlY2lhbCB0cmVhdG1lbnQsIGRpc2FibGVkIG9uIENJL1RUWVxuICB0aXAoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgZXJyb3IoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBmYXRhbCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG59O1xuXG5jb25zdCBlbmFibGVkTGV2ZWxzQWZ0ZXIgPSAobGV2ZWw6IExvZ0xldmVsIHwgJ29mZicpID0+IHtcbiAgaWYgKGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuICBjb25zdCBpbmRleCA9IGxldmVscy5maW5kSW5kZXgoKGl0ZW0pID0+IGl0ZW0gPT09IGxldmVsKTtcbiAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBsZXZlbCcpO1xuICB9XG4gIHJldHVybiBsZXZlbHMuc2xpY2UoaW5kZXgpO1xufTtcblxuY29uc3QgaXNMZXZlbCA9IChsZXZlbD86IHN0cmluZyk6IGxldmVsIGlzIExvZ0xldmVsID0+IHtcbiAgcmV0dXJuIGxldmVscy5pbmNsdWRlcyhsZXZlbCBhcyBMb2dMZXZlbCk7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlGcm9tUHJvY2Vzc0FyZ3MgPSAoXG4gIGFyZ3MgPSBwcm9jZXNzLmFyZ3Zcbik6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xuICBjb25zdCBpbmRleCA9IGFyZ3MuZmluZEluZGV4KCh2YWx1ZSkgPT4gdmFsdWUgPT09ICctLWxvZy1sZXZlbCcpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBjb25zdCBsZXZlbCA9IGFyZ3NbaW5kZXggKyAxXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgdmVyYm9zaXR5RnJvbUVudiA9ICgpOiBMb2dMZXZlbCB8ICdvZmYnIHwgdW5kZWZpbmVkID0+IHtcbiAgY29uc3QgbGV2ZWwgPSBwcm9jZXNzLmVudlsnTE9HX0xFVkVMJ107XG4gIGlmIChsZXZlbCA9PT0gJ3NpbGVudCcgfHwgbGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuICdvZmYnO1xuICB9XG4gIGlmICghaXNMZXZlbChsZXZlbCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBsZXZlbDtcbn07XG5cbmNvbnN0IGdldFZlcmJvc2l0eUNvbmZpZyA9ICgpID0+IHtcbiAgY29uc3QgYXJnc0xldmVsID0gdmVyYm9zaXR5RnJvbVByb2Nlc3NBcmdzKCk7XG4gIGNvbnN0IGVudkxldmVsID0gdmVyYm9zaXR5RnJvbUVudigpO1xuICByZXR1cm4gYXJnc0xldmVsID8/IGVudkxldmVsID8/ICdpbmZvJztcbn07XG5cbmNvbnN0IG5vb3AgPSAoLi4uX2FyZ3M6IFBhcmFtcykgPT4ge1xuICByZXR1cm47XG59O1xuXG5jb25zdCBsb2cgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XG4gIGNvbnNvbGUubG9nKC4uLmFyZ3MpO1xufTtcblxuY29uc3QgZXJyb3IgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XG4gIGNvbnNvbGUuZXJyb3IoLi4uYXJncyk7XG59O1xuXG5jb25zdCBzaG91bGRFbmFibGVUaXAgPSAoKSA9PiAhcHJvY2Vzcy5lbnZbJ0NJJ10gJiYgIXByb2Nlc3Muc3Rkb3V0LmlzVFRZO1xuXG5leHBvcnQgY29uc3QgY3JlYXRlTG9nZ2VyID0gKFxuICBkZXBzID0geyBnZXRWZXJib3NpdHlDb25maWcsIGxvZywgZXJyb3IsIHNob3VsZEVuYWJsZVRpcCB9XG4pID0+IHtcbiAgY29uc3QgbG9nTGV2ZWwgPSBkZXBzLmdldFZlcmJvc2l0eUNvbmZpZygpO1xuICBjb25zdCBlbmFibGVkID0gZW5hYmxlZExldmVsc0FmdGVyKGxvZ0xldmVsKTtcbiAgcmV0dXJuIGxldmVscy5yZWR1Y2UoXG4gICAgKGFjYywgbHZsKSA9PiB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5hY2MsXG4gICAgICAgIFtsdmxdOiBlbmFibGVkLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICA/IFsnZmF0YWwnLCAnZXJyb3InXS5pbmNsdWRlcyhsdmwpXG4gICAgICAgICAgICA/IGRlcHMuZXJyb3JcbiAgICAgICAgICAgIDogZGVwcy5sb2dcbiAgICAgICAgICA6IG5vb3AsXG4gICAgICB9O1xuICAgIH0sXG4gICAge1xuICAgICAgbG9nTGV2ZWwsXG4gICAgICBsb2c6IGVuYWJsZWQuaW5jbHVkZXMoJ2luZm8nKSA/IGRlcHMubG9nIDogbm9vcCxcbiAgICAgIHRpcDogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpICYmIGRlcHMuc2hvdWxkRW5hYmxlVGlwKCkgPyBkZXBzLmxvZyA6IG5vb3AsXG4gICAgfSBhcyBMb2dnZXJcbiAgKTtcbn07XG5cbmNvbnN0IGNyZWF0ZURlbGVnYXRpbmdMb2dnZXIgPSAob3B0czogeyBwYXJlbnQ6IExvZ2dlciB9KTogTG9nZ2VyID0+XG4gIE9iamVjdC5mcmVlemUoe1xuICAgIGdldCBsb2dMZXZlbCgpIHtcbiAgICAgIHJldHVybiBvcHRzLnBhcmVudC5sb2dMZXZlbDtcbiAgICB9LFxuICAgIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5kZWJ1ZyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgaW5mbyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuaW5mbyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgbG9nKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5sb2coLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQudGlwKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC53YXJuKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuZXJyb3IoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5mYXRhbCguLi5wYXJhbXMpO1xuICAgIH0sXG4gIH0pO1xuXG5sZXQgZGVmYXVsdExvZ2dlckZhY3Rvcnk6ICgoKSA9PiBMb2dnZXIpIHwgbnVsbDtcblxuZXhwb3J0IGNvbnN0IGNvbmZpZ3VyZURlZmF1bHRMb2dnZXIgPSAoZmFjdG9yeTogKCkgPT4gTG9nZ2VyKSA9PiB7XG4gIGlmIChkZWZhdWx0TG9nZ2VyRmFjdG9yeSkge1xuICAgIGNvbnN0IGVycm9yID0ge1xuICAgICAgc3RhY2s6ICcnLFxuICAgIH07XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UoZXJyb3IpO1xuICAgIGxvZ2dlci5kZWJ1ZygnQ2Fubm90IG92ZXJyaWRlIGRlZmF1bHQgbG9nZ2VyIG11bHRpcGxlIHRpbWVzJywgZXJyb3Iuc3RhY2spO1xuICAgIHJldHVybjtcbiAgfVxuICBkZWZhdWx0TG9nZ2VyRmFjdG9yeSA9IGZhY3Rvcnk7XG59O1xuXG5jb25zdCBkZWZhdWx0TG9nZ2VyID0gb25jZSgoKSA9PiB7XG4gIGxldCBmYWN0b3J5ID0gZGVmYXVsdExvZ2dlckZhY3Rvcnk7XG4gIGlmICghZmFjdG9yeSkge1xuICAgIGZhY3RvcnkgPSAoKSA9PiBjcmVhdGVMb2dnZXIoKTtcbiAgfVxuICByZXR1cm4gZmFjdG9yeSgpO1xufSk7XG5cbi8qKlxuICogRGVmYXVsdCBsb2dnZXIgaW5zdGFuY2UgY2FuIGJlIGNvbmZpZ3VyZWQgb25jZSBhdCBzdGFydHVwXG4gKi9cbmV4cG9ydCBjb25zdCBsb2dnZXI6IExvZ2dlciA9IGNyZWF0ZURlbGVnYXRpbmdMb2dnZXIoe1xuICBnZXQgcGFyZW50KCkge1xuICAgIHJldHVybiBkZWZhdWx0TG9nZ2VyKCk7XG4gIH0sXG59KTtcbiIsImltcG9ydCB7IHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGlzRGlyZWN0b3J5KHBhdGg6IHN0cmluZykge1xuICByZXR1cm4gc3RhdChwYXRoKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0RpcmVjdG9yeSgpKVxuICAgIC5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xufVxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmV4cG9ydCBjb25zdCBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCA9IChvcHRzOiB7XG4gIGltcG9ydE1ldGFVcmw6IHN0cmluZztcbn0pID0+IHtcbiAgLy8gdGhpcyBpcyBoaWdobHkgZGVwZW5kZW50IG9uIHRoZSBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZVxuICAvLyBhbmQgdGhlIGNvbnRleHQgaW4gd2hpY2ggdGhpcyBmdW5jdGlvbiBpcyBydW4gKGJ1bmRsZWQgY29kZSB2cyB0c3ggLi9zcmMvdHNmaWxlLnRzKVxuICBjb25zdCBfX2ZpbGVOYW1lID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICBjb25zdCBwYXJlbnQgPSBkaXJuYW1lKF9fZmlsZU5hbWUpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IGRpcm5hbWUocGFyZW50KTtcblxuICBjb25zdCBpc0J1bmRsZWRJbkRpc3QgPSAoKSA9PiBwYXJlbnQuZW5kc1dpdGgoJy9kaXN0Jyk7XG4gIGNvbnN0IGlzQnVuZGxlZEluQmluID0gKCkgPT5cbiAgICBwYXJlbnQuZW5kc1dpdGgoJy9iaW4nKSAmJiAhc3VwZXJQYXJlbnQuZW5kc1dpdGgoJy9zcmMnKTtcblxuICBpZiAoaXNCdW5kbGVkSW5EaXN0KCkgfHwgaXNCdW5kbGVkSW5CaW4oKSkge1xuICAgIHJldHVybiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICB9XG5cbiAgLy8gcnVuIHZpYSB0c3ggdG8gYnVpbGQgdGhlIEByZXBrYS1raXQvdHMgaXRzZWxmXG4gIHJldHVybiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uLy4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpO1xufTtcblxuZXhwb3J0IGNvbnN0IG1vZHVsZVJvb3REaXJlY3RvcnkgPSBvbmNlKCgpID0+XG4gIGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsKHsgaW1wb3J0TWV0YVVybDogaW1wb3J0Lm1ldGEudXJsIH0pXG4pO1xuIiwiaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG50eXBlIFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzID0ge1xuICBzdGFydDogc3RyaW5nO1xuICBzdG9wcz86IHN0cmluZ1tdO1xuICBhcHBlbmRQYXRoPzogc3RyaW5nO1xuICB0ZXN0OiAocGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPGJvb2xlYW4gfCBzdHJpbmcgfCB1bmRlZmluZWQ+O1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uKiB1cHdhcmREaXJlY3RvcnlXYWxrKG9wdHM6IFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzKSB7XG4gIGxldCBjdXJyZW50ID0gb3B0cy5zdGFydDtcbiAgd2hpbGUgKFxuICAgIGN1cnJlbnQgIT09ICcvJyAmJlxuICAgIGN1cnJlbnQgIT09ICd+LycgJiZcbiAgICAhKG9wdHMuc3RvcHM/LmluY2x1ZGVzKGN1cnJlbnQpID8/IGZhbHNlKVxuICApIHtcbiAgICBjb25zdCBwYXRoID0gb3B0cy5hcHBlbmRQYXRoID8gam9pbihjdXJyZW50LCBvcHRzLmFwcGVuZFBhdGgpIDogY3VycmVudDtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBhd2FpdCBvcHRzLnRlc3QocGF0aCk7XG4gICAgaWYgKGNhbmRpZGF0ZSkge1xuICAgICAgeWllbGQgdHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ3N0cmluZycgPyBjYW5kaWRhdGUgOiBwYXRoO1xuICAgIH1cbiAgICBjdXJyZW50ID0gZGlybmFtZShjdXJyZW50KTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXB3YXJkRGlyZWN0b3J5U2VhcmNoKG9wdHM6IFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzKSB7XG4gIGNvbnN0IHdhbGsgPSB1cHdhcmREaXJlY3RvcnlXYWxrKG9wdHMpO1xuICBmb3IgYXdhaXQgKGNvbnN0IGRpciBvZiB3YWxrKSB7XG4gICAgcmV0dXJuIGRpcjtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcbmltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBQYWNrYWdlSnNvbiB9IGZyb20gJy4vcGFja2FnZUpzb24nO1xuXG5jb25zdCBjd2RQYWNrYWdlSnNvblBhdGggPSAoKSA9PiBqb2luKHByb2Nlc3MuY3dkKCksICcuL3BhY2thZ2UuanNvbicpO1xuXG5hc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb25BdChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIHJldHVybiBhd2FpdCByZWFkRmlsZShwYXRoLCAndXRmLTgnKS50aGVuKFxuICAgIChyZXN1bHQpID0+IEpTT04ucGFyc2UocmVzdWx0KSBhcyBQYWNrYWdlSnNvblxuICApO1xufVxuXG5leHBvcnQgY29uc3QgcmVhZEN3ZFBhY2thZ2VKc29uID0gb25jZUFzeW5jKCgpID0+XG4gIHJlYWRQYWNrYWdlSnNvbkF0KGN3ZFBhY2thZ2VKc29uUGF0aCgpKVxuKTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbihwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIC8vIGFzc3VtaW5nIGN1cnJlbnQgZGlyZWN0b3J5IGRvZXNuJ3QgY2hhbmdlIHdoaWxlIGFwcCBpcyBydW5uaW5nXG4gIHJldHVybiBwcm9jZXNzLmN3ZCgpID09PSBjd2RQYWNrYWdlSnNvblBhdGgoKVxuICAgID8gYXdhaXQgcmVhZEN3ZFBhY2thZ2VKc29uKClcbiAgICA6IGF3YWl0IHJlYWRQYWNrYWdlSnNvbkF0KHBhdGgpO1xufVxuIiwiLyoqXG4gKiBDYXB0dXJlIHRoZSBzdGFjayB0cmFjZSBhbmQgYWxsb3cgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgdGhyb3duIGluIGFzeW5jaHJvbm91cyBjYWxsYmFja3NcbiAqIHdpdGggYWRkaXRpb25hbCBzdGFjayBpbmZvcm1hdGlvbiBjYXB0dXJlZCBhdCB0aGUgbW9tZW50IG9mIHRoZSBjYWxsIG9mIHRoaXMgZnVuY3Rpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhcHR1cmVTdGFja1RyYWNlKHJlbW92ZSA9IDApIHtcbiAgY29uc3Qgc3RhY2tDb250YWluZXIgPSB7XG4gICAgc3RhY2s6ICcnLFxuICB9O1xuICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShzdGFja0NvbnRhaW5lcik7XG4gIGNvbnN0IHN0YWNrVHJhY2UgPSBzdGFja0NvbnRhaW5lci5zdGFja1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuc2xpY2UoNiArIHJlbW92ZSlcbiAgICAuam9pbignXFxuJyk7XG4gIHJldHVybiB7XG4gICAgLyoqXG4gICAgICogQ2FwdHVyZWQgc3RhY2sgdHJhY2UgaW5mb3JtYXRpb25cbiAgICAgKi9cbiAgICBzdGFja1RyYWNlLFxuICAgIC8qKlxuICAgICAqIENhbiBiZSBjYWxsZWQgaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrIHRvIGVucmljaCBleGNlcHRpb25zIHdpdGggYWRkaXRpb25hbCBpbmZvcm1hdGlvblxuICAgICAqIEBwYXJhbSBlcnIgRXhjZXB0aW9uIHRvIGVucmljaCAtIGl0IGlzIGdvaW5nIHRvIGhhdmUgaXRzIGAuc3RhY2tgIHByb3AgbXV0YXRlZFxuICAgICAqIEByZXR1cm5zIFNhbWUgZXhjZXB0aW9uXG4gICAgICovXG4gICAgcHJlcGFyZUZvclJldGhyb3c6IChlcnI6IEVycm9yKSA9PiB7XG4gICAgICBjb25zdCBvbGRTdGFja1RyYWNlID0gZXJyLnN0YWNrID8/ICcnLnNwbGl0KCdcXG4nKS5zbGljZSgxKS5qb2luKCdcXG4nKTtcbiAgICAgIGVyci5zdGFjayA9IGAke2Vyci5uYW1lIHx8ICdFcnJvcid9OiAke1xuICAgICAgICBlcnIubWVzc2FnZVxuICAgICAgfVxcbiR7b2xkU3RhY2tUcmFjZX1cXG4ke3N0YWNrVHJhY2V9YDtcbiAgICAgIHJldHVybiBlcnI7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHNwYXduIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IEFzc2lnbiB9IGZyb20gJ3V0aWxpdHktdHlwZXMnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IGNhcHR1cmVTdGFja1RyYWNlIH0gZnJvbSAnLi4vdXRpbHMvc3RhY2tUcmFjZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduVG9Qcm9taXNlT3B0cyA9IHtcbiAgLyoqXG4gICAqIFNwZWNpZnkgZXhpdCBjb2RlcyB3aGljaCBzaG91bGQgbm90IHJlc3VsdCBpbiB0aHJvd2luZyBhbiBlcnJvciB3aGVuXG4gICAqIHRoZSBwcm9jZXNzIGhhcyBmaW5pc2hlZCwgZS5nLiBzcGVjaWZ5aW5nIGBbMF1gIG1lYW5zIGlmIHByb2Nlc3MgZmluaXNoZWRcbiAgICogd2l0aCB6ZXJvIGV4aXQgY29kZSB0aGVuIHRoZSBwcm9taXNlIHdpbGwgcmVzb2x2ZSBpbnN0ZWFkIG9mIHJlamVjdGluZy5cbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgc3BlY2lmeSBgaW5oZXJpdGAgdG8gc2F2ZSBzdGF0dXMgY29kZSB0byB0aGUgY3VycmVudCBgcHJvY2Vzcy5leGl0Q29kZWBcbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgY29tcGxldGVseSBpZ25vcmUgdGhlIGV4aXQgY29kZSAoZS5nLiB5b3UgZm9sbG93IHVwIGFuZCBpbnRlcnJvZ2F0ZVxuICAgKiB0aGUgcHJvY2VzcyBjb2RlIG1hbnVhbGx5IGFmdGVyd2FyZHMpXG4gICAqL1xuICBleGl0Q29kZXM6IG51bWJlcltdIHwgJ2luaGVyaXQnIHwgJ2FueSc7XG59O1xuXG50eXBlIFNoYXJlZE9wdHMgPSBQaWNrPFNwYXduT3B0aW9ucywgJ2N3ZCc+O1xuXG50eXBlIFNwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PiA9IFtcbiAgY29tbWFuZDogc3RyaW5nLFxuICBhcmdzOiBSZWFkb25seUFycmF5PHN0cmluZz4sXG4gIG9wdGlvbnM6IEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+XG5dO1xuXG5leHBvcnQgdHlwZSBTcGF3bk9wdGlvbnNXaXRoRXh0cmE8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICBBc3NpZ248U3Bhd25PcHRpb25zLCBFPjtcblxuZXhwb3J0IHR5cGUgU3Bhd25QYXJhbWV0ZXJNaXg8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICB8IFtjcDogQ2hpbGRQcm9jZXNzLCBleHRyYU9wdHM6IEFzc2lnbjxFLCBTaGFyZWRPcHRzPl1cbiAgfCBTcGF3bkFyZ3M8RT47XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgYXJnczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbik6IGFyZ3MgaXMgU3Bhd25BcmdzPEU+IHtcbiAgcmV0dXJuICEoYXJnc1swXSBpbnN0YW5jZW9mIENoaWxkUHJvY2VzcykgJiYgdHlwZW9mIGFyZ3NbMF0gPT09ICdzdHJpbmcnO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzPEUgZXh0ZW5kcyBvYmplY3Q+KFxuICBwYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxFPlxuKSB7XG4gIGNvbnN0IFtjaGlsZCwgW2NvbW1hbmQsIGFyZ3MsIG9wdHNdXSA9IGlzU3Bhd25BcmdzKHBhcmFtZXRlcnMpXG4gICAgPyBbXG4gICAgICAgIHNwYXduKC4uLihwYXJhbWV0ZXJzIGFzIHVua25vd24gYXMgUGFyYW1ldGVyczx0eXBlb2Ygc3Bhd24+KSksXG4gICAgICAgIHBhcmFtZXRlcnMsXG4gICAgICBdXG4gICAgOiBbXG4gICAgICAgIHBhcmFtZXRlcnNbMF0sXG4gICAgICAgIFtcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduZmlsZSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduYXJncy5zbGljZSgxKSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzFdIGFzIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+LFxuICAgICAgICBdLFxuICAgICAgXTtcbiAgcmV0dXJuIHtcbiAgICBjaGlsZCxcbiAgICBjb21tYW5kLFxuICAgIGFyZ3MsXG4gICAgb3B0cyxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduVG9Qcm9taXNlKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHsgY2hpbGQsIGNvbW1hbmQsIGFyZ3MsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgeyBwcmVwYXJlRm9yUmV0aHJvdyB9ID0gY2FwdHVyZVN0YWNrVHJhY2UoKTtcblxuICBjb25zdCBleGl0Q29kZXMgPSBvcHRzLmV4aXRDb2RlcztcblxuICBjb25zdCBjd2QgPSBvcHRzLmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY21kID0gKCkgPT4gW2NvbW1hbmQsIC4uLmFyZ3NdLmpvaW4oJyAnKTtcblxuICBsb2dnZXIuZGVidWcoWyc+JywgY21kKCldLmpvaW4oJyAnKSwgLi4uKGN3ZCA/IFtgaW4gJHtjd2R9YF0gOiBbXSkpO1xuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMsIHJlaikgPT5cbiAgICBjaGlsZFxuICAgICAgLm9uKCdjbG9zZScsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGV4aXRDb2RlcyAhPT0gJ2luaGVyaXQnICYmXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdhbnknICYmXG4gICAgICAgICAgICAhZXhpdENvZGVzLmluY2x1ZGVzKGNvZGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZWooXG4gICAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihgQ29tbWFuZCBcIiR7Y21kKCl9XCIgaGFzIGZhaWxlZCB3aXRoIGNvZGUgJHtjb2RlfWApXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgICByZWooXG4gICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBGYWlsZWQgdG8gZXhlY3V0ZSBjb21tYW5kIFwiJHtjbWQoKX1cIiAtICR7c2lnbmFsfWApXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLm9uKCdlcnJvcicsIHJlailcbiAgKTtcbiAgLy8gaW5oZXJpdCBleGl0IGNvZGVcbiAgaWYgKGV4aXRDb2RlcyA9PT0gJ2luaGVyaXQnKSB7XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIGNoaWxkLmV4aXRDb2RlID09PSAnbnVtYmVyJyAmJlxuICAgICAgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJyB8fCBwcm9jZXNzLmV4aXRDb2RlID09PSAwKVxuICAgICkge1xuICAgICAgcHJvY2Vzcy5leGl0Q29kZSA9IGNoaWxkLmV4aXRDb2RlO1xuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuXG5pbXBvcnQgdHlwZSB7IFNwYXduUGFyYW1ldGVyTWl4LCBTcGF3blRvUHJvbWlzZU9wdHMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcblxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRPcHRzID0ge1xuICBvdXRwdXQ/OlxuICAgIHwgQXJyYXk8J3N0ZG91dCcgfCAnc3RkZXJyJz5cbiAgICB8IFsnc3Rkb3V0JyB8ICdzdGRlcnInLCAuLi5BcnJheTwnc3Rkb3V0JyB8ICdzdGRlcnInPl07XG4gIGJ1ZmZlcnM/OiB7XG4gICAgY29tYmluZWQ/OiBzdHJpbmdbXTtcbiAgICBzdGRvdXQ/OiBzdHJpbmdbXTtcbiAgICBzdGRlcnI/OiBzdHJpbmdbXTtcbiAgfTtcbn0gJiBTcGF3blRvUHJvbWlzZU9wdHM7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0UmV0dXJuID0ge1xuICBwaWQ/OiBudW1iZXI7XG4gIG91dHB1dDogc3RyaW5nW107XG4gIHN0ZG91dDogc3RyaW5nO1xuICBzdGRlcnI6IHN0cmluZztcbiAgc3RhdHVzOiBudW1iZXIgfCBudWxsO1xuICBzaWduYWw6IE5vZGVKUy5TaWduYWxzIHwgbnVsbDtcbiAgZXJyb3I/OiBFcnJvciB8IHVuZGVmaW5lZDtcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blJlc3VsdChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxTcGF3blJlc3VsdFJldHVybj4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IGNvbWJpbmVkRGF0YTogc3RyaW5nW10gPSBvcHRzLmJ1ZmZlcnM/LmNvbWJpbmVkID8/IFtdO1xuICBjb25zdCBzdGRvdXREYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3Rkb3V0ID8/IFtdO1xuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3RkZXJyID8/IFtdO1xuICBjb25zdCBvdXRwdXQgPSBvcHRzLm91dHB1dCA/PyBbJ3N0ZG91dCcsICdzdGRlcnInXTtcbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3Rkb3V0JykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZG91dCxcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRvdXRcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRvdXREYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3RkZXJyJykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZGVycixcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRlcnJcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3NwYXduVG9Qcm9taXNlKGNoaWxkLCBvcHRzKV0pO1xuICByZXR1cm4ge1xuICAgIHBpZDogY2hpbGQucGlkLFxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcbiAgICBzdGF0dXM6IGNoaWxkLmV4aXRDb2RlLFxuICAgIGdldCBvdXRwdXQoKSB7XG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xuICAgIH0sXG4gICAgZ2V0IHN0ZGVycigpIHtcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IHN0ZG91dCgpIHtcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IGVycm9yKCkge1xuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcbiAgICAgICAgPyAocmVzdWx0LnJlYXNvbiBhcyBFcnJvcilcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMsIFNwYXduUmVzdWx0UmV0dXJuIH0gZnJvbSAnLi9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBzcGF3blJlc3VsdCB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwgb3B0cyk7XG4gIHJldHVybiByZXN1bHQub3V0cHV0LmpvaW4oJycpO1xufVxuXG5jb25zdCBkZWZhdWx0U2hvdWxkT3V0cHV0ID0gKHJlc3VsdDogU3Bhd25SZXN1bHRSZXR1cm4pID0+IHtcbiAgcmV0dXJuIHJlc3VsdC5lcnJvciB8fCByZXN1bHQuc3RhdHVzICE9PSAwIHx8IGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJztcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxcbiAgICBTcGF3blJlc3VsdE9wdHMgJiB7XG4gICAgICAvKipcbiAgICAgICAqIEJ5IGRlZmF1bHQgd2lsbCBvdXRwdXQgdG8gYHN0ZGVycmAgd2hlbiBzcGF3biByZXN1bHQgZmFpbGVkIHdpdGggYW4gZXJyb3IsIHdoZW5cbiAgICAgICAqIHN0YXR1cyBjb2RlIGlzIG5vdCB6ZXJvIG9yIHdoZW4gYExvZ2dlci5sb2dMZXZlbGAgaXMgYGRlYnVnYFxuICAgICAgICovXG4gICAgICBzaG91bGRPdXRwdXQ/OiAocmVzdWx0OiBTcGF3blJlc3VsdFJldHVybikgPT4gYm9vbGVhbjtcbiAgICB9XG4gID5cbikge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcbiAgY29uc3Qgc2hvdWxkT3V0cHV0ID0gb3B0cy5zaG91bGRPdXRwdXQgPz8gZGVmYXVsdFNob3VsZE91dHB1dDtcbiAgaWYgKHNob3VsZE91dHB1dChyZXN1bHQpKSB7XG4gICAgbG9nZ2VyLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xuICB9XG4gIGlmIChyZXN1bHQuZXJyb3IpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG59XG4iLCJpbXBvcnQgeyByZWFkRmlsZSwgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuL21vZHVsZVJvb3REaXJlY3RvcnknO1xuXG5hc3luYyBmdW5jdGlvbiBpc0ZpbGUoZmlsZVBhdGg6IHN0cmluZykge1xuICByZXR1cm4gYXdhaXQgc3RhdChmaWxlUGF0aClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24qIGl0ZXJhdGVOb2RlTW9kdWxlcyhzdGFydFdpdGg6IHN0cmluZywgcGF0aDogc3RyaW5nKSB7XG4gIGxldCBjdXJyZW50ID0gc3RhcnRXaXRoO1xuICB3aGlsZSAoY3VycmVudCAhPT0gJy8nICYmIGN1cnJlbnQgIT09ICd+LycpIHtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBqb2luKGN1cnJlbnQsICdub2RlX21vZHVsZXMnLCBwYXRoKTtcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGNhbmRpZGF0ZSkpIHtcbiAgICAgIHlpZWxkIGNhbmRpZGF0ZTtcbiAgICB9XG4gICAgY3VycmVudCA9IGRpcm5hbWUoY3VycmVudCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmluZEJpblNjcmlwdChzdGFydFdpdGg6IHN0cmluZywgYmluU2NyaXB0UGF0aDogc3RyaW5nKSB7XG4gIGZvciBhd2FpdCAoY29uc3QgcGF0aCBvZiBpdGVyYXRlTm9kZU1vZHVsZXMoc3RhcnRXaXRoLCBiaW5TY3JpcHRQYXRoKSkge1xuICAgIHJldHVybiBwYXRoO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBiaW5QYXRoKG9wdHM6IHtcbiAgYmluTmFtZTogc3RyaW5nO1xuICBiaW5TY3JpcHRQYXRoOiBzdHJpbmc7XG4gIHVzZVNob3J0Y3V0PzogYm9vbGVhbjtcbn0pIHtcbiAgY29uc3QgdXNlU2hvcnRjdXQgPSBvcHRzLnVzZVNob3J0Y3V0ID8/IHRydWU7XG4gIGNvbnN0IHJvb3QgPSBtb2R1bGVSb290RGlyZWN0b3J5KCk7XG4gIGlmICh1c2VTaG9ydGN1dCkge1xuICAgIGNvbnN0IGJlc3RHdWVzcyA9IGpvaW4ocm9vdCwgJ25vZGVfbW9kdWxlcycsICcuYmluJywgb3B0cy5iaW5OYW1lKTtcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGJlc3RHdWVzcykpIHtcbiAgICAgIHJldHVybiBiZXN0R3Vlc3M7XG4gICAgfVxuICB9XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZpbmRCaW5TY3JpcHQocm9vdCwgb3B0cy5iaW5TY3JpcHRQYXRoKTtcbiAgaWYgKHJlc3VsdCkge1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgZmluZCBiaW4gJHtvcHRzLmJpbk5hbWV9YCk7XG59XG5cbmZ1bmN0aW9uIHNjcmlwdEZyb21QYWNrYWdlSnNvbihvcHRzOiB7XG4gIGJpbk5hbWU6IHN0cmluZztcbiAgcGFja2FnZUpzb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufSkge1xuICBjb25zdCBjYW5kaWRhdGUgPSBvcHRzLnBhY2thZ2VKc29uWydiaW4nXTtcbiAgaWYgKHR5cGVvZiBjYW5kaWRhdGUgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgY2FuZGlkYXRlID09PSAnb2JqZWN0JyAmJiBjYW5kaWRhdGUgIT09IG51bGwpIHtcbiAgICBjb25zdCBlbnRyeSA9IChjYW5kaWRhdGUgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPilbb3B0cy5iaW5OYW1lXTtcbiAgICBpZiAodHlwZW9mIGVudHJ5ID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGVudHJ5O1xuICAgIH1cbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGV0ZXJtaW5lQmluU2NyaXB0UGF0aChvcHRzOiB7XG4gIGJpbk5hbWU6IHN0cmluZztcbiAgYmluUGFja2FnZU5hbWU6IHN0cmluZztcbn0pIHtcbiAgZm9yIGF3YWl0IChjb25zdCBwYXRoIG9mIGl0ZXJhdGVOb2RlTW9kdWxlcyhcbiAgICBtb2R1bGVSb290RGlyZWN0b3J5KCksXG4gICAgam9pbihvcHRzLmJpblBhY2thZ2VOYW1lLCAncGFja2FnZS5qc29uJylcbiAgKSkge1xuICAgIGNvbnN0IHBrZyA9IGF3YWl0IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpXG4gICAgICAudGhlbigodGV4dCkgPT4gSlNPTi5wYXJzZSh0ZXh0KSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgIC5jYXRjaCgoKSA9PiBudWxsKTtcbiAgICBpZiAoIXBrZykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc2NyaXB0UGF0aCA9IHNjcmlwdEZyb21QYWNrYWdlSnNvbih7XG4gICAgICBiaW5OYW1lOiBvcHRzLmJpbk5hbWUsXG4gICAgICBwYWNrYWdlSnNvbjogcGtnLFxuICAgIH0pO1xuICAgIGlmICghc2NyaXB0UGF0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgY2FuZGlkYXRlID0gam9pbihkaXJuYW1lKHBhdGgpLCBzY3JpcHRQYXRoKTtcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGNhbmRpZGF0ZSkpIHtcbiAgICAgIHJldHVybiBqb2luKG9wdHMuYmluUGFja2FnZU5hbWUsIHNjcmlwdFBhdGgpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIGluY2x1ZGVzQW55T2YodGFyZ2V0OiBzdHJpbmdbXSwgaGFzQW55T2ZBcmdzOiBzdHJpbmdbXSkge1xuICByZXR1cm4gaGFzQW55T2ZBcmdzLnNvbWUoKHZhcmlhbnQpID0+IHRhcmdldC5pbmNsdWRlcyh2YXJpYW50KSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbnNlcnRBZnRlckFueU9mKFxuICB0YXJnZXQ6IHN0cmluZ1tdLFxuICBpbnNlcnQ6IHN0cmluZ1tdLFxuICBoYXNBbnlPZkFyZ3M6IHN0cmluZ1tdXG4pIHtcbiAgY29uc3QgaW5kZXggPSB0YXJnZXQuZmluZEluZGV4KCh2YWx1ZSkgPT4gaGFzQW55T2ZBcmdzLmluY2x1ZGVzKHZhbHVlKSk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICByZXR1cm4gdGFyZ2V0O1xuICB9XG4gIGNvbnN0IHJlc3VsdCA9IFsuLi50YXJnZXRdO1xuICByZXN1bHQuc3BsaWNlKGluZGV4ICsgMSwgMCwgLi4uaW5zZXJ0KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUFyZ3NGcm9tKFxuICB0YXJnZXQ6IHN0cmluZ1tdLFxuICBhcmdzOiBBcnJheTxzdHJpbmcgfCBSZWdFeHA+LFxuICBvcHRzPzogeyBudW1WYWx1ZXM6IG51bWJlciB9XG4pIHtcbiAgY29uc3QgcmVzdWx0ID0gWy4uLnRhcmdldF07XG4gIGZvciAoY29uc3QgYXJnIG9mIGFyZ3MpIHtcbiAgICBjb25zdCBpbmRleCA9IHRhcmdldC5maW5kSW5kZXgoKHZhbHVlKSA9PlxuICAgICAgdHlwZW9mIGFyZyA9PT0gJ3N0cmluZycgPyB2YWx1ZSA9PT0gYXJnIDogYXJnLnRlc3QodmFsdWUpXG4gICAgKTtcbiAgICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgICByZXN1bHQuc3BsaWNlKGluZGV4LCBvcHRzPy5udW1WYWx1ZXMgPyBvcHRzLm51bVZhbHVlcyArIDEgOiAxKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUlucHV0QXJncyhcbiAgYXJnczogQXJyYXk8c3RyaW5nIHwgUmVnRXhwPixcbiAgb3B0cz86IHsgbnVtVmFsdWVzOiBudW1iZXIgfVxuKSB7XG4gIHJldHVybiAoc3RhdGU6IENsaUFyZ3MpID0+IHtcbiAgICByZXR1cm4ge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBpbnB1dEFyZ3M6IHJlbW92ZUFyZ3NGcm9tKHN0YXRlLmlucHV0QXJncywgYXJncywgb3B0cyksXG4gICAgfTtcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNldERlZmF1bHRBcmdzKFxuICBhcmdzOiBbc3RyaW5nLCAuLi5zdHJpbmdbXV0sXG4gIHZhbHVlczogc3RyaW5nW10gPSBbXSxcbiAgY29uZGl0aW9uPzogKHN0YXRlOiBDbGlBcmdzKSA9PiBib29sZWFuLFxuICBhcHBseT86IChhcmdzOiBzdHJpbmdbXSwgc3RhdGU6IENsaUFyZ3MpID0+IENsaUFyZ3Ncbikge1xuICByZXR1cm4gKHN0YXRlOiBDbGlBcmdzKSA9PiB7XG4gICAgaWYgKGNvbmRpdGlvbikge1xuICAgICAgaWYgKCFjb25kaXRpb24oc3RhdGUpKSB7XG4gICAgICAgIHJldHVybiBzdGF0ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGluY2x1ZGVzQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBhcmdzKSkge1xuICAgICAgcmV0dXJuIHN0YXRlO1xuICAgIH1cbiAgICBjb25zdCBzZXQ6IE5vbk51bGxhYmxlPHR5cGVvZiBhcHBseT4gPSBhcHBseVxuICAgICAgPyBhcHBseVxuICAgICAgOiAoYXJncywgdG8pID0+ICh7XG4gICAgICAgICAgLi4udG8sXG4gICAgICAgICAgcHJlQXJnczogWy4uLnN0YXRlLnByZUFyZ3MsIC4uLmFyZ3NdLFxuICAgICAgICB9KTtcbiAgICByZXR1cm4gc2V0KFthcmdzWzBdLCAuLi52YWx1ZXNdLCBzdGF0ZSk7XG4gIH07XG59XG5cbmV4cG9ydCBjb25zdCByZW1vdmVMb2dMZXZlbE9wdGlvbiA9ICgpID0+XG4gIHJlbW92ZUlucHV0QXJncyhbJy0tbG9nLWxldmVsJ10sIHsgbnVtVmFsdWVzOiAxIH0pO1xuXG5leHBvcnQgdHlwZSBDbGlBcmdzID0ge1xuICAvKipcbiAgICogRXh0cmEgYXJndW1lbnRzIHRoYXQgZ28gYmVmb3JlIGFyZ3VtZW50cyBwYXNzZWQgaW4gYnkgdGhlIHVzZXJcbiAgICovXG4gIHByZUFyZ3M6IHN0cmluZ1tdO1xuICAvKipcbiAgICogQXJndW1lbnRzIGFzIHBhc3NlZCBpbiBieSB0aGUgdXNlciwgY291bGQgYmUgbW9kaWZpZWQgYnlcbiAgICogdHJhbnNmb3JtcyB0aGF0IGNvbWUgYmVmb3JlIGN1cnJlbnRcbiAgICovXG4gIGlucHV0QXJnczogc3RyaW5nW107XG4gIC8qKlxuICAgKiBFeHRyYSBhcmd1bWVudHMgdGhhdCBnbyBhZnRlciBhcmd1bWVudHMgcGFzc2VkIGluIGJ5IHRoZSB1c2VyXG4gICAqL1xuICBwb3N0QXJnczogc3RyaW5nW107XG59O1xuXG5leHBvcnQgdHlwZSBDbGlBcmdzVHJhbnNmb3JtID0gKHN0YXRlOiBDbGlBcmdzKSA9PiBDbGlBcmdzO1xuXG5leHBvcnQgZnVuY3Rpb24gY2xpQXJnc1BpcGUoXG4gIHRyYW5zZm9ybXM6IENsaUFyZ3NUcmFuc2Zvcm1bXSxcbiAgaW5wdXRBcmdzOiBzdHJpbmdbXVxuKSB7XG4gIGNvbnN0IHtcbiAgICBwcmVBcmdzLFxuICAgIGlucHV0QXJnczogbW9kaWZpZWRJbnB1dEFyZ3MsXG4gICAgcG9zdEFyZ3MsXG4gIH0gPSB0cmFuc2Zvcm1zLnJlZHVjZTxDbGlBcmdzPigoYWNjLCB0cmFuc2Zvcm0pID0+IHRyYW5zZm9ybShhY2MpLCB7XG4gICAgaW5wdXRBcmdzLFxuICAgIHByZUFyZ3M6IFtdLFxuICAgIHBvc3RBcmdzOiBbXSxcbiAgfSk7XG4gIHJldHVybiBbLi4ucHJlQXJncywgLi4ubW9kaWZpZWRJbnB1dEFyZ3MsIC4uLnBvc3RBcmdzXTtcbn1cbiIsImltcG9ydCB7IGlzVHJ1dGh5LCBvbmNlQXN5bmMgfSBmcm9tICdAdXRpbHMvdHMnO1xuaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0JztcbmltcG9ydCB7IGRpcm5hbWUsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5jb25zdCBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzID0gKGN1cnJlbnREaXJlY3Rvcnk6IHN0cmluZykgPT4ge1xuICAvLyBoYXZpbmcgJ3BhY2thZ2VzLyonIGluIHRoZSByb290IG9mIGEgbW9ub3JlcG8gaXMgc3VwZXIgY29tbW9uXG4gIGNvbnN0IHJlc3VsdCA9IC8oLiooPz1cXC9wYWNrYWdlc1xcLykpfCguKig/PVxcL25vZGVfbW9kdWxlc1xcLykpfCguKikvLmV4ZWMoXG4gICAgY3VycmVudERpcmVjdG9yeVxuICApO1xuICBhc3NlcnQoISFyZXN1bHQpO1xuICBjb25zdCBbLCBwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdF0gPSByZXN1bHQ7XG4gIHJldHVybiBbcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdLmZpbHRlcihpc1RydXRoeSk7XG59O1xuXG4vLyByZXR1cm5zIHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2hpY2ggaGFzIG1vbm9yZXBvIG1hcmtlcnMsIG11bHRpcGxlXG4vLyBkaXJlY3RvcmllcyBjYW4gaGF2ZSB0aGVtIC0gd2hpY2hldmVyIHJlYWQgZmlyc3Qgd2lsbCBiZSByZXR1cm5lZFxuLy8gc28gaWYgb3JkZXIgaXMgaW1wb3J0YW50IC0gc2Nhbm5pbmcgc2hvdWxkIGJlIHNlcGFyYXRlZCB0byBtdWx0aXBsZSBqb2JzXG4vLyB2aWEgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnNcbmNvbnN0IGhhc1Jvb3RNYXJrZXJzID0gYXN5bmMgKGNhbmRpZGF0ZXM6IHN0cmluZ1tdKSA9PiB7XG4gIGNvbnN0IG1hcmtlcnMgPSBbXG4gICAgJy5naXQnLFxuICAgICd5YXJuLmxvY2snLFxuICAgICdwbnBtLWxvY2sueWFtbCcsXG4gICAgJ3BhY2thZ2UtbG9jay5qc29uJyxcbiAgICAncG5wbS13b3Jrc3BhY2UueWFtbCcsXG4gIF07XG4gIGNvbnN0IG1hcmtlcnNTdHJlYW0gPSBmZy5zdHJlYW0oXG4gICAgY2FuZGlkYXRlcy5mbGF0TWFwKChkaXIpID0+IG1hcmtlcnMubWFwKChtYXJrZXIpID0+IGpvaW4oZGlyLCBtYXJrZXIpKSksXG4gICAge1xuICAgICAgbWFya0RpcmVjdG9yaWVzOiB0cnVlLFxuICAgICAgb25seUZpbGVzOiBmYWxzZSxcbiAgICB9XG4gICk7XG4gIGZvciBhd2FpdCAoY29uc3QgZW50cnkgb2YgbWFya2Vyc1N0cmVhbSkge1xuICAgIGFzc2VydCh0eXBlb2YgZW50cnkgPT09ICdzdHJpbmcnKTtcbiAgICByZXR1cm4gZGlybmFtZShlbnRyeSk7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbmNvbnN0IHByaW9yaXRpemVkSGFzTWFya2VycyA9IChqb2JzOiBzdHJpbmdbXVtdKSA9PiB7XG4gIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgfVxuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPigocmVzKSA9PiB7XG4gICAgY29uc3QgcmVzdWx0cyA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmcgfCB1bmRlZmluZWQ+KCk7XG5cbiAgICBjb25zdCBjaGVja1Nob3VsZENvbXBsZXRlID0gKGluZGV4OiBudW1iZXIsIHJlc3VsdDogc3RyaW5nIHwgdW5kZWZpbmVkKSA9PiB7XG4gICAgICByZXN1bHRzLnNldChpbmRleCwgcmVzdWx0KTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgam9icy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBoYXNSZXN1bHQgPSByZXN1bHRzLmhhcyhpKTtcbiAgICAgICAgaWYgKCFoYXNSZXN1bHQpIHtcbiAgICAgICAgICAvLyBpZiBhIGpvYiB3aXRoIGhpZ2hlc3QgcHJpb3JpdHkgaGFzbid0IGZpbmlzaGVkIHlldFxuICAgICAgICAgIC8vIHRoZW4gd2FpdCBmb3IgaXRcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXN1bHQgPSByZXN1bHRzLmdldChpKTtcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIC8vIGpvYiBmaW5pc2hlZCBhbmQgd2UgZm91bmQgbWFya2VycywgYWxzbyBhbGwgam9ic1xuICAgICAgICAgIC8vIHdpdGggaGlnaGVyIHByaW9yaXR5IGZpbmlzaGVkIGFuZCB0aGV5IGRvbid0IGhhdmVcbiAgICAgICAgICAvLyBhbnkgbWFya2VycyAtIHdlIGFyZSBkb25lXG4gICAgICAgICAgcmVzKHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHRzLnNpemUgPT09IGpvYnMubGVuZ3RoKSB7XG4gICAgICAgIC8vIGFsbCBqb2JzIGZpbmlzaGVkIC0gbm8gbWFya2VycyBmb3VuZFxuICAgICAgICByZXModW5kZWZpbmVkKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgam9icy5mb3JFYWNoKChkaXJlY3RvcmllcywgaW5kZXgpID0+IHtcbiAgICAgIGhhc1Jvb3RNYXJrZXJzKGRpcmVjdG9yaWVzKVxuICAgICAgICAudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgICAgY2hlY2tTaG91bGRDb21wbGV0ZShpbmRleCwgcmVzdWx0KTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBpZ25vcmVcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn07XG5cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuID0gYXN5bmMgKFxuICBsb29rdXBEaXJlY3Rvcnk6IHN0cmluZ1xuKSA9PiB7XG4gIGNvbnN0IHVuaXF1ZURpcm5hbWUgPSAocGF0aD86IHN0cmluZykgPT4ge1xuICAgIGlmICghcGF0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBkaXJuYW1lKHBhdGgpO1xuICAgIGlmIChyZXN1bHQgPT09IHBhdGgpIHtcbiAgICAgIC8vIGUuZy4gdGhlIHBhdGggd2FzIGFscmVhZHkgYSByb290IFwiL1wiXG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgY29uc3QgcGFyZW50ID0gdW5pcXVlRGlybmFtZShsb29rdXBEaXJlY3RvcnkpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IHVuaXF1ZURpcm5hbWUocGFyZW50KTtcblxuICByZXR1cm4gKFxuICAgIChhd2FpdCBwcmlvcml0aXplZEhhc01hcmtlcnMoXG4gICAgICAvLyBzY2FuIGluIG1vc3QgbGlrZWx5IGxvY2F0aW9ucyBmaXJzdCB3aXRoIGN1cnJlbnQgbG9va3VwIGRpcmVjdG9yeSB0YWtpbmcgcHJpb3JpdHlcbiAgICAgIFtcbiAgICAgICAgW2xvb2t1cERpcmVjdG9yeV0sXG4gICAgICAgIGdldFJlcG9zaXRvcnlSb290U2NhbkNhbmRpZGF0ZXMobG9va3VwRGlyZWN0b3J5KSxcbiAgICAgICAgLy8gc2NhbiAyIGRpcmVjdG9yaWVzIHVwd2FyZHNcbiAgICAgICAgW3BhcmVudF0sXG4gICAgICAgIFtzdXBlclBhcmVudF0sXG4gICAgICBdXG4gICAgICAgIC5tYXAoKGRpcnMpID0+IGRpcnMuZmlsdGVyKGlzVHJ1dGh5KSlcbiAgICAgICAgLmZpbHRlcigoam9iKSA9PiBqb2IubGVuZ3RoID4gMClcbiAgICApKSB8fCBsb29rdXBEaXJlY3RvcnkgLyogZmFsbGJhY2sgdG8gY3VycmVudCBkaXJlY3RvcnkgaW4gd29yc2Ugc2NlbmFyaW8gKi9cbiAgKTtcbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIHJlcG9zaXRvcnkgcm9vdCBwYXRoIGJ5IHNjYW5uaW5nIGN1cnJlbnQgYW5kIHBhcmVudCBkaXJlY3Rvcmllc1xuICogYW5kIGxvb2tpbmcgZm9yIG1hcmtlciBmaWxlcy9kaXJzIGxpa2U6XG4gKlxuICogLSAuZ2l0XG4gKiAtIHBhY2thZ2UtbG9jay5qc29uXG4gKiAtIHlhcm4ubG9ja1xuICogLSBwbnBtLWxvY2sueWFtbFxuICogLSBwbnBtLXdvcmtzcGFjZS55YW1sXG4gKi9cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGggPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290UGF0aCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4ocHJvY2Vzcy5jd2QoKSk7XG4gIHJldHVybiByb290UGF0aDtcbn0pO1xuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnNXaXRoRXh0cmEgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IFNwYXduUmVzdWx0T3B0cyB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBiaW5QYXRoIH0gZnJvbSAnLi91dGlscy9iaW5QYXRoJztcbmltcG9ydCB0eXBlIHsgQ2xpQXJncyB9IGZyb20gJy4vdXRpbHMvY2xpQXJnc1BpcGUnO1xuaW1wb3J0IHsgY2xpQXJnc1BpcGUgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGluc2VydEFmdGVyQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGluY2x1ZGVzQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuZXhwb3J0IHR5cGUgVGFza1R5cGVzID1cbiAgfCAnbGludCdcbiAgfCAnYnVpbGQnXG4gIHwgJ3Rlc3QnXG4gIHwgJ2RlY2xhcmF0aW9ucydcbiAgfCAnaW50ZWdyYXRpb24nXG4gIHwgJ3NldHVwOmludGVncmF0aW9uJ1xuICB8IChzdHJpbmcgJiB7XG4gICAgICBfYWxsb3dTdHJpbmdzPzogdW5kZWZpbmVkO1xuICAgIH0pO1xuXG5leHBvcnQgY29uc3QgdHVyYm9CaW5QYXRoID0gKCkgPT5cbiAgYmluUGF0aCh7XG4gICAgYmluTmFtZTogJ3R1cmJvJyxcbiAgICBiaW5TY3JpcHRQYXRoOiAndHVyYm8vYmluL3R1cmJvJyxcbiAgfSk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYXNUdXJib0pzb24oKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICByZXR1cm4gYXdhaXQgc3RhdChqb2luKGN3ZCwgJ3R1cmJvLmpzb24nKSlcbiAgICAudGhlbigocmVzKSA9PiByZXMuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhc3NUdXJib0ZvcmNlRW52KGFyZ3M6IHN0cmluZ1tdKSB7XG4gIHJldHVybiBpbmNsdWRlc0FueU9mKGFyZ3MsIFsncnVuJ10pICYmIGluY2x1ZGVzQW55T2YoYXJncywgWyctLWZvcmNlJ10pXG4gICAgPyB7XG4gICAgICAgIFRVUkJPX0ZPUkNFOiAnMScsXG4gICAgICB9XG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbmhlcml0VHVyYm9Gb3JjZUFyZ0Zyb21FbnYoKSB7XG4gIHJldHVybiAoc3RhdGU6IENsaUFyZ3MpID0+ICh7XG4gICAgLi4uc3RhdGUsXG4gICAgaW5wdXRBcmdzOlxuICAgICAgaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsncnVuJ10pICYmXG4gICAgICAhaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsnLS1mb3JjZSddKSAmJlxuICAgICAgcHJvY2Vzcy5lbnZbJ1RVUkJPX0ZPUkNFJ11cbiAgICAgICAgPyBpbnNlcnRBZnRlckFueU9mKHN0YXRlLmlucHV0QXJncywgWyctLWZvcmNlJ10sIFsncnVuJ10pXG4gICAgICAgIDogc3RhdGUuaW5wdXRBcmdzLFxuICB9KTtcbn1cblxuLyoqXG4gKiBSdW4gb25lIG9mIHRoZSBkZXYgcGlwZWxpbmUgdGFza3MgdXNpbmcgVHVyYm8gZm9yIGEgc2luZ2xlIHBhY2thZ2VcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlKG9wdHM6IHtcbiAgdGFza3M6IFtUYXNrVHlwZXMsIC4uLlRhc2tUeXBlc1tdXTtcbiAgcGFja2FnZURpcj86IHN0cmluZztcbiAgc3Bhd25PcHRzOiBPbWl0PFNwYXduT3B0aW9uc1dpdGhFeHRyYTxTcGF3blJlc3VsdE9wdHM+LCAnY3dkJz47XG59KSB7XG4gIGNvbnN0IHJvb3REaXIgPSBvcHRzLnBhY2thZ2VEaXIgPz8gcHJvY2Vzcy5jd2QoKTtcbiAgY29uc3QgY3dkID0gYXdhaXQgcmVwb3NpdG9yeVJvb3RQYXRoKCk7XG4gIHJldHVybiBhd2FpdCBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAgIGF3YWl0IHR1cmJvQmluUGF0aCgpLFxuICAgIGNsaUFyZ3NQaXBlKFxuICAgICAgW2luaGVyaXRUdXJib0ZvcmNlQXJnRnJvbUVudigpXSxcbiAgICAgIFtcbiAgICAgICAgJ3J1bicsXG4gICAgICAgIC4uLm9wdHMudGFza3MsXG4gICAgICAgICctLWZpbHRlcj0nICsgcm9vdERpci5yZXBsYWNlKGN3ZCwgJy4nKSxcbiAgICAgICAgJy0tb3V0cHV0LWxvZ3M9bmV3LW9ubHknLFxuICAgICAgXVxuICAgICksXG4gICAge1xuICAgICAgLi4ub3B0cy5zcGF3bk9wdHMsXG4gICAgICBjd2QsXG4gICAgfVxuICApO1xufVxuIiwiaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcbmltcG9ydCB7IGxvYWQgfSBmcm9tICdqcy15YW1sJztcbmltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiB0cnlSZWFkaW5nUG5wbVdvcmtzcGFjZVlhbWwobW9ub3JlcG9Sb290OiBzdHJpbmcpIHtcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHJlYWRGaWxlKFxuICAgIGpvaW4obW9ub3JlcG9Sb290LCAncG5wbS13b3Jrc3BhY2UueWFtbCcpLFxuICAgICd1dGYtOCdcbiAgKTtcbiAgY29uc3Qgcm9vdFBhdGggPSBsb2FkKHRleHQpIGFzIHtcbiAgICBwYWNrYWdlcz86IHN0cmluZ1tdO1xuICB9O1xuICByZXR1cm4gcm9vdFBhdGgucGFja2FnZXMgPz8gW107XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHRyeVJlYWRpbmdQYWNrYWdlSnNvbldvcmtzcGFjZXMobW9ub3JlcG9Sb290OiBzdHJpbmcpIHtcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHJlYWRGaWxlKGpvaW4obW9ub3JlcG9Sb290LCAncGFja2FnZS5qc29uJyksICd1dGYtOCcpO1xuICBjb25zdCBwYWNrYWdlSnNvbiA9IEpTT04ucGFyc2UodGV4dCkgYXMge1xuICAgIHdvcmtzcGFjZXM/OiBzdHJpbmdbXTtcbiAgfTtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkocGFja2FnZUpzb24ud29ya3NwYWNlcykgPyBwYWNrYWdlSnNvbi53b3Jrc3BhY2VzIDogW107XG59XG5cbmNvbnN0IHJlYWRQYWNrYWdlc0dsb2JzQXQgPSBhc3luYyAobW9ub3JlcG9Sb290OiBzdHJpbmcpID0+IHtcbiAgY29uc3QgW3BucG1Xb3Jrc3BhY2VzLCBwYWNrYWdlSnNvbldvcmtzcGFjZXNdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHRyeVJlYWRpbmdQbnBtV29ya3NwYWNlWWFtbChtb25vcmVwb1Jvb3QpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCksXG4gICAgdHJ5UmVhZGluZ1BhY2thZ2VKc29uV29ya3NwYWNlcyhtb25vcmVwb1Jvb3QpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCksXG4gIF0pO1xuICByZXR1cm4gcG5wbVdvcmtzcGFjZXMgfHwgcGFja2FnZUpzb25Xb3Jrc3BhY2VzIHx8IFtdO1xufTtcblxuLyoqXG4gKiBEZXRlcm1pbmUgbW9ub3JlcG8gcGFja2FnZXMgZ2xvYiBieSByZWFkaW5nIG9uZSBvZiB0aGUgc3VwcG9ydGVkXG4gKiBmaWxlc1xuICpcbiAqIE5PVEU6IG9ubHkgcG5wbSBpcyBzdXBwb3J0ZWQgYXQgdGhlIG1vbWVudFxuICovXG5leHBvcnQgY29uc3QgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHJvb3QgPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGgoKTtcbiAgY29uc3QgcGFja2FnZXNHbG9icyA9IGF3YWl0IHJlYWRQYWNrYWdlc0dsb2JzQXQocm9vdCk7XG4gIHJldHVybiB7XG4gICAgcm9vdCxcbiAgICBwYWNrYWdlc0dsb2JzLFxuICB9O1xufSk7XG4iLCJpbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBoYXNUdXJib0pzb24gfSBmcm9tICcuLi90dXJibyc7XG5pbXBvcnQgeyByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzIH0gZnJvbSAnLi9yZWFkUGFja2FnZXNHbG9icyc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24oKSB7XG4gIGNvbnN0IFt7IHJvb3QsIHBhY2thZ2VzR2xvYnMgfSwgaGFzVHVyYm9dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMoKSxcbiAgICBoYXNUdXJib0pzb24oKSxcbiAgXSk7XG4gIGlmIChwYWNrYWdlc0dsb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB7XG4gICAgICByb290LFxuICAgICAgcGFja2FnZXNHbG9icyxcbiAgICAgIHBhY2thZ2VMb2NhdGlvbnM6IFtdLFxuICAgICAgaGFzVHVyYm8sXG4gICAgICB0eXBlOiAnc2luZ2xlLXBhY2thZ2UnIGFzIGNvbnN0LFxuICAgIH07XG4gIH1cbiAgY29uc3QgcGFja2FnZUxvY2F0aW9ucyA9IGF3YWl0IGZnKFxuICAgIHBhY2thZ2VzR2xvYnMubWFwKChnbG9iKSA9PiBgJHtnbG9ifS9wYWNrYWdlLmpzb25gKSxcbiAgICB7XG4gICAgICBjd2Q6IHJvb3QsXG4gICAgfVxuICApO1xuICByZXR1cm4ge1xuICAgIHJvb3QsXG4gICAgcGFja2FnZXNHbG9icyxcbiAgICBwYWNrYWdlTG9jYXRpb25zOiBwYWNrYWdlTG9jYXRpb25zLm1hcCgobG9jYXRpb24pID0+IGRpcm5hbWUobG9jYXRpb24pKSxcbiAgICBoYXNUdXJibyxcbiAgICB0eXBlOiAnbXVsdGlwbGUtcGFja2FnZXMnIGFzIGNvbnN0LFxuICB9O1xufVxuIiwiaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IGlzRGlyZWN0b3J5IH0gZnJvbSAnLi9pc0RpcmVjdG9yeSc7XG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi9tb2R1bGVSb290RGlyZWN0b3J5JztcbmltcG9ydCB7IHVwd2FyZERpcmVjdG9yeVNlYXJjaCB9IGZyb20gJy4vdXB3YXJkRGlyZWN0b3J5U2VhcmNoJztcblxuZXhwb3J0IHsgcmVhZFBhY2thZ2VKc29uIH0gZnJvbSAnLi4vcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbic7XG5leHBvcnQgeyBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24gfSBmcm9tICcuL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbic7XG5leHBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3JlcG9zaXRvcnlSb290UGF0aCc7XG5cbmFzeW5jIGZ1bmN0aW9uIGxvb2t1cChvcHRzOiB7IHBhdGg6IHN0cmluZzsgbG9va3VwUGFja2FnZU5hbWU6IHN0cmluZyB9KSB7XG4gIHJldHVybiBhd2FpdCB1cHdhcmREaXJlY3RvcnlTZWFyY2goe1xuICAgIHN0YXJ0OiBtb2R1bGVSb290RGlyZWN0b3J5KCksXG4gICAgYXBwZW5kUGF0aDogam9pbignbm9kZV9tb2R1bGVzJywgb3B0cy5sb29rdXBQYWNrYWdlTmFtZSksXG4gICAgdGVzdDogaXNEaXJlY3RvcnksXG4gIH0pO1xufVxuXG4vKipcbiAqIExvb2t1cCBsb2NhdGlvbiBmb3IgZGV2RGVwZW5kZW5jaWVzIG9mIFwiQHJlcGthLWtpdC90c1wiIC0gdGhpcyBmdW5jdGlvbiB3aWxsXG4gKiBsb29rdXAgZm9yIFwib3B0cy5sb29rdXBQYWNrYWdlTmFtZVwiXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmaW5kRGV2RGVwZW5kZW5jeShvcHRzOiB7IGxvb2t1cFBhY2thZ2VOYW1lOiBzdHJpbmcgfSkge1xuICBjb25zdCBsb29rdXBQYWNrYWdlTmFtZSA9IG9wdHMubG9va3VwUGFja2FnZU5hbWU7XG5cbiAgcmV0dXJuIGF3YWl0IGxvb2t1cCh7XG4gICAgcGF0aDogbW9kdWxlUm9vdERpcmVjdG9yeSgpLFxuICAgIGxvb2t1cFBhY2thZ2VOYW1lLFxuICB9KTtcbn1cbiIsImltcG9ydCB0eXBlIHsgQ29uZmlnIH0gZnJvbSAnQGplc3QvdHlwZXMnO1xuaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4uL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmltcG9ydCB7IHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlIH0gZnJvbSAnLi4vdHVyYm8nO1xuXG5hc3luYyBmdW5jdGlvbiBsb2FkU3RhbmRhcmRHbG9iYWxIb29rKFxuICBzY3JpcHQ6IHN0cmluZyxcbiAgZ2xvYmFsQ29uZmlnOiBDb25maWcuR2xvYmFsQ29uZmlnLFxuICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZ1xuKSB7XG4gIGNvbnN0IGxvY2F0aW9uID0gam9pbihwcm9qZWN0Q29uZmlnLnJvb3REaXIsIHNjcmlwdCk7XG4gIGNvbnN0IGhhc0hvb2sgPSBhd2FpdCBzdGF0KGxvY2F0aW9uKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuICByZXR1cm4ge1xuICAgIGhhc0hvb2ssXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFoYXNIb29rKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc3VsdCA9IChhd2FpdCBpbXBvcnQobG9jYXRpb24pKSBhc1xuICAgICAgICB8IHtcbiAgICAgICAgICAgIGRlZmF1bHQ/OiAoXG4gICAgICAgICAgICAgIGdsb2JhbENvbmZpZzogQ29uZmlnLkdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgICAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWdcbiAgICAgICAgICAgICkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgICAgICAgICB9XG4gICAgICAgIHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKCFyZXN1bHQgfHwgIXJlc3VsdC5kZWZhdWx0KSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGDimqDvuI8gTm8gZGVmYXVsdCBleHBvcnQgZm91bmQgaW4gXCIke3NjcmlwdH1cImApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBhd2FpdCBQcm9taXNlLnJlc29sdmUocmVzdWx0LmRlZmF1bHQoZ2xvYmFsQ29uZmlnLCBwcm9qZWN0Q29uZmlnKSk7XG4gICAgfSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEN1c3RvbUdsb2JhbEhvb2soXG4gIHNjcmlwdDogc3RyaW5nLFxuICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZ1xuKSB7XG4gIGNvbnN0IGxvY2F0aW9uID0gam9pbihwcm9qZWN0Q29uZmlnLnJvb3REaXIsIHNjcmlwdCk7XG4gIGNvbnN0IGhhc0hvb2sgPSBhd2FpdCBzdGF0KGxvY2F0aW9uKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuICByZXR1cm4ge1xuICAgIGhhc0hvb2ssXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFoYXNIb29rKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHBhY2thZ2VKc29uID0gYXdhaXQgcmVhZFBhY2thZ2VKc29uKFxuICAgICAgICBqb2luKHByb2Nlc3MuY3dkKCksICdwYWNrYWdlLmpzb24nKVxuICAgICAgKTtcblxuICAgICAgaWYgKFxuICAgICAgICBsb2NhdGlvbi5lbmRzV2l0aCgnc2V0dXAudHMnKSAmJlxuICAgICAgICB0eXBlb2YgcGFja2FnZUpzb25bJ3NjcmlwdHMnXSA9PT0gJ29iamVjdCcgJiZcbiAgICAgICAgcGFja2FnZUpzb25bJ3NjcmlwdHMnXVsnc2V0dXA6aW50ZWdyYXRpb24nXSA9PT0gYHRzeCAke3NjcmlwdH1gXG4gICAgICApIHtcbiAgICAgICAgYXdhaXQgcnVuVHVyYm9UYXNrc0ZvclNpbmdsZVBhY2thZ2Uoe1xuICAgICAgICAgIHRhc2tzOiBbJ3NldHVwOmludGVncmF0aW9uJ10sXG4gICAgICAgICAgc3Bhd25PcHRzOiB7XG4gICAgICAgICAgICBleGl0Q29kZXM6IFswXSxcbiAgICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICAgICAgTE9HX0xFVkVMOiBsb2dnZXIubG9nTGV2ZWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbCgndHN4JywgW2xvY2F0aW9uXSwge1xuICAgICAgICAgIGV4aXRDb2RlczogWzBdLFxuICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgICBMT0dfTEVWRUw6IGxvZ2dlci5sb2dMZXZlbCxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZEFuZFJ1bkdsb2JhbEhvb2soXG4gIHNjcmlwdDogc3RyaW5nLFxuICBnbG9iYWxDb25maWc6IENvbmZpZy5HbG9iYWxDb25maWcsXG4gIHByb2plY3RDb25maWc6IENvbmZpZy5Qcm9qZWN0Q29uZmlnLFxuICB0aXA/OiBzdHJpbmdcbikge1xuICBjb25zdCBbc3RhbmRhcmQsIGN1c3RvbV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgbG9hZFN0YW5kYXJkR2xvYmFsSG9vayhgJHtzY3JpcHR9Lm1qc2AsIGdsb2JhbENvbmZpZywgcHJvamVjdENvbmZpZyksXG4gICAgbG9hZEN1c3RvbUdsb2JhbEhvb2soYCR7c2NyaXB0fS50c2AsIHByb2plY3RDb25maWcpLFxuICBdKTtcbiAgaWYgKCFjdXN0b20uaGFzSG9vayAmJiB0aXApIHtcbiAgICBsb2dnZXIudGlwKHRpcCk7XG4gIH1cbiAgYXdhaXQgc3RhbmRhcmQuZXhlY3V0ZSgpO1xuICBhd2FpdCBjdXN0b20uZXhlY3V0ZSgpO1xufVxuIiwiaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IGZpbmREZXZEZXBlbmRlbmN5IH0gZnJvbSAnLi4vdXRpbHMvZmluZERldkRlcGVuZGVuY3knO1xuXG5leHBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmV4cG9ydCB7IGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbiB9IGZyb20gJy4uL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbic7XG5leHBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuLi91dGlscy9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuZXhwb3J0IHsgbG9hZEFuZFJ1bkdsb2JhbEhvb2sgfSBmcm9tICcuL2xvYWRBbmRSdW5HbG9iYWxIb29rJztcblxuZXhwb3J0IGNvbnN0IGplc3RQbHVnaW5Sb290ID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmluZERldkRlcGVuZGVuY3koe1xuICAgIGxvb2t1cFBhY2thZ2VOYW1lOiAnZXNidWlsZC1qZXN0JyxcbiAgfSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgbG9nZ2VyLndhcm4oXG4gICAgICAnSmVzdCBwbHVnaW5zIHJvb3QgY2Fubm90IGJlIGRldGVybWluZWQuIERvIHlvdSBoYXZlIFwiQHJlcGthLWtpdC90c1wiIGluIGRldkRlcGVuZGVuY2llcyBhdCB0aGUgbW9ub3JlcG8gcm9vdCBvciBhdCB0aGUgbG9jYWwgcGFja2FnZT8nXG4gICAgKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAobG9nZ2VyLmxvZ0xldmVsID09PSAnZGVidWcnKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ0ZvdW5kIGplc3QgcGx1Z2lucyByb290IGF0JywgZGlybmFtZShyZXN1bHQpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdCA/IGRpcm5hbWUocmVzdWx0KSA6ICcuJztcbn0pO1xuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFPLFNBQUEsUUFBQSxDQUNMLEtBQ3lCLEVBQUE7QUFDekIsRUFBQSxPQUFPLFFBQVEsS0FBSyxDQUFBLENBQUE7QUFDdEI7O0FDSk8sU0FBQSxJQUFBLENBQWlCLEVBQXNCLEVBQUE7QUFDNUMsRUFBSSxJQUFBLEtBQUEsQ0FBQTtBQUNKLEVBQUEsSUFBSSxVQUFhLEdBQUEsS0FBQSxDQUFBO0FBQ2pCLEVBQUEsT0FBTyxNQUFTO0FBQ2QsSUFBQSxJQUFJLFVBQVksRUFBQTtBQUNkLE1BQU8sT0FBQSxLQUFBLENBQUE7QUFBQSxLQUNUO0FBQ0EsSUFBQSxLQUFBLEdBQVEsRUFBRyxFQUFBLENBQUE7QUFDWCxJQUFhLFVBQUEsR0FBQSxJQUFBLENBQUE7QUFDYixJQUFPLE9BQUEsS0FBQSxDQUFBO0FBQUEsR0FDVCxDQUFBO0FBQ0Y7O0FDWE8sU0FBQSxTQUFBLENBQXNCLEVBQTRDLEVBQUE7QUFDdkUsRUFBSSxJQUFBLEtBQUEsQ0FBQTtBQUNKLEVBQUksSUFBQSxRQUFBLENBQUE7QUFDSixFQUFBLElBQUksVUFBYSxHQUFBLEtBQUEsQ0FBQTtBQUNqQixFQUFBLE9BQU8sWUFBd0I7QUFDN0IsSUFBQSxJQUFJLFVBQVksRUFBQTtBQUNkLE1BQU8sT0FBQSxLQUFBLENBQUE7QUFBQSxLQUNUO0FBQ0EsSUFBQSxJQUFJLFFBQVUsRUFBQTtBQUNaLE1BQU8sT0FBQSxRQUFBLENBQUE7QUFBQSxLQUNUO0FBQ0EsSUFBVyxRQUFBLEdBQUEsT0FBQSxDQUFRLE9BQVEsQ0FBQSxFQUFBLEVBQUksQ0FBQSxDQUFBO0FBQy9CLElBQUEsS0FBQSxHQUFRLE1BQU0s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
