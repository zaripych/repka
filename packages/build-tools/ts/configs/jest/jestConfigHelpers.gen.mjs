// This file is bundled up from './src/*' and needs to be committed
import { dirname, join } from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import assert from 'node:assert';
import { ChildProcess, spawn } from 'node:child_process';
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWxzL29uY2UudHMiLCIuLi8uLi9zcmMvbG9nZ2VyL2xvZ2dlci50cyIsIi4uLy4uL3NyYy91dGlscy9pc0RpcmVjdG9yeS50cyIsIi4uLy4uL3NyYy91dGlscy9tb2R1bGVSb290RGlyZWN0b3J5LnRzIiwiLi4vLi4vc3JjL3V0aWxzL3Vwd2FyZERpcmVjdG9yeVNlYXJjaC50cyIsIi4uLy4uL3NyYy91dGlscy9vbmNlQXN5bmMudHMiLCIuLi8uLi9zcmMvcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbi50cyIsIi4uLy4uL3NyYy91dGlscy9zdGFja1RyYWNlLnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25Ub1Byb21pc2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdC50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduT3V0cHV0LnRzIiwiLi4vLi4vc3JjL3V0aWxzL2JpblBhdGgudHMiLCIuLi8uLi9zcmMvdXRpbHMvY2xpQXJnc1BpcGUudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNUcnV0aHkudHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoLnRzIiwiLi4vLi4vc3JjL3R1cmJvLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy91dGlscy9maW5kRGV2RGVwZW5kZW5jeS50cyIsIi4uLy4uL3NyYy9qZXN0L2xvYWRBbmRSdW5HbG9iYWxIb29rLnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdENvbmZpZ0hlbHBlcnMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIG9uY2U8VD4oZm46ICgpID0+IFQpOiAoKSA9PiBUIHtcbiAgbGV0IHZhbHVlOiBUO1xuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xuICByZXR1cm4gKCk6IFQgPT4ge1xuICAgIGlmIChjYWxjdWxhdGVkKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHZhbHVlID0gZm4oKTtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG59XG4iLCJpbXBvcnQgeyBvbmNlIH0gZnJvbSAnLi4vdXRpbHMvb25jZSc7XG5cbmNvbnN0IGxldmVscyA9IFsnZGVidWcnLCAnaW5mbycsICd3YXJuJywgJ2Vycm9yJywgJ2ZhdGFsJ10gYXMgY29uc3Q7XG5cbnR5cGUgTG9nTGV2ZWwgPSB0eXBlb2YgbGV2ZWxzW251bWJlcl07XG5cbnR5cGUgUGFyYW1zID0gUGFyYW1ldGVyczx0eXBlb2YgY29uc29sZS5sb2c+O1xuXG50eXBlIExvZ2dlciA9IHtcbiAgbG9nTGV2ZWw6IExvZ0xldmVsO1xuICBkZWJ1ZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGluZm8oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBhbGlhcyBmb3IgaW5mb1xuICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBzcGVjaWFsIHRyZWF0bWVudCwgZGlzYWJsZWQgb24gQ0kvVFRZXG4gIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbn07XG5cbmNvbnN0IGVuYWJsZWRMZXZlbHNBZnRlciA9IChsZXZlbDogTG9nTGV2ZWwgfCAnb2ZmJykgPT4ge1xuICBpZiAobGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIGNvbnN0IGluZGV4ID0gbGV2ZWxzLmZpbmRJbmRleCgoaXRlbSkgPT4gaXRlbSA9PT0gbGV2ZWwpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxldmVsJyk7XG4gIH1cbiAgcmV0dXJuIGxldmVscy5zbGljZShpbmRleCk7XG59O1xuXG5jb25zdCBpc0xldmVsID0gKGxldmVsPzogc3RyaW5nKTogbGV2ZWwgaXMgTG9nTGV2ZWwgPT4ge1xuICByZXR1cm4gbGV2ZWxzLmluY2x1ZGVzKGxldmVsIGFzIExvZ0xldmVsKTtcbn07XG5cbmNvbnN0IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncyA9IChcbiAgYXJncyA9IHByb2Nlc3MuYXJndlxuKTogTG9nTGV2ZWwgfCAnb2ZmJyB8IHVuZGVmaW5lZCA9PiB7XG4gIGNvbnN0IGluZGV4ID0gYXJncy5maW5kSW5kZXgoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gJy0tbG9nLWxldmVsJyk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGNvbnN0IGxldmVsID0gYXJnc1tpbmRleCArIDFdO1xuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiAnb2ZmJztcbiAgfVxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlGcm9tRW52ID0gKCk6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xuICBjb25zdCBsZXZlbCA9IHByb2Nlc3MuZW52WydMT0dfTEVWRUwnXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgZ2V0VmVyYm9zaXR5Q29uZmlnID0gKCkgPT4ge1xuICBjb25zdCBhcmdzTGV2ZWwgPSB2ZXJib3NpdHlGcm9tUHJvY2Vzc0FyZ3MoKTtcbiAgY29uc3QgZW52TGV2ZWwgPSB2ZXJib3NpdHlGcm9tRW52KCk7XG4gIHJldHVybiBhcmdzTGV2ZWwgPz8gZW52TGV2ZWwgPz8gJ2luZm8nO1xufTtcblxuY29uc3Qgbm9vcCA9ICguLi5fYXJnczogUGFyYW1zKSA9PiB7XG4gIHJldHVybjtcbn07XG5cbmNvbnN0IGxvZyA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5sb2coLi4uYXJncyk7XG59O1xuXG5jb25zdCBlcnJvciA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5lcnJvciguLi5hcmdzKTtcbn07XG5cbmNvbnN0IHNob3VsZEVuYWJsZVRpcCA9ICgpID0+ICFwcm9jZXNzLmVudlsnQ0knXSAmJiAhcHJvY2Vzcy5zdGRvdXQuaXNUVFk7XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoXG4gIGRlcHMgPSB7IGdldFZlcmJvc2l0eUNvbmZpZywgbG9nLCBlcnJvciwgc2hvdWxkRW5hYmxlVGlwIH1cbikgPT4ge1xuICBjb25zdCBsb2dMZXZlbCA9IGRlcHMuZ2V0VmVyYm9zaXR5Q29uZmlnKCk7XG4gIGNvbnN0IGVuYWJsZWQgPSBlbmFibGVkTGV2ZWxzQWZ0ZXIobG9nTGV2ZWwpO1xuICByZXR1cm4gbGV2ZWxzLnJlZHVjZShcbiAgICAoYWNjLCBsdmwpID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmFjYyxcbiAgICAgICAgW2x2bF06IGVuYWJsZWQuaW5jbHVkZXMobHZsKVxuICAgICAgICAgID8gWydmYXRhbCcsICdlcnJvciddLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICAgID8gZGVwcy5lcnJvclxuICAgICAgICAgICAgOiBkZXBzLmxvZ1xuICAgICAgICAgIDogbm9vcCxcbiAgICAgIH07XG4gICAgfSxcbiAgICB7XG4gICAgICBsb2dMZXZlbCxcbiAgICAgIGxvZzogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpID8gZGVwcy5sb2cgOiBub29wLFxuICAgICAgdGlwOiBlbmFibGVkLmluY2x1ZGVzKCdpbmZvJykgJiYgZGVwcy5zaG91bGRFbmFibGVUaXAoKSA/IGRlcHMubG9nIDogbm9vcCxcbiAgICB9IGFzIExvZ2dlclxuICApO1xufTtcblxuY29uc3QgY3JlYXRlRGVsZWdhdGluZ0xvZ2dlciA9IChvcHRzOiB7IHBhcmVudDogTG9nZ2VyIH0pOiBMb2dnZXIgPT5cbiAgT2JqZWN0LmZyZWV6ZSh7XG4gICAgZ2V0IGxvZ0xldmVsKCkge1xuICAgICAgcmV0dXJuIG9wdHMucGFyZW50LmxvZ0xldmVsO1xuICAgIH0sXG4gICAgZGVidWcoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmRlYnVnKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5pbmZvKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmxvZyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgdGlwKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC50aXAoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50Lndhcm4oLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGVycm9yKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5lcnJvciguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgZmF0YWwoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmZhdGFsKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgfSk7XG5cbmxldCBkZWZhdWx0TG9nZ2VyRmFjdG9yeTogKCgpID0+IExvZ2dlcikgfCBudWxsO1xuXG5leHBvcnQgY29uc3QgY29uZmlndXJlRGVmYXVsdExvZ2dlciA9IChmYWN0b3J5OiAoKSA9PiBMb2dnZXIpID0+IHtcbiAgaWYgKGRlZmF1bHRMb2dnZXJGYWN0b3J5KSB7XG4gICAgY29uc3QgZXJyb3IgPSB7XG4gICAgICBzdGFjazogJycsXG4gICAgfTtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShlcnJvcik7XG4gICAgbG9nZ2VyLmRlYnVnKCdDYW5ub3Qgb3ZlcnJpZGUgZGVmYXVsdCBsb2dnZXIgbXVsdGlwbGUgdGltZXMnLCBlcnJvci5zdGFjayk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGRlZmF1bHRMb2dnZXJGYWN0b3J5ID0gZmFjdG9yeTtcbn07XG5cbmNvbnN0IGRlZmF1bHRMb2dnZXIgPSBvbmNlKCgpID0+IHtcbiAgbGV0IGZhY3RvcnkgPSBkZWZhdWx0TG9nZ2VyRmFjdG9yeTtcbiAgaWYgKCFmYWN0b3J5KSB7XG4gICAgZmFjdG9yeSA9ICgpID0+IGNyZWF0ZUxvZ2dlcigpO1xuICB9XG4gIHJldHVybiBmYWN0b3J5KCk7XG59KTtcblxuLyoqXG4gKiBEZWZhdWx0IGxvZ2dlciBpbnN0YW5jZSBjYW4gYmUgY29uZmlndXJlZCBvbmNlIGF0IHN0YXJ0dXBcbiAqL1xuZXhwb3J0IGNvbnN0IGxvZ2dlcjogTG9nZ2VyID0gY3JlYXRlRGVsZWdhdGluZ0xvZ2dlcih7XG4gIGdldCBwYXJlbnQoKSB7XG4gICAgcmV0dXJuIGRlZmF1bHRMb2dnZXIoKTtcbiAgfSxcbn0pO1xuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGlzRGlyZWN0b3J5KHBhdGg6IHN0cmluZykge1xuICByZXR1cm4gc3RhdChwYXRoKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0RpcmVjdG9yeSgpKVxuICAgIC5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xufVxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSAnbm9kZTp1cmwnO1xuXG5pbXBvcnQgeyBvbmNlIH0gZnJvbSAnLi9vbmNlJztcblxuZXhwb3J0IGNvbnN0IGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsID0gKG9wdHM6IHtcbiAgaW1wb3J0TWV0YVVybDogc3RyaW5nO1xufSkgPT4ge1xuICAvLyB0aGlzIGlzIGhpZ2hseSBkZXBlbmRlbnQgb24gdGhlIG91dHB1dCBkaXJlY3Rvcnkgc3RydWN0dXJlXG4gIC8vIGFuZCB0aGUgY29udGV4dCBpbiB3aGljaCB0aGlzIGZ1bmN0aW9uIGlzIHJ1biAoYnVuZGxlZCBjb2RlIHZzIHRzeCAuL3NyYy90c2ZpbGUudHMpXG4gIGNvbnN0IF9fZmlsZU5hbWUgPSBmaWxlVVJMVG9QYXRoKG5ldyBVUkwob3B0cy5pbXBvcnRNZXRhVXJsKSk7XG4gIGNvbnN0IHBhcmVudCA9IGRpcm5hbWUoX19maWxlTmFtZSk7XG4gIGNvbnN0IHN1cGVyUGFyZW50ID0gZGlybmFtZShwYXJlbnQpO1xuXG4gIGNvbnN0IGlzQnVuZGxlZEluRGlzdCA9ICgpID0+IHBhcmVudC5lbmRzV2l0aCgnL2Rpc3QnKTtcbiAgY29uc3QgaXNCdW5kbGVkSW5CaW4gPSAoKSA9PlxuICAgIHBhcmVudC5lbmRzV2l0aCgnL2JpbicpICYmICFzdXBlclBhcmVudC5lbmRzV2l0aCgnL3NyYycpO1xuXG4gIGlmIChpc0J1bmRsZWRJbkRpc3QoKSB8fCBpc0J1bmRsZWRJbkJpbigpKSB7XG4gICAgcmV0dXJuIGZpbGVVUkxUb1BhdGgobmV3IFVSTChgLi4vYCwgb3B0cy5pbXBvcnRNZXRhVXJsKSk7XG4gIH1cblxuICAvLyBydW4gdmlhIHRzeCB0byBidWlsZCB0aGUgQHJlcGthLWtpdC90cyBpdHNlbGZcbiAgcmV0dXJuIGZpbGVVUkxUb1BhdGgobmV3IFVSTChgLi4vLi4vYCwgb3B0cy5pbXBvcnRNZXRhVXJsKSk7XG59O1xuXG5leHBvcnQgY29uc3QgbW9kdWxlUm9vdERpcmVjdG9yeSA9IG9uY2UoKCkgPT5cbiAgZ2V0TW9kdWxlUm9vdERpcmVjdG9yeUZvckltcG9ydE1ldGFVcmwoeyBpbXBvcnRNZXRhVXJsOiBpbXBvcnQubWV0YS51cmwgfSlcbik7XG4iLCJpbXBvcnQgeyBkaXJuYW1lLCBqb2luIH0gZnJvbSAncGF0aCc7XG5cbnR5cGUgVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMgPSB7XG4gIHN0YXJ0OiBzdHJpbmc7XG4gIHN0b3BzPzogc3RyaW5nW107XG4gIGFwcGVuZFBhdGg/OiBzdHJpbmc7XG4gIHRlc3Q6IChwYXRoOiBzdHJpbmcpID0+IFByb21pc2U8Ym9vbGVhbiB8IHN0cmluZyB8IHVuZGVmaW5lZD47XG59O1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24qIHVwd2FyZERpcmVjdG9yeVdhbGsob3B0czogVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMpIHtcbiAgbGV0IGN1cnJlbnQgPSBvcHRzLnN0YXJ0O1xuICB3aGlsZSAoXG4gICAgY3VycmVudCAhPT0gJy8nICYmXG4gICAgY3VycmVudCAhPT0gJ34vJyAmJlxuICAgICEob3B0cy5zdG9wcz8uaW5jbHVkZXMoY3VycmVudCkgPz8gZmFsc2UpXG4gICkge1xuICAgIGNvbnN0IHBhdGggPSBvcHRzLmFwcGVuZFBhdGggPyBqb2luKGN1cnJlbnQsIG9wdHMuYXBwZW5kUGF0aCkgOiBjdXJyZW50O1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGF3YWl0IG9wdHMudGVzdChwYXRoKTtcbiAgICBpZiAoY2FuZGlkYXRlKSB7XG4gICAgICB5aWVsZCB0eXBlb2YgY2FuZGlkYXRlID09PSAnc3RyaW5nJyA/IGNhbmRpZGF0ZSA6IHBhdGg7XG4gICAgfVxuICAgIGN1cnJlbnQgPSBkaXJuYW1lKGN1cnJlbnQpO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cHdhcmREaXJlY3RvcnlTZWFyY2gob3B0czogVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMpIHtcbiAgY29uc3Qgd2FsayA9IHVwd2FyZERpcmVjdG9yeVdhbGsob3B0cyk7XG4gIGZvciBhd2FpdCAoY29uc3QgZGlyIG9mIHdhbGspIHtcbiAgICByZXR1cm4gZGlyO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZUFzeW5jPFQ+KGZuOiAoKSA9PiBUIHwgUHJvbWlzZTxUPik6ICgpID0+IFByb21pc2U8VD4ge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBpbkZsaWdodDogUHJvbWlzZTxUPiB8IG51bGw7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiBhc3luYyAoKTogUHJvbWlzZTxUPiA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKGluRmxpZ2h0KSB7XG4gICAgICByZXR1cm4gaW5GbGlnaHQ7XG4gICAgfVxuICAgIGluRmxpZ2h0ID0gUHJvbWlzZS5yZXNvbHZlKGZuKCkpO1xuICAgIHZhbHVlID0gYXdhaXQgaW5GbGlnaHQ7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgaW5GbGlnaHQgPSBudWxsO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnLi4vdXRpbHMvb25jZUFzeW5jJztcbmltcG9ydCB0eXBlIHsgUGFja2FnZUpzb24gfSBmcm9tICcuL3BhY2thZ2VKc29uJztcblxuY29uc3QgY3dkUGFja2FnZUpzb25QYXRoID0gKCkgPT4gam9pbihwcm9jZXNzLmN3ZCgpLCAnLi9wYWNrYWdlLmpzb24nKTtcblxuYXN5bmMgZnVuY3Rpb24gcmVhZFBhY2thZ2VKc29uQXQocGF0aDogc3RyaW5nKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xuICByZXR1cm4gYXdhaXQgcmVhZEZpbGUocGF0aCwgJ3V0Zi04JykudGhlbihcbiAgICAocmVzdWx0KSA9PiBKU09OLnBhcnNlKHJlc3VsdCkgYXMgUGFja2FnZUpzb25cbiAgKTtcbn1cblxuZXhwb3J0IGNvbnN0IHJlYWRDd2RQYWNrYWdlSnNvbiA9IG9uY2VBc3luYygoKSA9PlxuICByZWFkUGFja2FnZUpzb25BdChjd2RQYWNrYWdlSnNvblBhdGgoKSlcbik7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb24ocGF0aDogc3RyaW5nKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xuICAvLyBhc3N1bWluZyBjdXJyZW50IGRpcmVjdG9yeSBkb2Vzbid0IGNoYW5nZSB3aGlsZSBhcHAgaXMgcnVubmluZ1xuICByZXR1cm4gcHJvY2Vzcy5jd2QoKSA9PT0gY3dkUGFja2FnZUpzb25QYXRoKClcbiAgICA/IGF3YWl0IHJlYWRDd2RQYWNrYWdlSnNvbigpXG4gICAgOiBhd2FpdCByZWFkUGFja2FnZUpzb25BdChwYXRoKTtcbn1cbiIsIi8qKlxuICogQ2FwdHVyZSB0aGUgc3RhY2sgdHJhY2UgYW5kIGFsbG93IHRvIGVucmljaCBleGNlcHRpb25zIHRocm93biBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2tzXG4gKiB3aXRoIGFkZGl0aW9uYWwgc3RhY2sgaW5mb3JtYXRpb24gY2FwdHVyZWQgYXQgdGhlIG1vbWVudCBvZiB0aGUgY2FsbCBvZiB0aGlzIGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYXB0dXJlU3RhY2tUcmFjZShyZW1vdmUgPSAwKSB7XG4gIGNvbnN0IHN0YWNrQ29udGFpbmVyID0ge1xuICAgIHN0YWNrOiAnJyxcbiAgfTtcbiAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2Uoc3RhY2tDb250YWluZXIpO1xuICBjb25zdCBzdGFja1RyYWNlID0gc3RhY2tDb250YWluZXIuc3RhY2tcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLnNsaWNlKDYgKyByZW1vdmUpXG4gICAgLmpvaW4oJ1xcbicpO1xuICByZXR1cm4ge1xuICAgIC8qKlxuICAgICAqIENhcHR1cmVkIHN0YWNrIHRyYWNlIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgc3RhY2tUcmFjZSxcbiAgICAvKipcbiAgICAgKiBDYW4gYmUgY2FsbGVkIGluIGFzeW5jaHJvbm91cyBjYWxsYmFjayB0byBlbnJpY2ggZXhjZXB0aW9ucyB3aXRoIGFkZGl0aW9uYWwgaW5mb3JtYXRpb25cbiAgICAgKiBAcGFyYW0gZXJyIEV4Y2VwdGlvbiB0byBlbnJpY2ggLSBpdCBpcyBnb2luZyB0byBoYXZlIGl0cyBgLnN0YWNrYCBwcm9wIG11dGF0ZWRcbiAgICAgKiBAcmV0dXJucyBTYW1lIGV4Y2VwdGlvblxuICAgICAqL1xuICAgIHByZXBhcmVGb3JSZXRocm93OiAoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgY29uc3Qgb2xkU3RhY2tUcmFjZSA9IGVyci5zdGFjayA/PyAnJy5zcGxpdCgnXFxuJykuc2xpY2UoMSkuam9pbignXFxuJyk7XG4gICAgICBlcnIuc3RhY2sgPSBgJHtlcnIubmFtZSB8fCAnRXJyb3InfTogJHtcbiAgICAgICAgZXJyLm1lc3NhZ2VcbiAgICAgIH1cXG4ke29sZFN0YWNrVHJhY2V9XFxuJHtzdGFja1RyYWNlfWA7XG4gICAgICByZXR1cm4gZXJyO1xuICAgIH0sXG4gIH07XG59XG4iLCJpbXBvcnQgdHlwZSB7IFNwYXduT3B0aW9ucyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgQ2hpbGRQcm9jZXNzIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHR5cGUgeyBBc3NpZ24gfSBmcm9tICd1dGlsaXR5LXR5cGVzJztcblxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBjYXB0dXJlU3RhY2tUcmFjZSB9IGZyb20gJy4uL3V0aWxzL3N0YWNrVHJhY2UnO1xuXG5leHBvcnQgdHlwZSBTcGF3blRvUHJvbWlzZU9wdHMgPSB7XG4gIC8qKlxuICAgKiBTcGVjaWZ5IGV4aXQgY29kZXMgd2hpY2ggc2hvdWxkIG5vdCByZXN1bHQgaW4gdGhyb3dpbmcgYW4gZXJyb3Igd2hlblxuICAgKiB0aGUgcHJvY2VzcyBoYXMgZmluaXNoZWQsIGUuZy4gc3BlY2lmeWluZyBgWzBdYCBtZWFucyBpZiBwcm9jZXNzIGZpbmlzaGVkXG4gICAqIHdpdGggemVybyBleGl0IGNvZGUgdGhlbiB0aGUgcHJvbWlzZSB3aWxsIHJlc29sdmUgaW5zdGVhZCBvZiByZWplY3RpbmcuXG4gICAqXG4gICAqIEFsdGVybmF0aXZlbHksIHNwZWNpZnkgYGluaGVyaXRgIHRvIHNhdmUgc3RhdHVzIGNvZGUgdG8gdGhlIGN1cnJlbnQgYHByb2Nlc3MuZXhpdENvZGVgXG4gICAqXG4gICAqIEFsdGVybmF0aXZlbHksIGNvbXBsZXRlbHkgaWdub3JlIHRoZSBleGl0IGNvZGUgKGUuZy4geW91IGZvbGxvdyB1cCBhbmQgaW50ZXJyb2dhdGVcbiAgICogdGhlIHByb2Nlc3MgY29kZSBtYW51YWxseSBhZnRlcndhcmRzKVxuICAgKi9cbiAgZXhpdENvZGVzOiBudW1iZXJbXSB8ICdpbmhlcml0JyB8ICdhbnknO1xufTtcblxudHlwZSBTaGFyZWRPcHRzID0gUGljazxTcGF3bk9wdGlvbnMsICdjd2QnPjtcblxudHlwZSBTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4gPSBbXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgYXJnczogUmVhZG9ubHlBcnJheTxzdHJpbmc+LFxuICBvcHRpb25zOiBBc3NpZ248U3Bhd25PcHRpb25zLCBFPlxuXTtcblxuZXhwb3J0IHR5cGUgU3Bhd25PcHRpb25zV2l0aEV4dHJhPEUgZXh0ZW5kcyBvYmplY3QgPSBTcGF3blRvUHJvbWlzZU9wdHM+ID1cbiAgQXNzaWduPFNwYXduT3B0aW9ucywgRT47XG5cbmV4cG9ydCB0eXBlIFNwYXduUGFyYW1ldGVyTWl4PEUgZXh0ZW5kcyBvYmplY3QgPSBTcGF3blRvUHJvbWlzZU9wdHM+ID1cbiAgfCBbY3A6IENoaWxkUHJvY2VzcywgZXh0cmFPcHRzOiBBc3NpZ248RSwgU2hhcmVkT3B0cz5dXG4gIHwgU3Bhd25BcmdzPEU+O1xuXG5leHBvcnQgZnVuY3Rpb24gaXNTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4oXG4gIGFyZ3M6IFNwYXduUGFyYW1ldGVyTWl4PEU+XG4pOiBhcmdzIGlzIFNwYXduQXJnczxFPiB7XG4gIHJldHVybiAhKGFyZ3NbMF0gaW5zdGFuY2VvZiBDaGlsZFByb2Nlc3MpICYmIHR5cGVvZiBhcmdzWzBdID09PSAnc3RyaW5nJztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNwYXduV2l0aFNwYXduUGFyYW1ldGVyczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgcGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbikge1xuICBjb25zdCBbY2hpbGQsIFtjb21tYW5kLCBhcmdzLCBvcHRzXV0gPSBpc1NwYXduQXJncyhwYXJhbWV0ZXJzKVxuICAgID8gW1xuICAgICAgICBzcGF3biguLi4ocGFyYW1ldGVycyBhcyB1bmtub3duIGFzIFBhcmFtZXRlcnM8dHlwZW9mIHNwYXduPikpLFxuICAgICAgICBwYXJhbWV0ZXJzLFxuICAgICAgXVxuICAgIDogW1xuICAgICAgICBwYXJhbWV0ZXJzWzBdLFxuICAgICAgICBbXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmZpbGUsXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmFyZ3Muc2xpY2UoMSksXG4gICAgICAgICAgcGFyYW1ldGVyc1sxXSBhcyBBc3NpZ248U3Bhd25PcHRpb25zLCBFPixcbiAgICAgICAgXSxcbiAgICAgIF07XG4gIHJldHVybiB7XG4gICAgY2hpbGQsXG4gICAgY29tbWFuZCxcbiAgICBhcmdzLFxuICAgIG9wdHMsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blRvUHJvbWlzZShcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXhcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB7IGNoaWxkLCBjb21tYW5kLCBhcmdzLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHsgcHJlcGFyZUZvclJldGhyb3cgfSA9IGNhcHR1cmVTdGFja1RyYWNlKCk7XG5cbiAgY29uc3QgZXhpdENvZGVzID0gb3B0cy5leGl0Q29kZXM7XG5cbiAgY29uc3QgY3dkID0gb3B0cy5jd2QgPyBvcHRzLmN3ZC50b1N0cmluZygpIDogdW5kZWZpbmVkO1xuXG4gIGNvbnN0IGNtZCA9ICgpID0+IFtjb21tYW5kLCAuLi5hcmdzXS5qb2luKCcgJyk7XG5cbiAgbG9nZ2VyLmRlYnVnKFsnPicsIGNtZCgpXS5qb2luKCcgJyksIC4uLihjd2QgPyBbYGluICR7Y3dkfWBdIDogW10pKTtcblxuICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzLCByZWopID0+XG4gICAgY2hpbGRcbiAgICAgIC5vbignY2xvc2UnLCAoY29kZSwgc2lnbmFsKSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgY29kZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdpbmhlcml0JyAmJlxuICAgICAgICAgICAgZXhpdENvZGVzICE9PSAnYW55JyAmJlxuICAgICAgICAgICAgIWV4aXRDb2Rlcy5pbmNsdWRlcyhjb2RlKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgcmVqKFxuICAgICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgICBuZXcgRXJyb3IoYENvbW1hbmQgXCIke2NtZCgpfVwiIGhhcyBmYWlsZWQgd2l0aCBjb2RlICR7Y29kZX1gKVxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoc2lnbmFsKSB7XG4gICAgICAgICAgcmVqKFxuICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3coXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihgRmFpbGVkIHRvIGV4ZWN1dGUgY29tbWFuZCBcIiR7Y21kKCl9XCIgLSAke3NpZ25hbH1gKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgcHJlcGFyZUZvclJldGhyb3cobmV3IEVycm9yKCdFeHBlY3RlZCBzaWduYWwgb3IgZXJyb3IgY29kZScpKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5vbignZXJyb3InLCByZWopXG4gICk7XG4gIC8vIGluaGVyaXQgZXhpdCBjb2RlXG4gIGlmIChleGl0Q29kZXMgPT09ICdpbmhlcml0Jykge1xuICAgIGlmIChcbiAgICAgIHR5cGVvZiBjaGlsZC5leGl0Q29kZSA9PT0gJ251bWJlcicgJiZcbiAgICAgICh0eXBlb2YgcHJvY2Vzcy5leGl0Q29kZSAhPT0gJ251bWJlcicgfHwgcHJvY2Vzcy5leGl0Q29kZSA9PT0gMClcbiAgICApIHtcbiAgICAgIHByb2Nlc3MuZXhpdENvZGUgPSBjaGlsZC5leGl0Q29kZTtcbiAgICB9XG4gIH1cbn1cbiIsImltcG9ydCBhc3NlcnQgZnJvbSAnYXNzZXJ0JztcblxuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCwgU3Bhd25Ub1Byb21pc2VPcHRzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5pbXBvcnQgeyBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduVG9Qcm9taXNlIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0T3B0cyA9IHtcbiAgb3V0cHV0PzpcbiAgICB8IEFycmF5PCdzdGRvdXQnIHwgJ3N0ZGVycic+XG4gICAgfCBbJ3N0ZG91dCcgfCAnc3RkZXJyJywgLi4uQXJyYXk8J3N0ZG91dCcgfCAnc3RkZXJyJz5dO1xuICBidWZmZXJzPzoge1xuICAgIGNvbWJpbmVkPzogc3RyaW5nW107XG4gICAgc3Rkb3V0Pzogc3RyaW5nW107XG4gICAgc3RkZXJyPzogc3RyaW5nW107XG4gIH07XG59ICYgU3Bhd25Ub1Byb21pc2VPcHRzO1xuXG5leHBvcnQgdHlwZSBTcGF3blJlc3VsdFJldHVybiA9IHtcbiAgcGlkPzogbnVtYmVyO1xuICBvdXRwdXQ6IHN0cmluZ1tdO1xuICBzdGRvdXQ6IHN0cmluZztcbiAgc3RkZXJyOiBzdHJpbmc7XG4gIHN0YXR1czogbnVtYmVyIHwgbnVsbDtcbiAgc2lnbmFsOiBOb2RlSlMuU2lnbmFscyB8IG51bGw7XG4gIGVycm9yPzogRXJyb3IgfCB1bmRlZmluZWQ7XG59O1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25SZXN1bHQoXG4gIC4uLnBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4PFNwYXduUmVzdWx0T3B0cz5cbik6IFByb21pc2U8U3Bhd25SZXN1bHRSZXR1cm4+IHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCBjb21iaW5lZERhdGE6IHN0cmluZ1tdID0gb3B0cy5idWZmZXJzPy5jb21iaW5lZCA/PyBbXTtcbiAgY29uc3Qgc3Rkb3V0RGF0YTogc3RyaW5nW10gPSBvcHRzLmJ1ZmZlcnM/LnN0ZG91dCA/PyBbXTtcbiAgY29uc3Qgc3RkZXJyRGF0YTogc3RyaW5nW10gPSBvcHRzLmJ1ZmZlcnM/LnN0ZGVyciA/PyBbXTtcbiAgY29uc3Qgb3V0cHV0ID0gb3B0cy5vdXRwdXQgPz8gWydzdGRvdXQnLCAnc3RkZXJyJ107XG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZG91dCcpKSB7XG4gICAgYXNzZXJ0KFxuICAgICAgISFjaGlsZC5zdGRvdXQsXG4gICAgICAnRXhwZWN0ZWQgXCIuc3Rkb3V0XCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xuICAgICk7XG4gICAgY2hpbGQuc3Rkb3V0LnNldEVuY29kaW5nKCd1dGYtOCcpO1xuICAgIGNoaWxkLnN0ZG91dC5vbignZGF0YScsIChkYXRhOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbWJpbmVkRGF0YS5wdXNoKGRhdGEpO1xuICAgICAgc3Rkb3V0RGF0YS5wdXNoKGRhdGEpO1xuICAgIH0pO1xuICB9XG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZGVycicpKSB7XG4gICAgYXNzZXJ0KFxuICAgICAgISFjaGlsZC5zdGRlcnIsXG4gICAgICAnRXhwZWN0ZWQgXCIuc3RkZXJyXCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xuICAgICk7XG4gICAgY2hpbGQuc3RkZXJyLnNldEVuY29kaW5nKCd1dGYtOCcpO1xuICAgIGNoaWxkLnN0ZGVyci5vbignZGF0YScsIChkYXRhOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbWJpbmVkRGF0YS5wdXNoKGRhdGEpO1xuICAgICAgc3RkZXJyRGF0YS5wdXNoKGRhdGEpO1xuICAgIH0pO1xuICB9XG4gIGNvbnN0IFtyZXN1bHRdID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFtzcGF3blRvUHJvbWlzZShjaGlsZCwgb3B0cyldKTtcbiAgcmV0dXJuIHtcbiAgICBwaWQ6IGNoaWxkLnBpZCxcbiAgICBzaWduYWw6IGNoaWxkLnNpZ25hbENvZGUsXG4gICAgc3RhdHVzOiBjaGlsZC5leGl0Q29kZSxcbiAgICBnZXQgb3V0cHV0KCkge1xuICAgICAgcmV0dXJuIGNvbWJpbmVkRGF0YTtcbiAgICB9LFxuICAgIGdldCBzdGRlcnIoKSB7XG4gICAgICByZXR1cm4gc3RkZXJyRGF0YS5qb2luKCcnKTtcbiAgICB9LFxuICAgIGdldCBzdGRvdXQoKSB7XG4gICAgICByZXR1cm4gc3Rkb3V0RGF0YS5qb2luKCcnKTtcbiAgICB9LFxuICAgIGdldCBlcnJvcigpIHtcbiAgICAgIHJldHVybiByZXN1bHQuc3RhdHVzID09PSAncmVqZWN0ZWQnXG4gICAgICAgID8gKHJlc3VsdC5yZWFzb24gYXMgRXJyb3IpXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIH0sXG4gIH07XG59XG4iLCJpbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB0eXBlIHsgU3Bhd25SZXN1bHRPcHRzLCBTcGF3blJlc3VsdFJldHVybiB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHsgc3Bhd25SZXN1bHQgfSBmcm9tICcuL3NwYXduUmVzdWx0JztcbmltcG9ydCB0eXBlIHsgU3Bhd25QYXJhbWV0ZXJNaXggfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25PdXRwdXQoXG4gIC4uLnBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4PFNwYXduUmVzdWx0T3B0cz5cbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHsgY2hpbGQsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc3Bhd25SZXN1bHQoY2hpbGQsIG9wdHMpO1xuICByZXR1cm4gcmVzdWx0Lm91dHB1dC5qb2luKCcnKTtcbn1cblxuY29uc3QgZGVmYXVsdFNob3VsZE91dHB1dCA9IChyZXN1bHQ6IFNwYXduUmVzdWx0UmV0dXJuKSA9PiB7XG4gIHJldHVybiByZXN1bHQuZXJyb3IgfHwgcmVzdWx0LnN0YXR1cyAhPT0gMCB8fCBsb2dnZXIubG9nTGV2ZWwgPT09ICdkZWJ1Zyc7XG59O1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25PdXRwdXRDb25kaXRpb25hbChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8XG4gICAgU3Bhd25SZXN1bHRPcHRzICYge1xuICAgICAgLyoqXG4gICAgICAgKiBCeSBkZWZhdWx0IHdpbGwgb3V0cHV0IHRvIGBzdGRlcnJgIHdoZW4gc3Bhd24gcmVzdWx0IGZhaWxlZCB3aXRoIGFuIGVycm9yLCB3aGVuXG4gICAgICAgKiBzdGF0dXMgY29kZSBpcyBub3QgemVybyBvciB3aGVuIGBMb2dnZXIubG9nTGV2ZWxgIGlzIGBkZWJ1Z2BcbiAgICAgICAqL1xuICAgICAgc2hvdWxkT3V0cHV0PzogKHJlc3VsdDogU3Bhd25SZXN1bHRSZXR1cm4pID0+IGJvb2xlYW47XG4gICAgfVxuICA+XG4pIHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwgb3B0cyk7XG4gIGNvbnN0IHNob3VsZE91dHB1dCA9IG9wdHMuc2hvdWxkT3V0cHV0ID8/IGRlZmF1bHRTaG91bGRPdXRwdXQ7XG4gIGlmIChzaG91bGRPdXRwdXQocmVzdWx0KSkge1xuICAgIGxvZ2dlci5lcnJvcihyZXN1bHQub3V0cHV0LmpvaW4oJycpKTtcbiAgfVxuICBpZiAocmVzdWx0LmVycm9yKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVqZWN0KHJlc3VsdC5lcnJvcik7XG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXN1bHQpO1xufVxuIiwiaW1wb3J0IHsgcmVhZEZpbGUsIHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGRpcm5hbWUsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi9tb2R1bGVSb290RGlyZWN0b3J5JztcblxuYXN5bmMgZnVuY3Rpb24gaXNGaWxlKGZpbGVQYXRoOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGF3YWl0IHN0YXQoZmlsZVBhdGgpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gcmVzdWx0LmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uKiBpdGVyYXRlTm9kZU1vZHVsZXMoc3RhcnRXaXRoOiBzdHJpbmcsIHBhdGg6IHN0cmluZykge1xuICBsZXQgY3VycmVudCA9IHN0YXJ0V2l0aDtcbiAgd2hpbGUgKGN1cnJlbnQgIT09ICcvJyAmJiBjdXJyZW50ICE9PSAnfi8nKSB7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gam9pbihjdXJyZW50LCAnbm9kZV9tb2R1bGVzJywgcGF0aCk7XG4gICAgaWYgKGF3YWl0IGlzRmlsZShjYW5kaWRhdGUpKSB7XG4gICAgICB5aWVsZCBjYW5kaWRhdGU7XG4gICAgfVxuICAgIGN1cnJlbnQgPSBkaXJuYW1lKGN1cnJlbnQpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbmRCaW5TY3JpcHQoc3RhcnRXaXRoOiBzdHJpbmcsIGJpblNjcmlwdFBhdGg6IHN0cmluZykge1xuICBmb3IgYXdhaXQgKGNvbnN0IHBhdGggb2YgaXRlcmF0ZU5vZGVNb2R1bGVzKHN0YXJ0V2l0aCwgYmluU2NyaXB0UGF0aCkpIHtcbiAgICByZXR1cm4gcGF0aDtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYmluUGF0aChvcHRzOiB7XG4gIGJpbk5hbWU6IHN0cmluZztcbiAgYmluU2NyaXB0UGF0aDogc3RyaW5nO1xuICB1c2VTaG9ydGN1dD86IGJvb2xlYW47XG59KSB7XG4gIGNvbnN0IHVzZVNob3J0Y3V0ID0gb3B0cy51c2VTaG9ydGN1dCA/PyB0cnVlO1xuICBjb25zdCByb290ID0gbW9kdWxlUm9vdERpcmVjdG9yeSgpO1xuICBpZiAodXNlU2hvcnRjdXQpIHtcbiAgICBjb25zdCBiZXN0R3Vlc3MgPSBqb2luKHJvb3QsICdub2RlX21vZHVsZXMnLCAnLmJpbicsIG9wdHMuYmluTmFtZSk7XG4gICAgaWYgKGF3YWl0IGlzRmlsZShiZXN0R3Vlc3MpKSB7XG4gICAgICByZXR1cm4gYmVzdEd1ZXNzO1xuICAgIH1cbiAgfVxuICBjb25zdCByZXN1bHQgPSBhd2FpdCBmaW5kQmluU2NyaXB0KHJvb3QsIG9wdHMuYmluU2NyaXB0UGF0aCk7XG4gIGlmIChyZXN1bHQpIHtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGZpbmQgYmluICR7b3B0cy5iaW5OYW1lfWApO1xufVxuXG5mdW5jdGlvbiBzY3JpcHRGcm9tUGFja2FnZUpzb24ob3B0czoge1xuICBiaW5OYW1lOiBzdHJpbmc7XG4gIHBhY2thZ2VKc29uOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn0pIHtcbiAgY29uc3QgY2FuZGlkYXRlID0gb3B0cy5wYWNrYWdlSnNvblsnYmluJ107XG4gIGlmICh0eXBlb2YgY2FuZGlkYXRlID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBjYW5kaWRhdGU7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ29iamVjdCcgJiYgY2FuZGlkYXRlICE9PSBudWxsKSB7XG4gICAgY29uc3QgZW50cnkgPSAoY2FuZGlkYXRlIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4pW29wdHMuYmluTmFtZV07XG4gICAgaWYgKHR5cGVvZiBlbnRyeSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBlbnRyeTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRldGVybWluZUJpblNjcmlwdFBhdGgob3B0czoge1xuICBiaW5OYW1lOiBzdHJpbmc7XG4gIGJpblBhY2thZ2VOYW1lOiBzdHJpbmc7XG59KSB7XG4gIGZvciBhd2FpdCAoY29uc3QgcGF0aCBvZiBpdGVyYXRlTm9kZU1vZHVsZXMoXG4gICAgbW9kdWxlUm9vdERpcmVjdG9yeSgpLFxuICAgIGpvaW4ob3B0cy5iaW5QYWNrYWdlTmFtZSwgJ3BhY2thZ2UuanNvbicpXG4gICkpIHtcbiAgICBjb25zdCBwa2cgPSBhd2FpdCByZWFkRmlsZShwYXRoLCAndXRmLTgnKVxuICAgICAgLnRoZW4oKHRleHQpID0+IEpTT04ucGFyc2UodGV4dCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAuY2F0Y2goKCkgPT4gbnVsbCk7XG4gICAgaWYgKCFwa2cpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHNjcmlwdFBhdGggPSBzY3JpcHRGcm9tUGFja2FnZUpzb24oe1xuICAgICAgYmluTmFtZTogb3B0cy5iaW5OYW1lLFxuICAgICAgcGFja2FnZUpzb246IHBrZyxcbiAgICB9KTtcbiAgICBpZiAoIXNjcmlwdFBhdGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGpvaW4oZGlybmFtZShwYXRoKSwgc2NyaXB0UGF0aCk7XG4gICAgaWYgKGF3YWl0IGlzRmlsZShjYW5kaWRhdGUpKSB7XG4gICAgICByZXR1cm4gam9pbihvcHRzLmJpblBhY2thZ2VOYW1lLCBzY3JpcHRQYXRoKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBpbmNsdWRlc0FueU9mKHRhcmdldDogc3RyaW5nW10sIGhhc0FueU9mQXJnczogc3RyaW5nW10pIHtcbiAgcmV0dXJuIGhhc0FueU9mQXJncy5zb21lKCh2YXJpYW50KSA9PiB0YXJnZXQuaW5jbHVkZXModmFyaWFudCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5zZXJ0QWZ0ZXJBbnlPZihcbiAgdGFyZ2V0OiBzdHJpbmdbXSxcbiAgaW5zZXJ0OiBzdHJpbmdbXSxcbiAgaGFzQW55T2ZBcmdzOiBzdHJpbmdbXVxuKSB7XG4gIGNvbnN0IGluZGV4ID0gdGFyZ2V0LmZpbmRJbmRleCgodmFsdWUpID0+IGhhc0FueU9mQXJncy5pbmNsdWRlcyh2YWx1ZSkpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgcmV0dXJuIHRhcmdldDtcbiAgfVxuICBjb25zdCByZXN1bHQgPSBbLi4udGFyZ2V0XTtcbiAgcmVzdWx0LnNwbGljZShpbmRleCArIDEsIDAsIC4uLmluc2VydCk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVBcmdzRnJvbShcbiAgdGFyZ2V0OiBzdHJpbmdbXSxcbiAgYXJnczogQXJyYXk8c3RyaW5nIHwgUmVnRXhwPixcbiAgb3B0cz86IHsgbnVtVmFsdWVzOiBudW1iZXIgfVxuKSB7XG4gIGNvbnN0IHJlc3VsdCA9IFsuLi50YXJnZXRdO1xuICBmb3IgKGNvbnN0IGFyZyBvZiBhcmdzKSB7XG4gICAgY29uc3QgaW5kZXggPSB0YXJnZXQuZmluZEluZGV4KCh2YWx1ZSkgPT5cbiAgICAgIHR5cGVvZiBhcmcgPT09ICdzdHJpbmcnID8gdmFsdWUgPT09IGFyZyA6IGFyZy50ZXN0KHZhbHVlKVxuICAgICk7XG4gICAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgICAgcmVzdWx0LnNwbGljZShpbmRleCwgb3B0cz8ubnVtVmFsdWVzID8gb3B0cy5udW1WYWx1ZXMgKyAxIDogMSk7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVJbnB1dEFyZ3MoXG4gIGFyZ3M6IEFycmF5PHN0cmluZyB8IFJlZ0V4cD4sXG4gIG9wdHM/OiB7IG51bVZhbHVlczogbnVtYmVyIH1cbikge1xuICByZXR1cm4gKHN0YXRlOiBDbGlBcmdzKSA9PiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgaW5wdXRBcmdzOiByZW1vdmVBcmdzRnJvbShzdGF0ZS5pbnB1dEFyZ3MsIGFyZ3MsIG9wdHMpLFxuICAgIH07XG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXREZWZhdWx0QXJncyhcbiAgYXJnczogW3N0cmluZywgLi4uc3RyaW5nW11dLFxuICB2YWx1ZXM6IHN0cmluZ1tdID0gW10sXG4gIGNvbmRpdGlvbj86IChzdGF0ZTogQ2xpQXJncykgPT4gYm9vbGVhbixcbiAgYXBwbHk/OiAoYXJnczogc3RyaW5nW10sIHN0YXRlOiBDbGlBcmdzKSA9PiBDbGlBcmdzXG4pIHtcbiAgcmV0dXJuIChzdGF0ZTogQ2xpQXJncykgPT4ge1xuICAgIGlmIChjb25kaXRpb24pIHtcbiAgICAgIGlmICghY29uZGl0aW9uKHN0YXRlKSkge1xuICAgICAgICByZXR1cm4gc3RhdGU7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChpbmNsdWRlc0FueU9mKHN0YXRlLmlucHV0QXJncywgYXJncykpIHtcbiAgICAgIHJldHVybiBzdGF0ZTtcbiAgICB9XG4gICAgY29uc3Qgc2V0OiBOb25OdWxsYWJsZTx0eXBlb2YgYXBwbHk+ID0gYXBwbHlcbiAgICAgID8gYXBwbHlcbiAgICAgIDogKGFyZ3MsIHRvKSA9PiAoe1xuICAgICAgICAgIC4uLnRvLFxuICAgICAgICAgIHByZUFyZ3M6IFsuLi5zdGF0ZS5wcmVBcmdzLCAuLi5hcmdzXSxcbiAgICAgICAgfSk7XG4gICAgcmV0dXJuIHNldChbYXJnc1swXSwgLi4udmFsdWVzXSwgc3RhdGUpO1xuICB9O1xufVxuXG5leHBvcnQgY29uc3QgcmVtb3ZlTG9nTGV2ZWxPcHRpb24gPSAoKSA9PlxuICByZW1vdmVJbnB1dEFyZ3MoWyctLWxvZy1sZXZlbCddLCB7IG51bVZhbHVlczogMSB9KTtcblxuZXhwb3J0IHR5cGUgQ2xpQXJncyA9IHtcbiAgLyoqXG4gICAqIEV4dHJhIGFyZ3VtZW50cyB0aGF0IGdvIGJlZm9yZSBhcmd1bWVudHMgcGFzc2VkIGluIGJ5IHRoZSB1c2VyXG4gICAqL1xuICBwcmVBcmdzOiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIEFyZ3VtZW50cyBhcyBwYXNzZWQgaW4gYnkgdGhlIHVzZXIsIGNvdWxkIGJlIG1vZGlmaWVkIGJ5XG4gICAqIHRyYW5zZm9ybXMgdGhhdCBjb21lIGJlZm9yZSBjdXJyZW50XG4gICAqL1xuICBpbnB1dEFyZ3M6IHN0cmluZ1tdO1xuICAvKipcbiAgICogRXh0cmEgYXJndW1lbnRzIHRoYXQgZ28gYWZ0ZXIgYXJndW1lbnRzIHBhc3NlZCBpbiBieSB0aGUgdXNlclxuICAgKi9cbiAgcG9zdEFyZ3M6IHN0cmluZ1tdO1xufTtcblxuZXhwb3J0IHR5cGUgQ2xpQXJnc1RyYW5zZm9ybSA9IChzdGF0ZTogQ2xpQXJncykgPT4gQ2xpQXJncztcblxuZXhwb3J0IGZ1bmN0aW9uIGNsaUFyZ3NQaXBlKFxuICB0cmFuc2Zvcm1zOiBDbGlBcmdzVHJhbnNmb3JtW10sXG4gIGlucHV0QXJnczogc3RyaW5nW11cbikge1xuICBjb25zdCB7XG4gICAgcHJlQXJncyxcbiAgICBpbnB1dEFyZ3M6IG1vZGlmaWVkSW5wdXRBcmdzLFxuICAgIHBvc3RBcmdzLFxuICB9ID0gdHJhbnNmb3Jtcy5yZWR1Y2U8Q2xpQXJncz4oKGFjYywgdHJhbnNmb3JtKSA9PiB0cmFuc2Zvcm0oYWNjKSwge1xuICAgIGlucHV0QXJncyxcbiAgICBwcmVBcmdzOiBbXSxcbiAgICBwb3N0QXJnczogW10sXG4gIH0pO1xuICByZXR1cm4gWy4uLnByZUFyZ3MsIC4uLm1vZGlmaWVkSW5wdXRBcmdzLCAuLi5wb3N0QXJnc107XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gaXNUcnV0aHk8VD4oXG4gIHZhbHVlOiBOb25OdWxsYWJsZTxUPiB8IGZhbHNlIHwgbnVsbCB8IHVuZGVmaW5lZCB8ICcnIHwgMFxuKTogdmFsdWUgaXMgTm9uTnVsbGFibGU8VD4ge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmaWx0ZXJUcnV0aHk8XG4gIEFyciBleHRlbmRzIEFycmF5PHVua25vd24gfCBmYWxzZSB8IG51bGwgfCB1bmRlZmluZWQgfCAnJyB8IDA+LFxuICBSZXR1cm5UeXBlID0gQXJyIGV4dGVuZHMgQXJyYXk8aW5mZXIgVCB8IGZhbHNlIHwgbnVsbCB8IHVuZGVmaW5lZCB8ICcnIHwgMD5cbiAgICA/IE5vbk51bGxhYmxlPFQ+W11cbiAgICA6IEFyclxuPihhcnJheTogQXJyKTogUmV0dXJuVHlwZSB7XG4gIHJldHVybiBhcnJheS5maWx0ZXIoaXNUcnV0aHkpIGFzIHVua25vd24gYXMgUmV0dXJuVHlwZTtcbn1cbiIsImltcG9ydCBmZyBmcm9tICdmYXN0LWdsb2InO1xuaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydCc7XG5pbXBvcnQgeyBkaXJuYW1lLCBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgaXNUcnV0aHkgfSBmcm9tICcuL2lzVHJ1dGh5JztcbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJy4vb25jZUFzeW5jJztcblxuY29uc3QgZ2V0UmVwb3NpdG9yeVJvb3RTY2FuQ2FuZGlkYXRlcyA9IChjdXJyZW50RGlyZWN0b3J5OiBzdHJpbmcpID0+IHtcbiAgLy8gaGF2aW5nICdwYWNrYWdlcy8qJyBpbiB0aGUgcm9vdCBvZiBhIG1vbm9yZXBvIGlzIHN1cGVyIGNvbW1vblxuICBjb25zdCByZXN1bHQgPSAvKC4qKD89XFwvcGFja2FnZXNcXC8pKXwoLiooPz1cXC9ub2RlX21vZHVsZXNcXC8pKXwoLiopLy5leGVjKFxuICAgIGN1cnJlbnREaXJlY3RvcnlcbiAgKTtcbiAgYXNzZXJ0KCEhcmVzdWx0KTtcbiAgY29uc3QgWywgcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdID0gcmVzdWx0O1xuICByZXR1cm4gW3BhY2thZ2VzUm9vdCwgbm9kZU1vZHVsZXNSb290XS5maWx0ZXIoaXNUcnV0aHkpO1xufTtcblxuLy8gcmV0dXJucyB0aGUgZmlyc3QgZGlyZWN0b3J5IHdoaWNoIGhhcyBtb25vcmVwbyBtYXJrZXJzLCBtdWx0aXBsZVxuLy8gZGlyZWN0b3JpZXMgY2FuIGhhdmUgdGhlbSAtIHdoaWNoZXZlciByZWFkIGZpcnN0IHdpbGwgYmUgcmV0dXJuZWRcbi8vIHNvIGlmIG9yZGVyIGlzIGltcG9ydGFudCAtIHNjYW5uaW5nIHNob3VsZCBiZSBzZXBhcmF0ZWQgdG8gbXVsdGlwbGUgam9ic1xuLy8gdmlhIHByaW9yaXRpemVkSGFzTW9ub3JlcG9NYXJrZXJzXG5jb25zdCBoYXNSb290TWFya2VycyA9IGFzeW5jIChjYW5kaWRhdGVzOiBzdHJpbmdbXSkgPT4ge1xuICBjb25zdCBtYXJrZXJzID0gW1xuICAgICcuZ2l0JyxcbiAgICAneWFybi5sb2NrJyxcbiAgICAncG5wbS1sb2NrLnlhbWwnLFxuICAgICdwYWNrYWdlLWxvY2suanNvbicsXG4gICAgJ3BucG0td29ya3NwYWNlLnlhbWwnLFxuICBdO1xuICBjb25zdCBtYXJrZXJzU3RyZWFtID0gZmcuc3RyZWFtKFxuICAgIGNhbmRpZGF0ZXMuZmxhdE1hcCgoZGlyKSA9PiBtYXJrZXJzLm1hcCgobWFya2VyKSA9PiBqb2luKGRpciwgbWFya2VyKSkpLFxuICAgIHtcbiAgICAgIG1hcmtEaXJlY3RvcmllczogdHJ1ZSxcbiAgICAgIG9ubHlGaWxlczogZmFsc2UsXG4gICAgfVxuICApO1xuICBmb3IgYXdhaXQgKGNvbnN0IGVudHJ5IG9mIG1hcmtlcnNTdHJlYW0pIHtcbiAgICBhc3NlcnQodHlwZW9mIGVudHJ5ID09PSAnc3RyaW5nJyk7XG4gICAgcmV0dXJuIGRpcm5hbWUoZW50cnkpO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG5jb25zdCBwcmlvcml0aXplZEhhc01hcmtlcnMgPSAoam9iczogc3RyaW5nW11bXSkgPT4ge1xuICBpZiAoam9icy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gIH1cbiAgcmV0dXJuIG5ldyBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4oKHJlcykgPT4ge1xuICAgIGNvbnN0IHJlc3VsdHMgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nIHwgdW5kZWZpbmVkPigpO1xuXG4gICAgY29uc3QgY2hlY2tTaG91bGRDb21wbGV0ZSA9IChpbmRleDogbnVtYmVyLCByZXN1bHQ6IHN0cmluZyB8IHVuZGVmaW5lZCkgPT4ge1xuICAgICAgcmVzdWx0cy5zZXQoaW5kZXgsIHJlc3VsdCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGpvYnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3QgaGFzUmVzdWx0ID0gcmVzdWx0cy5oYXMoaSk7XG4gICAgICAgIGlmICghaGFzUmVzdWx0KSB7XG4gICAgICAgICAgLy8gaWYgYSBqb2Igd2l0aCBoaWdoZXN0IHByaW9yaXR5IGhhc24ndCBmaW5pc2hlZCB5ZXRcbiAgICAgICAgICAvLyB0aGVuIHdhaXQgZm9yIGl0XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzdWx0cy5nZXQoaSk7XG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAvLyBqb2IgZmluaXNoZWQgYW5kIHdlIGZvdW5kIG1hcmtlcnMsIGFsc28gYWxsIGpvYnNcbiAgICAgICAgICAvLyB3aXRoIGhpZ2hlciBwcmlvcml0eSBmaW5pc2hlZCBhbmQgdGhleSBkb24ndCBoYXZlXG4gICAgICAgICAgLy8gYW55IG1hcmtlcnMgLSB3ZSBhcmUgZG9uZVxuICAgICAgICAgIHJlcyhyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0cy5zaXplID09PSBqb2JzLmxlbmd0aCkge1xuICAgICAgICAvLyBhbGwgam9icyBmaW5pc2hlZCAtIG5vIG1hcmtlcnMgZm91bmRcbiAgICAgICAgcmVzKHVuZGVmaW5lZCk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGpvYnMuZm9yRWFjaCgoZGlyZWN0b3JpZXMsIGluZGV4KSA9PiB7XG4gICAgICBoYXNSb290TWFya2VycyhkaXJlY3RvcmllcylcbiAgICAgICAgLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGNoZWNrU2hvdWxkQ29tcGxldGUoaW5kZXgsIHJlc3VsdCk7XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gaWdub3JlXG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59O1xuXG5leHBvcnQgY29uc3QgcmVwb3NpdG9yeVJvb3RQYXRoVmlhRGlyZWN0b3J5U2NhbiA9IGFzeW5jIChcbiAgbG9va3VwRGlyZWN0b3J5OiBzdHJpbmdcbikgPT4ge1xuICBjb25zdCB1bmlxdWVEaXJuYW1lID0gKHBhdGg/OiBzdHJpbmcpID0+IHtcbiAgICBpZiAoIXBhdGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gZGlybmFtZShwYXRoKTtcbiAgICBpZiAocmVzdWx0ID09PSBwYXRoKSB7XG4gICAgICAvLyBlLmcuIHRoZSBwYXRoIHdhcyBhbHJlYWR5IGEgcm9vdCBcIi9cIlxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIGNvbnN0IHBhcmVudCA9IHVuaXF1ZURpcm5hbWUobG9va3VwRGlyZWN0b3J5KTtcbiAgY29uc3Qgc3VwZXJQYXJlbnQgPSB1bmlxdWVEaXJuYW1lKHBhcmVudCk7XG5cbiAgcmV0dXJuIChcbiAgICAoYXdhaXQgcHJpb3JpdGl6ZWRIYXNNYXJrZXJzKFxuICAgICAgLy8gc2NhbiBpbiBtb3N0IGxpa2VseSBsb2NhdGlvbnMgZmlyc3Qgd2l0aCBjdXJyZW50IGxvb2t1cCBkaXJlY3RvcnkgdGFraW5nIHByaW9yaXR5XG4gICAgICBbXG4gICAgICAgIFtsb29rdXBEaXJlY3RvcnldLFxuICAgICAgICBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzKGxvb2t1cERpcmVjdG9yeSksXG4gICAgICAgIC8vIHNjYW4gMiBkaXJlY3RvcmllcyB1cHdhcmRzXG4gICAgICAgIFtwYXJlbnRdLFxuICAgICAgICBbc3VwZXJQYXJlbnRdLFxuICAgICAgXVxuICAgICAgICAubWFwKChkaXJzKSA9PiBkaXJzLmZpbHRlcihpc1RydXRoeSkpXG4gICAgICAgIC5maWx0ZXIoKGpvYikgPT4gam9iLmxlbmd0aCA+IDApXG4gICAgKSkgfHwgbG9va3VwRGlyZWN0b3J5IC8qIGZhbGxiYWNrIHRvIGN1cnJlbnQgZGlyZWN0b3J5IGluIHdvcnNlIHNjZW5hcmlvICovXG4gICk7XG59O1xuXG4vKipcbiAqIERldGVybWluZSByZXBvc2l0b3J5IHJvb3QgcGF0aCBieSBzY2FubmluZyBjdXJyZW50IGFuZCBwYXJlbnQgZGlyZWN0b3JpZXNcbiAqIGFuZCBsb29raW5nIGZvciBtYXJrZXIgZmlsZXMvZGlycyBsaWtlOlxuICpcbiAqIC0gLmdpdFxuICogLSBwYWNrYWdlLWxvY2suanNvblxuICogLSB5YXJuLmxvY2tcbiAqIC0gcG5wbS1sb2NrLnlhbWxcbiAqIC0gcG5wbS13b3Jrc3BhY2UueWFtbFxuICovXG5leHBvcnQgY29uc3QgcmVwb3NpdG9yeVJvb3RQYXRoID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3Qgcm9vdFBhdGggPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuKHByb2Nlc3MuY3dkKCkpO1xuICByZXR1cm4gcm9vdFBhdGg7XG59KTtcbiIsImltcG9ydCB7IHN0YXQgfSBmcm9tICdmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAncGF0aCc7XG5cbmltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zV2l0aEV4dHJhIH0gZnJvbSAnLi9jaGlsZC1wcm9jZXNzJztcbmltcG9ydCB7IHNwYXduT3V0cHV0Q29uZGl0aW9uYWwgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3Mvc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHsgYmluUGF0aCB9IGZyb20gJy4vdXRpbHMvYmluUGF0aCc7XG5pbXBvcnQgdHlwZSB7IENsaUFyZ3MgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGNsaUFyZ3NQaXBlIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBpbnNlcnRBZnRlckFueU9mIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBpbmNsdWRlc0FueU9mIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3V0aWxzL3JlcG9zaXRvcnlSb290UGF0aCc7XG5cbmV4cG9ydCB0eXBlIFRhc2tUeXBlcyA9XG4gIHwgJ2xpbnQnXG4gIHwgJ2J1aWxkJ1xuICB8ICd0ZXN0J1xuICB8ICdkZWNsYXJhdGlvbnMnXG4gIHwgJ2ludGVncmF0aW9uJ1xuICB8ICdzZXR1cDppbnRlZ3JhdGlvbidcbiAgfCAoc3RyaW5nICYge1xuICAgICAgX2FsbG93U3RyaW5ncz86IHVuZGVmaW5lZDtcbiAgICB9KTtcblxuZXhwb3J0IGNvbnN0IHR1cmJvQmluUGF0aCA9ICgpID0+XG4gIGJpblBhdGgoe1xuICAgIGJpbk5hbWU6ICd0dXJibycsXG4gICAgYmluU2NyaXB0UGF0aDogJ3R1cmJvL2Jpbi90dXJibycsXG4gIH0pO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFzVHVyYm9Kc29uKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBjd2QgPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGgoKTtcbiAgcmV0dXJuIGF3YWl0IHN0YXQoam9pbihjd2QsICd0dXJiby5qc29uJykpXG4gICAgLnRoZW4oKHJlcykgPT4gcmVzLmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXNzVHVyYm9Gb3JjZUVudihhcmdzOiBzdHJpbmdbXSkge1xuICByZXR1cm4gaW5jbHVkZXNBbnlPZihhcmdzLCBbJ3J1biddKSAmJiBpbmNsdWRlc0FueU9mKGFyZ3MsIFsnLS1mb3JjZSddKVxuICAgID8ge1xuICAgICAgICBUVVJCT19GT1JDRTogJzEnLFxuICAgICAgfVxuICAgIDogdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5oZXJpdFR1cmJvRm9yY2VBcmdGcm9tRW52KCkge1xuICByZXR1cm4gKHN0YXRlOiBDbGlBcmdzKSA9PiAoe1xuICAgIC4uLnN0YXRlLFxuICAgIGlucHV0QXJnczpcbiAgICAgIGluY2x1ZGVzQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBbJ3J1biddKSAmJlxuICAgICAgIWluY2x1ZGVzQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBbJy0tZm9yY2UnXSkgJiZcbiAgICAgIHByb2Nlc3MuZW52WydUVVJCT19GT1JDRSddXG4gICAgICAgID8gaW5zZXJ0QWZ0ZXJBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsnLS1mb3JjZSddLCBbJ3J1biddKVxuICAgICAgICA6IHN0YXRlLmlucHV0QXJncyxcbiAgfSk7XG59XG5cbi8qKlxuICogUnVuIG9uZSBvZiB0aGUgZGV2IHBpcGVsaW5lIHRhc2tzIHVzaW5nIFR1cmJvIGZvciBhIHNpbmdsZSBwYWNrYWdlXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5UdXJib1Rhc2tzRm9yU2luZ2xlUGFja2FnZShvcHRzOiB7XG4gIHRhc2tzOiBbVGFza1R5cGVzLCAuLi5UYXNrVHlwZXNbXV07XG4gIHBhY2thZ2VEaXI/OiBzdHJpbmc7XG4gIHNwYXduT3B0czogT21pdDxTcGF3bk9wdGlvbnNXaXRoRXh0cmE8U3Bhd25SZXN1bHRPcHRzPiwgJ2N3ZCc+O1xufSkge1xuICBjb25zdCByb290RGlyID0gb3B0cy5wYWNrYWdlRGlyID8/IHByb2Nlc3MuY3dkKCk7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICByZXR1cm4gYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbChcbiAgICBhd2FpdCB0dXJib0JpblBhdGgoKSxcbiAgICBjbGlBcmdzUGlwZShcbiAgICAgIFtpbmhlcml0VHVyYm9Gb3JjZUFyZ0Zyb21FbnYoKV0sXG4gICAgICBbXG4gICAgICAgICdydW4nLFxuICAgICAgICAuLi5vcHRzLnRhc2tzLFxuICAgICAgICAnLS1maWx0ZXI9JyArIHJvb3REaXIucmVwbGFjZShjd2QsICcuJyksXG4gICAgICAgICctLW91dHB1dC1sb2dzPW5ldy1vbmx5JyxcbiAgICAgIF1cbiAgICApLFxuICAgIHtcbiAgICAgIC4uLm9wdHMuc3Bhd25PcHRzLFxuICAgICAgY3dkLFxuICAgIH1cbiAgKTtcbn1cbiIsImltcG9ydCB7IGxvYWQgfSBmcm9tICdqcy15YW1sJztcbmltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnLi9vbmNlQXN5bmMnO1xuaW1wb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiB0cnlSZWFkaW5nUG5wbVdvcmtzcGFjZVlhbWwobW9ub3JlcG9Sb290OiBzdHJpbmcpIHtcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHJlYWRGaWxlKFxuICAgIGpvaW4obW9ub3JlcG9Sb290LCAncG5wbS13b3Jrc3BhY2UueWFtbCcpLFxuICAgICd1dGYtOCdcbiAgKTtcbiAgY29uc3Qgcm9vdFBhdGggPSBsb2FkKHRleHQpIGFzIHtcbiAgICBwYWNrYWdlcz86IHN0cmluZ1tdO1xuICB9O1xuICByZXR1cm4gcm9vdFBhdGgucGFja2FnZXMgPz8gW107XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHRyeVJlYWRpbmdQYWNrYWdlSnNvbldvcmtzcGFjZXMobW9ub3JlcG9Sb290OiBzdHJpbmcpIHtcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHJlYWRGaWxlKGpvaW4obW9ub3JlcG9Sb290LCAncGFja2FnZS5qc29uJyksICd1dGYtOCcpO1xuICBjb25zdCBwYWNrYWdlSnNvbiA9IEpTT04ucGFyc2UodGV4dCkgYXMge1xuICAgIHdvcmtzcGFjZXM/OiBzdHJpbmdbXTtcbiAgfTtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkocGFja2FnZUpzb24ud29ya3NwYWNlcykgPyBwYWNrYWdlSnNvbi53b3Jrc3BhY2VzIDogW107XG59XG5cbmNvbnN0IHJlYWRQYWNrYWdlc0dsb2JzQXQgPSBhc3luYyAobW9ub3JlcG9Sb290OiBzdHJpbmcpID0+IHtcbiAgY29uc3QgW3BucG1Xb3Jrc3BhY2VzLCBwYWNrYWdlSnNvbldvcmtzcGFjZXNdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHRyeVJlYWRpbmdQbnBtV29ya3NwYWNlWWFtbChtb25vcmVwb1Jvb3QpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCksXG4gICAgdHJ5UmVhZGluZ1BhY2thZ2VKc29uV29ya3NwYWNlcyhtb25vcmVwb1Jvb3QpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCksXG4gIF0pO1xuICByZXR1cm4gcG5wbVdvcmtzcGFjZXMgfHwgcGFja2FnZUpzb25Xb3Jrc3BhY2VzIHx8IFtdO1xufTtcblxuLyoqXG4gKiBEZXRlcm1pbmUgbW9ub3JlcG8gcGFja2FnZXMgZ2xvYiBieSByZWFkaW5nIG9uZSBvZiB0aGUgc3VwcG9ydGVkXG4gKiBmaWxlc1xuICpcbiAqIE5PVEU6IG9ubHkgcG5wbSBpcyBzdXBwb3J0ZWQgYXQgdGhlIG1vbWVudFxuICovXG5leHBvcnQgY29uc3QgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHJvb3QgPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGgoKTtcbiAgY29uc3QgcGFja2FnZXNHbG9icyA9IGF3YWl0IHJlYWRQYWNrYWdlc0dsb2JzQXQocm9vdCk7XG4gIHJldHVybiB7XG4gICAgcm9vdCxcbiAgICBwYWNrYWdlc0dsb2JzLFxuICB9O1xufSk7XG4iLCJpbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBoYXNUdXJib0pzb24gfSBmcm9tICcuLi90dXJibyc7XG5pbXBvcnQgeyByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzIH0gZnJvbSAnLi9yZWFkUGFja2FnZXNHbG9icyc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24oKSB7XG4gIGNvbnN0IFt7IHJvb3QsIHBhY2thZ2VzR2xvYnMgfSwgaGFzVHVyYm9dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMoKSxcbiAgICBoYXNUdXJib0pzb24oKSxcbiAgXSk7XG4gIGlmIChwYWNrYWdlc0dsb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB7XG4gICAgICByb290LFxuICAgICAgcGFja2FnZXNHbG9icyxcbiAgICAgIHBhY2thZ2VMb2NhdGlvbnM6IFtdLFxuICAgICAgaGFzVHVyYm8sXG4gICAgICB0eXBlOiAnc2luZ2xlLXBhY2thZ2UnIGFzIGNvbnN0LFxuICAgIH07XG4gIH1cbiAgY29uc3QgcGFja2FnZUxvY2F0aW9ucyA9IGF3YWl0IGZnKFxuICAgIHBhY2thZ2VzR2xvYnMubWFwKChnbG9iKSA9PiBgJHtnbG9ifS9wYWNrYWdlLmpzb25gKSxcbiAgICB7XG4gICAgICBjd2Q6IHJvb3QsXG4gICAgfVxuICApO1xuICByZXR1cm4ge1xuICAgIHJvb3QsXG4gICAgcGFja2FnZXNHbG9icyxcbiAgICBwYWNrYWdlTG9jYXRpb25zOiBwYWNrYWdlTG9jYXRpb25zLm1hcCgobG9jYXRpb24pID0+IGRpcm5hbWUobG9jYXRpb24pKSxcbiAgICBoYXNUdXJibyxcbiAgICB0eXBlOiAnbXVsdGlwbGUtcGFja2FnZXMnIGFzIGNvbnN0LFxuICB9O1xufVxuIiwiaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IGlzRGlyZWN0b3J5IH0gZnJvbSAnLi9pc0RpcmVjdG9yeSc7XG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi9tb2R1bGVSb290RGlyZWN0b3J5JztcbmltcG9ydCB7IHVwd2FyZERpcmVjdG9yeVNlYXJjaCB9IGZyb20gJy4vdXB3YXJkRGlyZWN0b3J5U2VhcmNoJztcblxuZXhwb3J0IHsgcmVhZFBhY2thZ2VKc29uIH0gZnJvbSAnLi4vcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbic7XG5leHBvcnQgeyBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24gfSBmcm9tICcuL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbic7XG5leHBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3JlcG9zaXRvcnlSb290UGF0aCc7XG5cbi8vIGZ1bmN0aW9uIHBhY2thZ2VOYW1lKFtrZXksIHZhbHVlXTogW3N0cmluZywgc3RyaW5nXSkge1xuLy8gICBpZiAodmFsdWUuc3RhcnRzV2l0aCgnd29ya3NwYWNlOicpKSB7XG4vLyAgICAgLy8gd29ya3NwYWNlOnBhY2thZ2VAc2VtLnZlci54XG4vLyAgICAgY29uc3QgcmVzdWx0ID0gL3dvcmtzcGFjZTooLiopQCguKikvLmV4ZWModmFsdWUpO1xuLy8gICAgIGlmIChyZXN1bHQpIHtcbi8vICAgICAgIGNvbnN0IFssIHBhY2thZ2VOYW1lXSA9IHJlc3VsdDtcbi8vICAgICAgIGlmIChwYWNrYWdlTmFtZSkge1xuLy8gICAgICAgICByZXR1cm4gcGFja2FnZU5hbWU7XG4vLyAgICAgICB9XG4vLyAgICAgfVxuLy8gICB9XG4vLyAgIGlmICh2YWx1ZS5zdGFydHNXaXRoKCducG06JykpIHtcbi8vICAgICAvLyBucG06cGFja2FnZUBzZW0udmVyLnhcbi8vICAgICBjb25zdCByZXN1bHQgPSAvbnBtOiguKilAKC4qKS8uZXhlYyh2YWx1ZSk7XG4vLyAgICAgaWYgKHJlc3VsdCkge1xuLy8gICAgICAgY29uc3QgWywgcGFja2FnZU5hbWVdID0gcmVzdWx0O1xuLy8gICAgICAgaWYgKHBhY2thZ2VOYW1lKSB7XG4vLyAgICAgICAgIHJldHVybiBwYWNrYWdlTmFtZTtcbi8vICAgICAgIH1cbi8vICAgICB9XG4vLyAgIH1cbi8vICAgcmV0dXJuIGtleTtcbi8vIH1cblxuYXN5bmMgZnVuY3Rpb24gbG9va3VwKG9wdHM6IHsgcGF0aDogc3RyaW5nOyBsb29rdXBQYWNrYWdlTmFtZTogc3RyaW5nIH0pIHtcbiAgcmV0dXJuIGF3YWl0IHVwd2FyZERpcmVjdG9yeVNlYXJjaCh7XG4gICAgc3RhcnQ6IG1vZHVsZVJvb3REaXJlY3RvcnkoKSxcbiAgICBhcHBlbmRQYXRoOiBqb2luKCdub2RlX21vZHVsZXMnLCBvcHRzLmxvb2t1cFBhY2thZ2VOYW1lKSxcbiAgICB0ZXN0OiBpc0RpcmVjdG9yeSxcbiAgfSk7XG59XG5cbi8vIGFzeW5jIGZ1bmN0aW9uIGZpbmRBbHRlcm5hdGl2ZU5hbWUob3B0czogeyB3cmFwcGVyUGFja2FnZU5hbWU6IHN0cmluZyB9KSB7XG4vLyAgIC8vIGxvb2t1cCBmb3IgYWx0ZXJuYXRpdmUgbmFtZSBvZiBAcmVwa2Eta2l0L3RzXG4vLyAgIGNvbnN0IHdyYXBwZXJBbGlhc05hbWUgPSBhd2FpdCByZWFkQ3dkUGFja2FnZUpzb24oKVxuLy8gICAgIC50aGVuKChyZXN1bHQpID0+IHtcbi8vICAgICAgIGNvbnN0IGRlcGVuZGVuY3kgPSBPYmplY3QuZW50cmllcyhyZXN1bHQuZGV2RGVwZW5kZW5jaWVzIHx8IHt9KS5maW5kKFxuLy8gICAgICAgICAoZGVwZW5kZW5jeSkgPT4gcGFja2FnZU5hbWUoZGVwZW5kZW5jeSkgPT09IG9wdHMud3JhcHBlclBhY2thZ2VOYW1lXG4vLyAgICAgICApO1xuLy8gICAgICAgcmV0dXJuIGRlcGVuZGVuY3kgPyBkZXBlbmRlbmN5WzBdIDogdW5kZWZpbmVkO1xuLy8gICAgIH0pXG4vLyAgICAgLmNhdGNoKChlcnIpID0+IHtcbi8vICAgICAgIGxvZ2dlci53YXJuKCdDYW5ub3QgcmVhZCBwYWNrYWdlIGpzb24nLCBlcnIpO1xuLy8gICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbi8vICAgICB9KTtcbi8vICAgcmV0dXJuIHdyYXBwZXJBbGlhc05hbWU7XG4vLyB9XG5cbi8qKlxuICogTG9va3VwIGxvY2F0aW9uIGZvciBkZXZEZXBlbmRlbmNpZXMgb2YgXCJAcmVwa2Eta2l0L3RzXCIgLSB0aGlzIGZ1bmN0aW9uIHdpbGxcbiAqIGxvb2t1cCBmb3IgXCJvcHRzLmxvb2t1cFBhY2thZ2VOYW1lXCIsIGl0IGZhdm91cnMgdGhlIGxvY2FsIC4vbm9kZV9tb2R1bGVzLyBwYXRoXG4gKiBhbmQgZmFsbHMgYmFjayB0byB0aGUgbW9ub3JlcG8gcm9vdC5cbiAqXG4gKiBUaGlzIHdpbGwgYWxzbyB0cnkgdG8gbG9va3VwIGFsaWFzIG9mIHRoZSBcIkByZXBrYS1raXQvdHNcIiBwYWNrYWdlIGFuZCBpZiB0aGF0IGlzIGRlZmluZWRcbiAqIHdpbGwgdHJ5IHRvIGZpbmQgdGhlIGRlcGVuZGVuY2llcyBpbiB0aGUgZGVwZW5kZW5jaWVzIG9mIHRoZSBhbGlhc2VkIHBhY2thZ2UuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmaW5kRGV2RGVwZW5kZW5jeShvcHRzOiB7XG4gIHdyYXBwZXJQYWNrYWdlTmFtZT86IHN0cmluZztcbiAgbG9va3VwUGFja2FnZU5hbWU6IHN0cmluZztcbn0pIHtcbiAgY29uc3QgbG9va3VwUGFja2FnZU5hbWUgPSBvcHRzLmxvb2t1cFBhY2thZ2VOYW1lO1xuICAvLyBjb25zdCB3cmFwcGVyUGFja2FnZU5hbWUgPSBvcHRzLndyYXBwZXJQYWNrYWdlTmFtZSA/PyAnQHJlcGthLWtpdC90cyc7XG5cbiAgLy8gY29uc3QgYWx0ZXJuYXRpdmVQYWNrYWdlTmFtZSA9IGF3YWl0IGZpbmRBbHRlcm5hdGl2ZU5hbWUoe1xuICAvLyAgIHdyYXBwZXJQYWNrYWdlTmFtZSxcbiAgLy8gfSk7XG5cbiAgcmV0dXJuIGF3YWl0IGxvb2t1cCh7XG4gICAgcGF0aDogbW9kdWxlUm9vdERpcmVjdG9yeSgpLFxuICAgIGxvb2t1cFBhY2thZ2VOYW1lLFxuICB9KTtcbn1cbiIsImltcG9ydCB0eXBlIHsgQ29uZmlnIH0gZnJvbSAnQGplc3QvdHlwZXMnO1xuaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4uL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmltcG9ydCB7IHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlIH0gZnJvbSAnLi4vdHVyYm8nO1xuXG5hc3luYyBmdW5jdGlvbiBsb2FkU3RhbmRhcmRHbG9iYWxIb29rKFxuICBzY3JpcHQ6IHN0cmluZyxcbiAgZ2xvYmFsQ29uZmlnOiBDb25maWcuR2xvYmFsQ29uZmlnLFxuICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZ1xuKSB7XG4gIGNvbnN0IGxvY2F0aW9uID0gam9pbihwcm9qZWN0Q29uZmlnLnJvb3REaXIsIHNjcmlwdCk7XG4gIGNvbnN0IGhhc0hvb2sgPSBhd2FpdCBzdGF0KGxvY2F0aW9uKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuICByZXR1cm4ge1xuICAgIGhhc0hvb2ssXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFoYXNIb29rKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc3VsdCA9IChhd2FpdCBpbXBvcnQobG9jYXRpb24pKSBhc1xuICAgICAgICB8IHtcbiAgICAgICAgICAgIGRlZmF1bHQ/OiAoXG4gICAgICAgICAgICAgIGdsb2JhbENvbmZpZzogQ29uZmlnLkdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgICAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWdcbiAgICAgICAgICAgICkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgICAgICAgICB9XG4gICAgICAgIHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKCFyZXN1bHQgfHwgIXJlc3VsdC5kZWZhdWx0KSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGDimqDvuI8gTm8gZGVmYXVsdCBleHBvcnQgZm91bmQgaW4gXCIke3NjcmlwdH1cImApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBhd2FpdCBQcm9taXNlLnJlc29sdmUocmVzdWx0LmRlZmF1bHQoZ2xvYmFsQ29uZmlnLCBwcm9qZWN0Q29uZmlnKSk7XG4gICAgfSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEN1c3RvbUdsb2JhbEhvb2soXG4gIHNjcmlwdDogc3RyaW5nLFxuICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZ1xuKSB7XG4gIGNvbnN0IGxvY2F0aW9uID0gam9pbihwcm9qZWN0Q29uZmlnLnJvb3REaXIsIHNjcmlwdCk7XG4gIGNvbnN0IGhhc0hvb2sgPSBhd2FpdCBzdGF0KGxvY2F0aW9uKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuICByZXR1cm4ge1xuICAgIGhhc0hvb2ssXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFoYXNIb29rKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHBhY2thZ2VKc29uID0gYXdhaXQgcmVhZFBhY2thZ2VKc29uKFxuICAgICAgICBqb2luKHByb2Nlc3MuY3dkKCksICdwYWNrYWdlLmpzb24nKVxuICAgICAgKTtcblxuICAgICAgaWYgKFxuICAgICAgICBsb2NhdGlvbi5lbmRzV2l0aCgnc2V0dXAudHMnKSAmJlxuICAgICAgICB0eXBlb2YgcGFja2FnZUpzb25bJ3NjcmlwdHMnXSA9PT0gJ29iamVjdCcgJiZcbiAgICAgICAgcGFja2FnZUpzb25bJ3NjcmlwdHMnXVsnc2V0dXA6aW50ZWdyYXRpb24nXSA9PT0gYHRzeCAke3NjcmlwdH1gXG4gICAgICApIHtcbiAgICAgICAgYXdhaXQgcnVuVHVyYm9UYXNrc0ZvclNpbmdsZVBhY2thZ2Uoe1xuICAgICAgICAgIHRhc2tzOiBbJ3NldHVwOmludGVncmF0aW9uJ10sXG4gICAgICAgICAgc3Bhd25PcHRzOiB7XG4gICAgICAgICAgICBleGl0Q29kZXM6IFswXSxcbiAgICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICAgICAgTE9HX0xFVkVMOiBsb2dnZXIubG9nTGV2ZWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbCgndHN4JywgW2xvY2F0aW9uXSwge1xuICAgICAgICAgIGV4aXRDb2RlczogWzBdLFxuICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgICBMT0dfTEVWRUw6IGxvZ2dlci5sb2dMZXZlbCxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZEFuZFJ1bkdsb2JhbEhvb2soXG4gIHNjcmlwdDogc3RyaW5nLFxuICBnbG9iYWxDb25maWc6IENvbmZpZy5HbG9iYWxDb25maWcsXG4gIHByb2plY3RDb25maWc6IENvbmZpZy5Qcm9qZWN0Q29uZmlnLFxuICB0aXA/OiBzdHJpbmdcbikge1xuICBjb25zdCBbc3RhbmRhcmQsIGN1c3RvbV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgbG9hZFN0YW5kYXJkR2xvYmFsSG9vayhgJHtzY3JpcHR9Lm1qc2AsIGdsb2JhbENvbmZpZywgcHJvamVjdENvbmZpZyksXG4gICAgbG9hZEN1c3RvbUdsb2JhbEhvb2soYCR7c2NyaXB0fS50c2AsIHByb2plY3RDb25maWcpLFxuICBdKTtcbiAgaWYgKCFjdXN0b20uaGFzSG9vayAmJiB0aXApIHtcbiAgICBsb2dnZXIudGlwKHRpcCk7XG4gIH1cbiAgYXdhaXQgc3RhbmRhcmQuZXhlY3V0ZSgpO1xuICBhd2FpdCBjdXN0b20uZXhlY3V0ZSgpO1xufVxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgZmluZERldkRlcGVuZGVuY3kgfSBmcm9tICcuLi91dGlscy9maW5kRGV2RGVwZW5kZW5jeSc7XG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICcuLi91dGlscy9vbmNlQXN5bmMnO1xuXG5leHBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmV4cG9ydCB7IGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbiB9IGZyb20gJy4uL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbic7XG5leHBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuLi91dGlscy9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuZXhwb3J0IHsgbG9hZEFuZFJ1bkdsb2JhbEhvb2sgfSBmcm9tICcuL2xvYWRBbmRSdW5HbG9iYWxIb29rJztcblxuZXhwb3J0IGNvbnN0IGplc3RQbHVnaW5Sb290ID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmluZERldkRlcGVuZGVuY3koe1xuICAgIGxvb2t1cFBhY2thZ2VOYW1lOiAnZXNidWlsZC1qZXN0JyxcbiAgfSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgbG9nZ2VyLndhcm4oXG4gICAgICAnSmVzdCBwbHVnaW5zIHJvb3QgY2Fubm90IGJlIGRldGVybWluZWQuIERvIHlvdSBoYXZlIFwiQHJlcGthLWtpdC90c1wiIGluIGRldkRlcGVuZGVuY2llcyBhdCB0aGUgbW9ub3JlcG8gcm9vdCBvciBhdCB0aGUgbG9jYWwgcGFja2FnZT8nXG4gICAgKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAobG9nZ2VyLmxvZ0xldmVsID09PSAnZGVidWcnKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ0ZvdW5kIGplc3QgcGx1Z2lucyByb290IGF0JywgZGlybmFtZShyZXN1bHQpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdCA/IGRpcm5hbWUocmVzdWx0KSA6ICcuJztcbn0pO1xuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFPLFNBQUEsSUFBQSxDQUFpQixFQUFzQixFQUFBO0FBQzVDLEVBQUksSUFBQSxLQUFBLENBQUE7QUFDSixFQUFBLElBQUksVUFBYSxHQUFBLEtBQUEsQ0FBQTtBQUNqQixFQUFBLE9BQU8sTUFBUztBQUNkLElBQUEsSUFBSSxVQUFZLEVBQUE7QUFDZCxNQUFPLE9BQUEsS0FBQSxDQUFBO0FBQUEsS0FDVDtBQUNBLElBQUEsS0FBQSxHQUFRLEVBQUcsRUFBQSxDQUFBO0FBQ1gsSUFBYSxVQUFBLEdBQUEsSUFBQSxDQUFBO0FBQ2IsSUFBTyxPQUFBLEtBQUEsQ0FBQTtBQUFBLEdBQ1QsQ0FBQTtBQUNGOztBQ1RBLE1BQU0sU0FBUyxDQUFDLE9BQUEsRUFBUyxNQUFRLEVBQUEsTUFBQSxFQUFRLFNBQVMsT0FBTyxDQUFBLENBQUE7QUFtQnpELE1BQU0sa0JBQUEsR0FBcUIsQ0FBQyxLQUE0QixLQUFBO0FBQ3RELEVBQUEsSUFBSSxV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
