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
  return Promise.resolve(result);
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

function modulesBinPath(bin) {
  return join(moduleRootDirectory(), `./node_modules/.bin/${bin}`);
}

const turboPath = () => modulesBinPath("turbo");
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
  return await spawnOutputConditional(turboPath(), cliArgsPipe([inheritTurboForceArgFromEnv()], [
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
    logger.error(err);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWxzL29uY2UudHMiLCIuLi8uLi9zcmMvbG9nZ2VyL2xvZ2dlci50cyIsIi4uLy4uL3NyYy91dGlscy9vbmNlQXN5bmMudHMiLCIuLi8uLi9zcmMvcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbi50cyIsIi4uLy4uL3NyYy91dGlscy9pc1RydXRoeS50cyIsIi4uLy4uL3NyYy91dGlscy9yZXBvc2l0b3J5Um9vdFBhdGgudHMiLCIuLi8uLi9zcmMvdXRpbHMvc3RhY2tUcmFjZS50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduVG9Qcm9taXNlLnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25SZXN1bHQudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3bk91dHB1dC50cyIsIi4uLy4uL3NyYy91dGlscy9jbGlBcmdzUGlwZS50cyIsIi4uLy4uL3NyYy91dGlscy9tb2R1bGVSb290RGlyZWN0b3J5LnRzIiwiLi4vLi4vc3JjL3V0aWxzL21vZHVsZXNCaW5QYXRoLnRzIiwiLi4vLi4vc3JjL3R1cmJvLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy91dGlscy9maW5kRGV2RGVwZW5kZW5jeS50cyIsIi4uLy4uL3NyYy9qZXN0L2xvYWRBbmRSdW5HbG9iYWxIb29rLnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdENvbmZpZ0hlbHBlcnMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIG9uY2U8VD4oZm46ICgpID0+IFQpOiAoKSA9PiBUIHtcbiAgbGV0IHZhbHVlOiBUO1xuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xuICByZXR1cm4gKCk6IFQgPT4ge1xuICAgIGlmIChjYWxjdWxhdGVkKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHZhbHVlID0gZm4oKTtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG59XG4iLCJpbXBvcnQgeyBvbmNlIH0gZnJvbSAnLi4vdXRpbHMvb25jZSc7XG5cbmNvbnN0IGxldmVscyA9IFsnZGVidWcnLCAnaW5mbycsICd3YXJuJywgJ2Vycm9yJywgJ2ZhdGFsJ10gYXMgY29uc3Q7XG5cbnR5cGUgTG9nTGV2ZWwgPSB0eXBlb2YgbGV2ZWxzW251bWJlcl07XG5cbnR5cGUgUGFyYW1zID0gUGFyYW1ldGVyczx0eXBlb2YgY29uc29sZS5sb2c+O1xuXG50eXBlIExvZ2dlciA9IHtcbiAgbG9nTGV2ZWw6IExvZ0xldmVsO1xuICBkZWJ1ZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGluZm8oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBhbGlhcyBmb3IgaW5mb1xuICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBzcGVjaWFsIHRyZWF0bWVudCwgZGlzYWJsZWQgb24gQ0kvVFRZXG4gIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbn07XG5cbmNvbnN0IGVuYWJsZWRMZXZlbHNBZnRlciA9IChsZXZlbDogTG9nTGV2ZWwgfCAnb2ZmJykgPT4ge1xuICBpZiAobGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIGNvbnN0IGluZGV4ID0gbGV2ZWxzLmZpbmRJbmRleCgoaXRlbSkgPT4gaXRlbSA9PT0gbGV2ZWwpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxldmVsJyk7XG4gIH1cbiAgcmV0dXJuIGxldmVscy5zbGljZShpbmRleCk7XG59O1xuXG5jb25zdCBpc0xldmVsID0gKGxldmVsPzogc3RyaW5nKTogbGV2ZWwgaXMgTG9nTGV2ZWwgPT4ge1xuICByZXR1cm4gbGV2ZWxzLmluY2x1ZGVzKGxldmVsIGFzIExvZ0xldmVsKTtcbn07XG5cbmNvbnN0IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncyA9IChcbiAgYXJncyA9IHByb2Nlc3MuYXJndlxuKTogTG9nTGV2ZWwgfCAnb2ZmJyB8IHVuZGVmaW5lZCA9PiB7XG4gIGNvbnN0IGluZGV4ID0gYXJncy5maW5kSW5kZXgoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gJy0tbG9nLWxldmVsJyk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGNvbnN0IGxldmVsID0gYXJnc1tpbmRleCArIDFdO1xuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiAnb2ZmJztcbiAgfVxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlGcm9tRW52ID0gKCk6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xuICBjb25zdCBsZXZlbCA9IHByb2Nlc3MuZW52WydMT0dfTEVWRUwnXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgZ2V0VmVyYm9zaXR5Q29uZmlnID0gKCkgPT4ge1xuICBjb25zdCBhcmdzTGV2ZWwgPSB2ZXJib3NpdHlGcm9tUHJvY2Vzc0FyZ3MoKTtcbiAgY29uc3QgZW52TGV2ZWwgPSB2ZXJib3NpdHlGcm9tRW52KCk7XG4gIHJldHVybiBhcmdzTGV2ZWwgPz8gZW52TGV2ZWwgPz8gJ2luZm8nO1xufTtcblxuY29uc3Qgbm9vcCA9ICguLi5fYXJnczogUGFyYW1zKSA9PiB7XG4gIHJldHVybjtcbn07XG5cbmNvbnN0IGxvZyA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5sb2coLi4uYXJncyk7XG59O1xuXG5jb25zdCBlcnJvciA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5lcnJvciguLi5hcmdzKTtcbn07XG5cbmNvbnN0IHNob3VsZEVuYWJsZVRpcCA9ICgpID0+ICFwcm9jZXNzLmVudlsnQ0knXSAmJiAhcHJvY2Vzcy5zdGRvdXQuaXNUVFk7XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoXG4gIGRlcHMgPSB7IGdldFZlcmJvc2l0eUNvbmZpZywgbG9nLCBlcnJvciwgc2hvdWxkRW5hYmxlVGlwIH1cbikgPT4ge1xuICBjb25zdCBsb2dMZXZlbCA9IGRlcHMuZ2V0VmVyYm9zaXR5Q29uZmlnKCk7XG4gIGNvbnN0IGVuYWJsZWQgPSBlbmFibGVkTGV2ZWxzQWZ0ZXIobG9nTGV2ZWwpO1xuICByZXR1cm4gbGV2ZWxzLnJlZHVjZShcbiAgICAoYWNjLCBsdmwpID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmFjYyxcbiAgICAgICAgW2x2bF06IGVuYWJsZWQuaW5jbHVkZXMobHZsKVxuICAgICAgICAgID8gWydmYXRhbCcsICdlcnJvciddLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICAgID8gZGVwcy5lcnJvclxuICAgICAgICAgICAgOiBkZXBzLmxvZ1xuICAgICAgICAgIDogbm9vcCxcbiAgICAgIH07XG4gICAgfSxcbiAgICB7XG4gICAgICBsb2dMZXZlbCxcbiAgICAgIGxvZzogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpID8gZGVwcy5sb2cgOiBub29wLFxuICAgICAgdGlwOiBlbmFibGVkLmluY2x1ZGVzKCdpbmZvJykgJiYgZGVwcy5zaG91bGRFbmFibGVUaXAoKSA/IGRlcHMubG9nIDogbm9vcCxcbiAgICB9IGFzIExvZ2dlclxuICApO1xufTtcblxuY29uc3QgY3JlYXRlRGVsZWdhdGluZ0xvZ2dlciA9IChvcHRzOiB7IHBhcmVudDogTG9nZ2VyIH0pOiBMb2dnZXIgPT5cbiAgT2JqZWN0LmZyZWV6ZSh7XG4gICAgZ2V0IGxvZ0xldmVsKCkge1xuICAgICAgcmV0dXJuIG9wdHMucGFyZW50LmxvZ0xldmVsO1xuICAgIH0sXG4gICAgZGVidWcoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmRlYnVnKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5pbmZvKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmxvZyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgdGlwKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC50aXAoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50Lndhcm4oLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGVycm9yKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5lcnJvciguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgZmF0YWwoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmZhdGFsKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgfSk7XG5cbmxldCBkZWZhdWx0TG9nZ2VyRmFjdG9yeTogKCgpID0+IExvZ2dlcikgfCBudWxsO1xuXG5leHBvcnQgY29uc3QgY29uZmlndXJlRGVmYXVsdExvZ2dlciA9IChmYWN0b3J5OiAoKSA9PiBMb2dnZXIpID0+IHtcbiAgaWYgKGRlZmF1bHRMb2dnZXJGYWN0b3J5KSB7XG4gICAgY29uc3QgZXJyb3IgPSB7XG4gICAgICBzdGFjazogJycsXG4gICAgfTtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShlcnJvcik7XG4gICAgbG9nZ2VyLmRlYnVnKCdDYW5ub3Qgb3ZlcnJpZGUgZGVmYXVsdCBsb2dnZXIgbXVsdGlwbGUgdGltZXMnLCBlcnJvci5zdGFjayk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGRlZmF1bHRMb2dnZXJGYWN0b3J5ID0gZmFjdG9yeTtcbn07XG5cbmNvbnN0IGRlZmF1bHRMb2dnZXIgPSBvbmNlKCgpID0+IHtcbiAgbGV0IGZhY3RvcnkgPSBkZWZhdWx0TG9nZ2VyRmFjdG9yeTtcbiAgaWYgKCFmYWN0b3J5KSB7XG4gICAgZmFjdG9yeSA9ICgpID0+IGNyZWF0ZUxvZ2dlcigpO1xuICB9XG4gIHJldHVybiBmYWN0b3J5KCk7XG59KTtcblxuLyoqXG4gKiBEZWZhdWx0IGxvZ2dlciBpbnN0YW5jZSBjYW4gYmUgY29uZmlndXJlZCBvbmNlIGF0IHN0YXJ0dXBcbiAqL1xuZXhwb3J0IGNvbnN0IGxvZ2dlcjogTG9nZ2VyID0gY3JlYXRlRGVsZWdhdGluZ0xvZ2dlcih7XG4gIGdldCBwYXJlbnQoKSB7XG4gICAgcmV0dXJuIGRlZmF1bHRMb2dnZXIoKTtcbiAgfSxcbn0pO1xuIiwiZXhwb3J0IGZ1bmN0aW9uIG9uY2VBc3luYzxUPihmbjogKCkgPT4gVCB8IFByb21pc2U8VD4pOiAoKSA9PiBQcm9taXNlPFQ+IHtcbiAgbGV0IHZhbHVlOiBUO1xuICBsZXQgaW5GbGlnaHQ6IFByb21pc2U8VD4gfCBudWxsO1xuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xuICByZXR1cm4gYXN5bmMgKCk6IFByb21pc2U8VD4gPT4ge1xuICAgIGlmIChjYWxjdWxhdGVkKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGlmIChpbkZsaWdodCkge1xuICAgICAgcmV0dXJuIGluRmxpZ2h0O1xuICAgIH1cbiAgICBpbkZsaWdodCA9IFByb21pc2UucmVzb2x2ZShmbigpKTtcbiAgICB2YWx1ZSA9IGF3YWl0IGluRmxpZ2h0O1xuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xuICAgIGluRmxpZ2h0ID0gbnVsbDtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG59XG4iLCJpbXBvcnQgeyByZWFkRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJy4uL3V0aWxzL29uY2VBc3luYyc7XG5pbXBvcnQgdHlwZSB7IFBhY2thZ2VKc29uIH0gZnJvbSAnLi9wYWNrYWdlSnNvbic7XG5cbmNvbnN0IGN3ZFBhY2thZ2VKc29uUGF0aCA9ICgpID0+IGpvaW4ocHJvY2Vzcy5jd2QoKSwgJy4vcGFja2FnZS5qc29uJyk7XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbkF0KHBhdGg6IHN0cmluZyk6IFByb21pc2U8UGFja2FnZUpzb24+IHtcbiAgcmV0dXJuIGF3YWl0IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpLnRoZW4oXG4gICAgKHJlc3VsdCkgPT4gSlNPTi5wYXJzZShyZXN1bHQpIGFzIFBhY2thZ2VKc29uXG4gICk7XG59XG5cbmV4cG9ydCBjb25zdCByZWFkQ3dkUGFja2FnZUpzb24gPSBvbmNlQXN5bmMoKCkgPT5cbiAgcmVhZFBhY2thZ2VKc29uQXQoY3dkUGFja2FnZUpzb25QYXRoKCkpXG4pO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZFBhY2thZ2VKc29uKHBhdGg6IHN0cmluZyk6IFByb21pc2U8UGFja2FnZUpzb24+IHtcbiAgLy8gYXNzdW1pbmcgY3VycmVudCBkaXJlY3RvcnkgZG9lc24ndCBjaGFuZ2Ugd2hpbGUgYXBwIGlzIHJ1bm5pbmdcbiAgcmV0dXJuIHByb2Nlc3MuY3dkKCkgPT09IGN3ZFBhY2thZ2VKc29uUGF0aCgpXG4gICAgPyBhd2FpdCByZWFkQ3dkUGFja2FnZUpzb24oKVxuICAgIDogYXdhaXQgcmVhZFBhY2thZ2VKc29uQXQocGF0aCk7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gaXNUcnV0aHk8VD4oXG4gIHZhbHVlOiBOb25OdWxsYWJsZTxUPiB8IGZhbHNlIHwgbnVsbCB8IHVuZGVmaW5lZCB8ICcnIHwgMFxuKTogdmFsdWUgaXMgTm9uTnVsbGFibGU8VD4ge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSk7XG59XG4iLCJpbXBvcnQgYXNzZXJ0IGZyb20gJ2Fzc2VydCc7XG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcbmltcG9ydCB7IGRpcm5hbWUsIGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHsgaXNUcnV0aHkgfSBmcm9tICcuL2lzVHJ1dGh5JztcbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJy4vb25jZUFzeW5jJztcblxuY29uc3QgZ2V0UmVwb3NpdG9yeVJvb3RTY2FuQ2FuZGlkYXRlcyA9IChjdXJyZW50RGlyZWN0b3J5OiBzdHJpbmcpID0+IHtcbiAgLy8gaGF2aW5nICdwYWNrYWdlcy8qJyBpbiB0aGUgcm9vdCBvZiBhIG1vbm9yZXBvIGlzIHN1cGVyIGNvbW1vblxuICBjb25zdCByZXN1bHQgPSAvKC4qKD89XFwvcGFja2FnZXNcXC8pKXwoLiooPz1cXC9ub2RlX21vZHVsZXNcXC8pKXwoLiopLy5leGVjKFxuICAgIGN1cnJlbnREaXJlY3RvcnlcbiAgKTtcbiAgYXNzZXJ0KCEhcmVzdWx0KTtcbiAgY29uc3QgWywgcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdID0gcmVzdWx0O1xuICByZXR1cm4gW3BhY2thZ2VzUm9vdCwgbm9kZU1vZHVsZXNSb290XS5maWx0ZXIoaXNUcnV0aHkpO1xufTtcblxuLy8gcmV0dXJucyB0aGUgZmlyc3QgZGlyZWN0b3J5IHdoaWNoIGhhcyBtb25vcmVwbyBtYXJrZXJzLCBtdWx0aXBsZVxuLy8gZGlyZWN0b3JpZXMgY2FuIGhhdmUgdGhlbSAtIHdoaWNoZXZlciByZWFkIGZpcnN0IHdpbGwgYmUgcmV0dXJuZWRcbi8vIHNvIGlmIG9yZGVyIGlzIGltcG9ydGFudCAtIHNjYW5uaW5nIHNob3VsZCBiZSBzZXBhcmF0ZWQgdG8gbXVsdGlwbGUgam9ic1xuLy8gdmlhIHByaW9yaXRpemVkSGFzTW9ub3JlcG9NYXJrZXJzXG5jb25zdCBoYXNSb290TWFya2VycyA9IGFzeW5jIChjYW5kaWRhdGVzOiBzdHJpbmdbXSkgPT4ge1xuICBjb25zdCBtYXJrZXJzID0gW1xuICAgICcuZ2l0JyxcbiAgICAneWFybi5sb2NrJyxcbiAgICAncG5wbS1sb2NrLnlhbWwnLFxuICAgICdwYWNrYWdlLWxvY2suanNvbicsXG4gICAgJ3BucG0td29ya3NwYWNlLnlhbWwnLFxuICBdO1xuICBjb25zdCBtYXJrZXJzU3RyZWFtID0gZmcuc3RyZWFtKFxuICAgIGNhbmRpZGF0ZXMuZmxhdE1hcCgoZGlyKSA9PiBtYXJrZXJzLm1hcCgobWFya2VyKSA9PiBqb2luKGRpciwgbWFya2VyKSkpLFxuICAgIHtcbiAgICAgIG1hcmtEaXJlY3RvcmllczogdHJ1ZSxcbiAgICAgIG9ubHlGaWxlczogZmFsc2UsXG4gICAgfVxuICApO1xuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPigocmVzKSA9PiB7XG4gICAgbWFya2Vyc1N0cmVhbS5vbignZGF0YScsIChlbnRyeTogc3RyaW5nKSA9PiB7XG4gICAgICByZXMoZGlybmFtZShlbnRyeSkpO1xuICAgICAgaWYgKCdkZXN0cm95JyBpbiBtYXJrZXJzU3RyZWFtKSB7XG4gICAgICAgIChtYXJrZXJzU3RyZWFtIGFzIHVua25vd24gYXMgeyBkZXN0cm95OiAoKSA9PiB2b2lkIH0pLmRlc3Ryb3koKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBtYXJrZXJzU3RyZWFtLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICByZXModW5kZWZpbmVkKTtcbiAgICB9KTtcbiAgfSk7XG59O1xuXG5jb25zdCBwcmlvcml0aXplZEhhc01hcmtlcnMgPSAoam9iczogc3RyaW5nW11bXSkgPT4ge1xuICBpZiAoam9icy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gIH1cbiAgcmV0dXJuIG5ldyBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4oKHJlcykgPT4ge1xuICAgIGNvbnN0IHJlc3VsdHMgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nIHwgdW5kZWZpbmVkPigpO1xuXG4gICAgY29uc3QgY2hlY2tTaG91bGRDb21wbGV0ZSA9IChpbmRleDogbnVtYmVyLCByZXN1bHQ6IHN0cmluZyB8IHVuZGVmaW5lZCkgPT4ge1xuICAgICAgcmVzdWx0cy5zZXQoaW5kZXgsIHJlc3VsdCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGpvYnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3QgaGFzUmVzdWx0ID0gcmVzdWx0cy5oYXMoaSk7XG4gICAgICAgIGlmICghaGFzUmVzdWx0KSB7XG4gICAgICAgICAgLy8gaWYgYSBqb2Igd2l0aCBoaWdoZXN0IHByaW9yaXR5IGhhc24ndCBmaW5pc2hlZCB5ZXRcbiAgICAgICAgICAvLyB0aGVuIHdhaXQgZm9yIGl0XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzdWx0cy5nZXQoaSk7XG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAvLyBqb2IgZmluaXNoZWQgYW5kIHdlIGZvdW5kIG1hcmtlcnMsIGFsc28gYWxsIGpvYnNcbiAgICAgICAgICAvLyB3aXRoIGhpZ2hlciBwcmlvcml0eSBmaW5pc2hlZCBhbmQgdGhleSBkb24ndCBoYXZlXG4gICAgICAgICAgLy8gYW55IG1hcmtlcnMgLSB3ZSBhcmUgZG9uZVxuICAgICAgICAgIHJlcyhyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0cy5zaXplID09PSBqb2JzLmxlbmd0aCkge1xuICAgICAgICAvLyBhbGwgam9icyBmaW5pc2hlZCAtIG5vIG1hcmtlcnMgZm91bmRcbiAgICAgICAgcmVzKHVuZGVmaW5lZCk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGpvYnMuZm9yRWFjaCgoZGlyZWN0b3JpZXMsIGluZGV4KSA9PiB7XG4gICAgICBoYXNSb290TWFya2VycyhkaXJlY3RvcmllcylcbiAgICAgICAgLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGNoZWNrU2hvdWxkQ29tcGxldGUoaW5kZXgsIHJlc3VsdCk7XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gaWdub3JlXG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59O1xuXG5leHBvcnQgY29uc3QgcmVwb3NpdG9yeVJvb3RQYXRoVmlhRGlyZWN0b3J5U2NhbiA9IGFzeW5jIChcbiAgbG9va3VwRGlyZWN0b3J5OiBzdHJpbmdcbikgPT4ge1xuICBjb25zdCB1bmlxdWVEaXJuYW1lID0gKHBhdGg/OiBzdHJpbmcpID0+IHtcbiAgICBpZiAoIXBhdGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gZGlybmFtZShwYXRoKTtcbiAgICBpZiAocmVzdWx0ID09PSBwYXRoKSB7XG4gICAgICAvLyBlLmcuIHRoZSBwYXRoIHdhcyBhbHJlYWR5IGEgcm9vdCBcIi9cIlxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIGNvbnN0IHBhcmVudCA9IHVuaXF1ZURpcm5hbWUobG9va3VwRGlyZWN0b3J5KTtcbiAgY29uc3Qgc3VwZXJQYXJlbnQgPSB1bmlxdWVEaXJuYW1lKHBhcmVudCk7XG5cbiAgcmV0dXJuIChcbiAgICAoYXdhaXQgcHJpb3JpdGl6ZWRIYXNNYXJrZXJzKFxuICAgICAgLy8gc2NhbiBpbiBtb3N0IGxpa2VseSBsb2NhdGlvbnMgZmlyc3Qgd2l0aCBjdXJyZW50IGxvb2t1cCBkaXJlY3RvcnkgdGFraW5nIHByaW9yaXR5XG4gICAgICBbXG4gICAgICAgIFtsb29rdXBEaXJlY3RvcnldLFxuICAgICAgICBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzKGxvb2t1cERpcmVjdG9yeSksXG4gICAgICAgIC8vIHNjYW4gMiBkaXJlY3RvcmllcyB1cHdhcmRzXG4gICAgICAgIFtwYXJlbnRdLFxuICAgICAgICBbc3VwZXJQYXJlbnRdLFxuICAgICAgXVxuICAgICAgICAubWFwKChkaXJzKSA9PiBkaXJzLmZpbHRlcihpc1RydXRoeSkpXG4gICAgICAgIC5maWx0ZXIoKGpvYikgPT4gam9iLmxlbmd0aCA+IDApXG4gICAgKSkgfHwgbG9va3VwRGlyZWN0b3J5IC8qIGZhbGxiYWNrIHRvIGN1cnJlbnQgZGlyZWN0b3J5IGluIHdvcnNlIHNjZW5hcmlvICovXG4gICk7XG59O1xuXG4vKipcbiAqIERldGVybWluZSByZXBvc2l0b3J5IHJvb3QgcGF0aCBieSBzY2FubmluZyBjdXJyZW50IGFuZCBwYXJlbnQgZGlyZWN0b3JpZXNcbiAqIGFuZCBsb29raW5nIGZvciBtYXJrZXIgZmlsZXMvZGlycyBsaWtlOlxuICpcbiAqIC0gLmdpdFxuICogLSBwYWNrYWdlLWxvY2suanNvblxuICogLSB5YXJuLmxvY2tcbiAqIC0gcG5wbS1sb2NrLnlhbWxcbiAqIC0gcG5wbS13b3Jrc3BhY2UueWFtbFxuICovXG5leHBvcnQgY29uc3QgcmVwb3NpdG9yeVJvb3RQYXRoID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3Qgcm9vdFBhdGggPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuKHByb2Nlc3MuY3dkKCkpO1xuICByZXR1cm4gcm9vdFBhdGg7XG59KTtcbiIsIi8qKlxuICogQ2FwdHVyZSB0aGUgc3RhY2sgdHJhY2UgYW5kIGFsbG93IHRvIGVucmljaCBleGNlcHRpb25zIHRocm93biBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2tzXG4gKiB3aXRoIGFkZGl0aW9uYWwgc3RhY2sgaW5mb3JtYXRpb24gY2FwdHVyZWQgYXQgdGhlIG1vbWVudCBvZiB0aGUgY2FsbCBvZiB0aGlzIGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYXB0dXJlU3RhY2tUcmFjZShyZW1vdmUgPSAwKSB7XG4gIGNvbnN0IHN0YWNrQ29udGFpbmVyID0ge1xuICAgIHN0YWNrOiAnJyxcbiAgfTtcbiAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2Uoc3RhY2tDb250YWluZXIpO1xuICBjb25zdCBzdGFja1RyYWNlID0gc3RhY2tDb250YWluZXIuc3RhY2tcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLnNsaWNlKDYgKyByZW1vdmUpXG4gICAgLmpvaW4oJ1xcbicpO1xuICByZXR1cm4ge1xuICAgIC8qKlxuICAgICAqIENhcHR1cmVkIHN0YWNrIHRyYWNlIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgc3RhY2tUcmFjZSxcbiAgICAvKipcbiAgICAgKiBDYW4gYmUgY2FsbGVkIGluIGFzeW5jaHJvbm91cyBjYWxsYmFjayB0byBlbnJpY2ggZXhjZXB0aW9ucyB3aXRoIGFkZGl0aW9uYWwgaW5mb3JtYXRpb25cbiAgICAgKiBAcGFyYW0gZXJyIEV4Y2VwdGlvbiB0byBlbnJpY2ggLSBpdCBpcyBnb2luZyB0byBoYXZlIGl0cyBgLnN0YWNrYCBwcm9wIG11dGF0ZWRcbiAgICAgKiBAcmV0dXJucyBTYW1lIGV4Y2VwdGlvblxuICAgICAqL1xuICAgIHByZXBhcmVGb3JSZXRocm93OiAoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgY29uc3Qgb2xkU3RhY2tUcmFjZSA9IGVyci5zdGFjayA/PyAnJy5zcGxpdCgnXFxuJykuc2xpY2UoMSkuam9pbignXFxuJyk7XG4gICAgICBlcnIuc3RhY2sgPSBgJHtlcnIubmFtZSB8fCAnRXJyb3InfTogJHtcbiAgICAgICAgZXJyLm1lc3NhZ2VcbiAgICAgIH1cXG4ke29sZFN0YWNrVHJhY2V9XFxuJHtzdGFja1RyYWNlfWA7XG4gICAgICByZXR1cm4gZXJyO1xuICAgIH0sXG4gIH07XG59XG4iLCJpbXBvcnQgdHlwZSB7IFNwYXduT3B0aW9ucyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgQ2hpbGRQcm9jZXNzIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHR5cGUgeyBBc3NpZ24gfSBmcm9tICd1dGlsaXR5LXR5cGVzJztcblxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBjYXB0dXJlU3RhY2tUcmFjZSB9IGZyb20gJy4uL3V0aWxzL3N0YWNrVHJhY2UnO1xuXG5leHBvcnQgdHlwZSBTcGF3blRvUHJvbWlzZU9wdHMgPSB7XG4gIC8qKlxuICAgKiBTcGVjaWZ5IGV4aXQgY29kZXMgd2hpY2ggc2hvdWxkIG5vdCByZXN1bHQgaW4gdGhyb3dpbmcgYW4gZXJyb3Igd2hlblxuICAgKiB0aGUgcHJvY2VzcyBoYXMgZmluaXNoZWQsIGUuZy4gc3BlY2lmeWluZyBgWzBdYCBtZWFucyBpZiBwcm9jZXNzIGZpbmlzaGVkXG4gICAqIHdpdGggemVybyBleGl0IGNvZGUgdGhlbiB0aGUgcHJvbWlzZSB3aWxsIHJlc29sdmUgaW5zdGVhZCBvZiByZWplY3RpbmcuXG4gICAqXG4gICAqIEFsdGVybmF0aXZlbHksIHNwZWNpZnkgYGluaGVyaXRgIHRvIHNhdmUgc3RhdHVzIGNvZGUgdG8gdGhlIGN1cnJlbnQgYHByb2Nlc3MuZXhpdENvZGVgXG4gICAqXG4gICAqIEFsdGVybmF0aXZlbHksIGNvbXBsZXRlbHkgaWdub3JlIHRoZSBleGl0IGNvZGUgKGUuZy4geW91IGZvbGxvdyB1cCBhbmQgaW50ZXJyb2dhdGVcbiAgICogdGhlIHByb2Nlc3MgY29kZSBtYW51YWxseSBhZnRlcndhcmRzKVxuICAgKi9cbiAgZXhpdENvZGVzOiBudW1iZXJbXSB8ICdpbmhlcml0JyB8ICdhbnknO1xufTtcblxudHlwZSBTaGFyZWRPcHRzID0gUGljazxTcGF3bk9wdGlvbnMsICdjd2QnPjtcblxudHlwZSBTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4gPSBbXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgYXJnczogUmVhZG9ubHlBcnJheTxzdHJpbmc+LFxuICBvcHRpb25zOiBBc3NpZ248U3Bhd25PcHRpb25zLCBFPlxuXTtcblxuZXhwb3J0IHR5cGUgU3Bhd25PcHRpb25zV2l0aEV4dHJhPEUgZXh0ZW5kcyBvYmplY3QgPSBTcGF3blRvUHJvbWlzZU9wdHM+ID1cbiAgQXNzaWduPFNwYXduT3B0aW9ucywgRT47XG5cbmV4cG9ydCB0eXBlIFNwYXduUGFyYW1ldGVyTWl4PEUgZXh0ZW5kcyBvYmplY3QgPSBTcGF3blRvUHJvbWlzZU9wdHM+ID1cbiAgfCBbY3A6IENoaWxkUHJvY2VzcywgZXh0cmFPcHRzOiBBc3NpZ248RSwgU2hhcmVkT3B0cz5dXG4gIHwgU3Bhd25BcmdzPEU+O1xuXG5leHBvcnQgZnVuY3Rpb24gaXNTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4oXG4gIGFyZ3M6IFNwYXduUGFyYW1ldGVyTWl4PEU+XG4pOiBhcmdzIGlzIFNwYXduQXJnczxFPiB7XG4gIHJldHVybiAhKGFyZ3NbMF0gaW5zdGFuY2VvZiBDaGlsZFByb2Nlc3MpICYmIHR5cGVvZiBhcmdzWzBdID09PSAnc3RyaW5nJztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNwYXduV2l0aFNwYXduUGFyYW1ldGVyczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgcGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbikge1xuICBjb25zdCBbY2hpbGQsIFtjb21tYW5kLCBhcmdzLCBvcHRzXV0gPSBpc1NwYXduQXJncyhwYXJhbWV0ZXJzKVxuICAgID8gW1xuICAgICAgICBzcGF3biguLi4ocGFyYW1ldGVycyBhcyB1bmtub3duIGFzIFBhcmFtZXRlcnM8dHlwZW9mIHNwYXduPikpLFxuICAgICAgICBwYXJhbWV0ZXJzLFxuICAgICAgXVxuICAgIDogW1xuICAgICAgICBwYXJhbWV0ZXJzWzBdLFxuICAgICAgICBbXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmZpbGUsXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmFyZ3Muc2xpY2UoMSksXG4gICAgICAgICAgcGFyYW1ldGVyc1sxXSBhcyBBc3NpZ248U3Bhd25PcHRpb25zLCBFPixcbiAgICAgICAgXSxcbiAgICAgIF07XG4gIHJldHVybiB7XG4gICAgY2hpbGQsXG4gICAgY29tbWFuZCxcbiAgICBhcmdzLFxuICAgIG9wdHMsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blRvUHJvbWlzZShcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXhcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB7IGNoaWxkLCBjb21tYW5kLCBhcmdzLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHsgcHJlcGFyZUZvclJldGhyb3cgfSA9IGNhcHR1cmVTdGFja1RyYWNlKCk7XG5cbiAgY29uc3QgZXhpdENvZGVzID0gb3B0cy5leGl0Q29kZXM7XG5cbiAgY29uc3QgY3dkID0gb3B0cy5jd2QgPyBvcHRzLmN3ZC50b1N0cmluZygpIDogdW5kZWZpbmVkO1xuXG4gIGNvbnN0IGNtZCA9ICgpID0+IFtjb21tYW5kLCAuLi5hcmdzXS5qb2luKCcgJyk7XG5cbiAgbG9nZ2VyLmRlYnVnKFsnPicsIGNtZCgpXS5qb2luKCcgJyksIC4uLihjd2QgPyBbYGluICR7Y3dkfWBdIDogW10pKTtcblxuICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzLCByZWopID0+XG4gICAgY2hpbGRcbiAgICAgIC5vbignY2xvc2UnLCAoY29kZSwgc2lnbmFsKSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgY29kZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdpbmhlcml0JyAmJlxuICAgICAgICAgICAgZXhpdENvZGVzICE9PSAnYW55JyAmJlxuICAgICAgICAgICAgIWV4aXRDb2Rlcy5pbmNsdWRlcyhjb2RlKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgcmVqKFxuICAgICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgICBuZXcgRXJyb3IoYENvbW1hbmQgXCIke2NtZCgpfVwiIGhhcyBmYWlsZWQgd2l0aCBjb2RlICR7Y29kZX1gKVxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoc2lnbmFsKSB7XG4gICAgICAgICAgcmVqKFxuICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3coXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihgRmFpbGVkIHRvIGV4ZWN1dGUgY29tbWFuZCBcIiR7Y21kKCl9XCIgLSAke3NpZ25hbH1gKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgcHJlcGFyZUZvclJldGhyb3cobmV3IEVycm9yKCdFeHBlY3RlZCBzaWduYWwgb3IgZXJyb3IgY29kZScpKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5vbignZXJyb3InLCByZWopXG4gICk7XG4gIC8vIGluaGVyaXQgZXhpdCBjb2RlXG4gIGlmIChleGl0Q29kZXMgPT09ICdpbmhlcml0Jykge1xuICAgIGlmIChcbiAgICAgIHR5cGVvZiBjaGlsZC5leGl0Q29kZSA9PT0gJ251bWJlcicgJiZcbiAgICAgICh0eXBlb2YgcHJvY2Vzcy5leGl0Q29kZSAhPT0gJ251bWJlcicgfHwgcHJvY2Vzcy5leGl0Q29kZSA9PT0gMClcbiAgICApIHtcbiAgICAgIHByb2Nlc3MuZXhpdENvZGUgPSBjaGlsZC5leGl0Q29kZTtcbiAgICB9XG4gIH1cbn1cbiIsImltcG9ydCBhc3NlcnQgZnJvbSAnYXNzZXJ0JztcblxuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCwgU3Bhd25Ub1Byb21pc2VPcHRzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5pbXBvcnQgeyBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduVG9Qcm9taXNlIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0T3B0cyA9IHtcbiAgb3V0cHV0PzogWydzdGRvdXQnIHwgJ3N0ZGVycicsIC4uLkFycmF5PCdzdGRvdXQnIHwgJ3N0ZGVycic+XTtcbn0gJiBTcGF3blRvUHJvbWlzZU9wdHM7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0UmV0dXJuID0ge1xuICBwaWQ/OiBudW1iZXI7XG4gIG91dHB1dDogc3RyaW5nW107XG4gIHN0ZG91dDogc3RyaW5nO1xuICBzdGRlcnI6IHN0cmluZztcbiAgc3RhdHVzOiBudW1iZXIgfCBudWxsO1xuICBzaWduYWw6IE5vZGVKUy5TaWduYWxzIHwgbnVsbDtcbiAgZXJyb3I/OiBFcnJvciB8IHVuZGVmaW5lZDtcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blJlc3VsdChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxTcGF3blJlc3VsdFJldHVybj4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IGNvbWJpbmVkRGF0YTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc3Rkb3V0RGF0YTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc3RkZXJyRGF0YTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgb3V0cHV0ID0gb3B0cy5vdXRwdXQgPz8gWydzdGRvdXQnLCAnc3RkZXJyJ107XG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZG91dCcpKSB7XG4gICAgYXNzZXJ0KFxuICAgICAgISFjaGlsZC5zdGRvdXQsXG4gICAgICAnRXhwZWN0ZWQgXCIuc3Rkb3V0XCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xuICAgICk7XG4gICAgY2hpbGQuc3Rkb3V0LnNldEVuY29kaW5nKCd1dGYtOCcpO1xuICAgIGNoaWxkLnN0ZG91dC5vbignZGF0YScsIChkYXRhOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbWJpbmVkRGF0YS5wdXNoKGRhdGEpO1xuICAgICAgc3Rkb3V0RGF0YS5wdXNoKGRhdGEpO1xuICAgIH0pO1xuICB9XG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZGVycicpKSB7XG4gICAgYXNzZXJ0KFxuICAgICAgISFjaGlsZC5zdGRlcnIsXG4gICAgICAnRXhwZWN0ZWQgXCIuc3RkZXJyXCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xuICAgICk7XG4gICAgY2hpbGQuc3RkZXJyLnNldEVuY29kaW5nKCd1dGYtOCcpO1xuICAgIGNoaWxkLnN0ZGVyci5vbignZGF0YScsIChkYXRhOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbWJpbmVkRGF0YS5wdXNoKGRhdGEpO1xuICAgICAgc3RkZXJyRGF0YS5wdXNoKGRhdGEpO1xuICAgIH0pO1xuICB9XG4gIGNvbnN0IFtyZXN1bHRdID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFtzcGF3blRvUHJvbWlzZShjaGlsZCwgb3B0cyldKTtcbiAgcmV0dXJuIHtcbiAgICBwaWQ6IGNoaWxkLnBpZCxcbiAgICBzaWduYWw6IGNoaWxkLnNpZ25hbENvZGUsXG4gICAgc3RhdHVzOiBjaGlsZC5leGl0Q29kZSxcbiAgICBnZXQgb3V0cHV0KCkge1xuICAgICAgcmV0dXJuIGNvbWJpbmVkRGF0YTtcbiAgICB9LFxuICAgIGdldCBzdGRlcnIoKSB7XG4gICAgICByZXR1cm4gc3RkZXJyRGF0YS5qb2luKCcnKTtcbiAgICB9LFxuICAgIGdldCBzdGRvdXQoKSB7XG4gICAgICByZXR1cm4gc3Rkb3V0RGF0YS5qb2luKCcnKTtcbiAgICB9LFxuICAgIGdldCBlcnJvcigpIHtcbiAgICAgIHJldHVybiByZXN1bHQuc3RhdHVzID09PSAncmVqZWN0ZWQnXG4gICAgICAgID8gKHJlc3VsdC5yZWFzb24gYXMgRXJyb3IpXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIH0sXG4gIH07XG59XG4iLCJpbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB0eXBlIHsgU3Bhd25SZXN1bHRPcHRzLCBTcGF3blJlc3VsdFJldHVybiB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHsgc3Bhd25SZXN1bHQgfSBmcm9tICcuL3NwYXduUmVzdWx0JztcbmltcG9ydCB0eXBlIHsgU3Bhd25QYXJhbWV0ZXJNaXggfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25PdXRwdXQoXG4gIC4uLnBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4PFNwYXduUmVzdWx0T3B0cz5cbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHsgY2hpbGQsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc3Bhd25SZXN1bHQoY2hpbGQsIG9wdHMpO1xuICByZXR1cm4gcmVzdWx0Lm91dHB1dC5qb2luKCcnKTtcbn1cblxuY29uc3QgZGVmYXVsdFNob3VsZE91dHB1dCA9IChyZXN1bHQ6IFNwYXduUmVzdWx0UmV0dXJuKSA9PiB7XG4gIHJldHVybiByZXN1bHQuZXJyb3IgfHwgcmVzdWx0LnN0YXR1cyAhPT0gMCB8fCBsb2dnZXIubG9nTGV2ZWwgPT09ICdkZWJ1Zyc7XG59O1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25PdXRwdXRDb25kaXRpb25hbChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8XG4gICAgU3Bhd25SZXN1bHRPcHRzICYge1xuICAgICAgLyoqXG4gICAgICAgKiBCeSBkZWZhdWx0IHdpbGwgb3V0cHV0IHRvIGBzdGRlcnJgIHdoZW4gc3Bhd24gcmVzdWx0IGZhaWxlZCB3aXRoIGFuIGVycm9yLCB3aGVuXG4gICAgICAgKiBzdGF0dXMgY29kZSBpcyBub3QgemVybyBvciB3aGVuIGBMb2dnZXIubG9nTGV2ZWxgIGlzIGBkZWJ1Z2BcbiAgICAgICAqL1xuICAgICAgc2hvdWxkT3V0cHV0PzogKHJlc3VsdDogU3Bhd25SZXN1bHRSZXR1cm4pID0+IGJvb2xlYW47XG4gICAgfVxuICA+XG4pIHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwgb3B0cyk7XG4gIGNvbnN0IHNob3VsZE91dHB1dCA9IG9wdHMuc2hvdWxkT3V0cHV0ID8/IGRlZmF1bHRTaG91bGRPdXRwdXQ7XG4gIGlmIChzaG91bGRPdXRwdXQocmVzdWx0KSkge1xuICAgIGxvZ2dlci5lcnJvcihyZXN1bHQub3V0cHV0LmpvaW4oJycpKTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gaW5jbHVkZXNBbnlPZih0YXJnZXQ6IHN0cmluZ1tdLCBoYXNBbnlPZkFyZ3M6IHN0cmluZ1tdKSB7XG4gIHJldHVybiBoYXNBbnlPZkFyZ3Muc29tZSgodmFyaWFudCkgPT4gdGFyZ2V0LmluY2x1ZGVzKHZhcmlhbnQpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluc2VydEFmdGVyQW55T2YoXG4gIHRhcmdldDogc3RyaW5nW10sXG4gIGluc2VydDogc3RyaW5nW10sXG4gIGhhc0FueU9mQXJnczogc3RyaW5nW11cbikge1xuICBjb25zdCBpbmRleCA9IHRhcmdldC5maW5kSW5kZXgoKHZhbHVlKSA9PiBoYXNBbnlPZkFyZ3MuaW5jbHVkZXModmFsdWUpKTtcbiAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgIHJldHVybiB0YXJnZXQ7XG4gIH1cbiAgY29uc3QgcmVzdWx0ID0gWy4uLnRhcmdldF07XG4gIHJlc3VsdC5zcGxpY2UoaW5kZXggKyAxLCAwLCAuLi5pbnNlcnQpO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlQXJnc0Zyb20oXG4gIHRhcmdldDogc3RyaW5nW10sXG4gIGFyZ3M6IEFycmF5PHN0cmluZyB8IFJlZ0V4cD4sXG4gIG9wdHM/OiB7IG51bVZhbHVlczogbnVtYmVyIH1cbikge1xuICBjb25zdCByZXN1bHQgPSBbLi4udGFyZ2V0XTtcbiAgZm9yIChjb25zdCBhcmcgb2YgYXJncykge1xuICAgIGNvbnN0IGluZGV4ID0gdGFyZ2V0LmZpbmRJbmRleCgodmFsdWUpID0+XG4gICAgICB0eXBlb2YgYXJnID09PSAnc3RyaW5nJyA/IHZhbHVlID09PSBhcmcgOiBhcmcudGVzdCh2YWx1ZSlcbiAgICApO1xuICAgIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICAgIHJlc3VsdC5zcGxpY2UoaW5kZXgsIG9wdHM/Lm51bVZhbHVlcyA/IG9wdHMubnVtVmFsdWVzICsgMSA6IDEpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlSW5wdXRBcmdzKFxuICBhcmdzOiBBcnJheTxzdHJpbmcgfCBSZWdFeHA+LFxuICBvcHRzPzogeyBudW1WYWx1ZXM6IG51bWJlciB9XG4pIHtcbiAgcmV0dXJuIChzdGF0ZTogQ2xpQXJncykgPT4ge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIGlucHV0QXJnczogcmVtb3ZlQXJnc0Zyb20oc3RhdGUuaW5wdXRBcmdzLCBhcmdzLCBvcHRzKSxcbiAgICB9O1xuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2V0RGVmYXVsdEFyZ3MoXG4gIGFyZ3M6IFtzdHJpbmcsIC4uLnN0cmluZ1tdXSxcbiAgdmFsdWVzOiBzdHJpbmdbXSA9IFtdLFxuICBjb25kaXRpb24/OiAoc3RhdGU6IENsaUFyZ3MpID0+IGJvb2xlYW4sXG4gIGFwcGx5PzogKGFyZ3M6IHN0cmluZ1tdLCBzdGF0ZTogQ2xpQXJncykgPT4gQ2xpQXJnc1xuKSB7XG4gIHJldHVybiAoc3RhdGU6IENsaUFyZ3MpID0+IHtcbiAgICBpZiAoY29uZGl0aW9uKSB7XG4gICAgICBpZiAoIWNvbmRpdGlvbihzdGF0ZSkpIHtcbiAgICAgICAgcmV0dXJuIHN0YXRlO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIGFyZ3MpKSB7XG4gICAgICByZXR1cm4gc3RhdGU7XG4gICAgfVxuICAgIGNvbnN0IHNldDogTm9uTnVsbGFibGU8dHlwZW9mIGFwcGx5PiA9IGFwcGx5XG4gICAgICA/IGFwcGx5XG4gICAgICA6IChhcmdzLCB0bykgPT4gKHtcbiAgICAgICAgICAuLi50byxcbiAgICAgICAgICBwcmVBcmdzOiBbLi4uc3RhdGUucHJlQXJncywgLi4uYXJnc10sXG4gICAgICAgIH0pO1xuICAgIHJldHVybiBzZXQoW2FyZ3NbMF0sIC4uLnZhbHVlc10sIHN0YXRlKTtcbiAgfTtcbn1cblxuZXhwb3J0IGNvbnN0IHJlbW92ZUxvZ0xldmVsT3B0aW9uID0gKCkgPT5cbiAgcmVtb3ZlSW5wdXRBcmdzKFsnLS1sb2ctbGV2ZWwnXSwgeyBudW1WYWx1ZXM6IDEgfSk7XG5cbmV4cG9ydCB0eXBlIENsaUFyZ3MgPSB7XG4gIC8qKlxuICAgKiBFeHRyYSBhcmd1bWVudHMgdGhhdCBnbyBiZWZvcmUgYXJndW1lbnRzIHBhc3NlZCBpbiBieSB0aGUgdXNlclxuICAgKi9cbiAgcHJlQXJnczogc3RyaW5nW107XG4gIC8qKlxuICAgKiBBcmd1bWVudHMgYXMgcGFzc2VkIGluIGJ5IHRoZSB1c2VyLCBjb3VsZCBiZSBtb2RpZmllZCBieVxuICAgKiB0cmFuc2Zvcm1zIHRoYXQgY29tZSBiZWZvcmUgY3VycmVudFxuICAgKi9cbiAgaW5wdXRBcmdzOiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIEV4dHJhIGFyZ3VtZW50cyB0aGF0IGdvIGFmdGVyIGFyZ3VtZW50cyBwYXNzZWQgaW4gYnkgdGhlIHVzZXJcbiAgICovXG4gIHBvc3RBcmdzOiBzdHJpbmdbXTtcbn07XG5cbmV4cG9ydCB0eXBlIENsaUFyZ3NUcmFuc2Zvcm0gPSAoc3RhdGU6IENsaUFyZ3MpID0+IENsaUFyZ3M7XG5cbmV4cG9ydCBmdW5jdGlvbiBjbGlBcmdzUGlwZShcbiAgdHJhbnNmb3JtczogQ2xpQXJnc1RyYW5zZm9ybVtdLFxuICBpbnB1dEFyZ3M6IHN0cmluZ1tdXG4pIHtcbiAgY29uc3Qge1xuICAgIHByZUFyZ3MsXG4gICAgaW5wdXRBcmdzOiBtb2RpZmllZElucHV0QXJncyxcbiAgICBwb3N0QXJncyxcbiAgfSA9IHRyYW5zZm9ybXMucmVkdWNlPENsaUFyZ3M+KChhY2MsIHRyYW5zZm9ybSkgPT4gdHJhbnNmb3JtKGFjYyksIHtcbiAgICBpbnB1dEFyZ3MsXG4gICAgcHJlQXJnczogW10sXG4gICAgcG9zdEFyZ3M6IFtdLFxuICB9KTtcbiAgcmV0dXJuIFsuLi5wcmVBcmdzLCAuLi5tb2RpZmllZElucHV0QXJncywgLi4ucG9zdEFyZ3NdO1xufVxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSAnbm9kZTp1cmwnO1xuXG5pbXBvcnQgeyBvbmNlIH0gZnJvbSAnLi9vbmNlJztcblxuZXhwb3J0IGNvbnN0IGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsID0gKG9wdHM6IHtcbiAgaW1wb3J0TWV0YVVybDogc3RyaW5nO1xufSkgPT4ge1xuICAvLyB0aGlzIGlzIGhpZ2hseSBkZXBlbmRlbnQgb24gdGhlIG91dHB1dCBkaXJlY3Rvcnkgc3RydWN0dXJlXG4gIC8vIGFuZCB0aGUgY29udGV4dCBpbiB3aGljaCB0aGlzIGZ1bmN0aW9uIGlzIHJ1biAoYnVuZGxlZCBjb2RlIHZzIHRzeCAuL3NyYy90c2ZpbGUudHMpXG4gIGNvbnN0IF9fZmlsZU5hbWUgPSBmaWxlVVJMVG9QYXRoKG5ldyBVUkwob3B0cy5pbXBvcnRNZXRhVXJsKSk7XG4gIGNvbnN0IHBhcmVudCA9IGRpcm5hbWUoX19maWxlTmFtZSk7XG4gIGNvbnN0IHN1cGVyUGFyZW50ID0gZGlybmFtZShwYXJlbnQpO1xuXG4gIGNvbnN0IGlzQnVuZGxlZEluRGlzdCA9ICgpID0+IHBhcmVudC5lbmRzV2l0aCgnL2Rpc3QnKTtcbiAgY29uc3QgaXNCdW5kbGVkSW5CaW4gPSAoKSA9PlxuICAgIHBhcmVudC5lbmRzV2l0aCgnL2JpbicpICYmICFzdXBlclBhcmVudC5lbmRzV2l0aCgnL3NyYycpO1xuXG4gIGlmIChpc0J1bmRsZWRJbkRpc3QoKSB8fCBpc0J1bmRsZWRJbkJpbigpKSB7XG4gICAgcmV0dXJuIGZpbGVVUkxUb1BhdGgobmV3IFVSTChgLi4vYCwgb3B0cy5pbXBvcnRNZXRhVXJsKSk7XG4gIH1cblxuICAvLyBydW4gdmlhIHRzeCB0byBidWlsZCB0aGUgQHJlcGthLWtpdC90cyBpdHNlbGZcbiAgcmV0dXJuIGZpbGVVUkxUb1BhdGgobmV3IFVSTChgLi4vLi4vYCwgb3B0cy5pbXBvcnRNZXRhVXJsKSk7XG59O1xuXG5leHBvcnQgY29uc3QgbW9kdWxlUm9vdERpcmVjdG9yeSA9IG9uY2UoKCkgPT5cbiAgZ2V0TW9kdWxlUm9vdERpcmVjdG9yeUZvckltcG9ydE1ldGFVcmwoeyBpbXBvcnRNZXRhVXJsOiBpbXBvcnQubWV0YS51cmwgfSlcbik7XG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4vbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5cbmV4cG9ydCBmdW5jdGlvbiBtb2R1bGVzQmluUGF0aChiaW46IHN0cmluZykge1xuICByZXR1cm4gam9pbihtb2R1bGVSb290RGlyZWN0b3J5KCksIGAuL25vZGVfbW9kdWxlcy8uYmluLyR7YmlufWApO1xufVxuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnNXaXRoRXh0cmEgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IFNwYXduUmVzdWx0T3B0cyB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdCc7XG5pbXBvcnQgdHlwZSB7IENsaUFyZ3MgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGNsaUFyZ3NQaXBlIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBpbnNlcnRBZnRlckFueU9mIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBpbmNsdWRlc0FueU9mIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBtb2R1bGVzQmluUGF0aCB9IGZyb20gJy4vdXRpbHMvbW9kdWxlc0JpblBhdGgnO1xuaW1wb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi91dGlscy9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5leHBvcnQgdHlwZSBUYXNrVHlwZXMgPVxuICB8ICdsaW50J1xuICB8ICdidWlsZCdcbiAgfCAndGVzdCdcbiAgfCAnZGVjbGFyYXRpb25zJ1xuICB8ICdpbnRlZ3JhdGlvbidcbiAgfCAnc2V0dXA6aW50ZWdyYXRpb24nXG4gIHwgKHN0cmluZyAmIHtcbiAgICAgIF9hbGxvd1N0cmluZ3M/OiB1bmRlZmluZWQ7XG4gICAgfSk7XG5cbmNvbnN0IHR1cmJvUGF0aCA9ICgpID0+IG1vZHVsZXNCaW5QYXRoKCd0dXJibycpO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFzVHVyYm9Kc29uKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBjd2QgPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGgoKTtcbiAgcmV0dXJuIGF3YWl0IHN0YXQoam9pbihjd2QsICd0dXJiby5qc29uJykpXG4gICAgLnRoZW4oKHJlcykgPT4gcmVzLmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXNzVHVyYm9Gb3JjZUVudihhcmdzOiBzdHJpbmdbXSkge1xuICByZXR1cm4gaW5jbHVkZXNBbnlPZihhcmdzLCBbJ3J1biddKSAmJiBpbmNsdWRlc0FueU9mKGFyZ3MsIFsnLS1mb3JjZSddKVxuICAgID8ge1xuICAgICAgICBUVVJCT19GT1JDRTogJzEnLFxuICAgICAgfVxuICAgIDogdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5oZXJpdFR1cmJvRm9yY2VBcmdGcm9tRW52KCkge1xuICByZXR1cm4gKHN0YXRlOiBDbGlBcmdzKSA9PiAoe1xuICAgIC4uLnN0YXRlLFxuICAgIGlucHV0QXJnczpcbiAgICAgIGluY2x1ZGVzQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBbJ3J1biddKSAmJlxuICAgICAgIWluY2x1ZGVzQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBbJy0tZm9yY2UnXSkgJiZcbiAgICAgIHByb2Nlc3MuZW52WydUVVJCT19GT1JDRSddXG4gICAgICAgID8gaW5zZXJ0QWZ0ZXJBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsnLS1mb3JjZSddLCBbJ3J1biddKVxuICAgICAgICA6IHN0YXRlLmlucHV0QXJncyxcbiAgfSk7XG59XG5cbi8qKlxuICogUnVuIG9uZSBvZiB0aGUgZGV2IHBpcGVsaW5lIHRhc2tzIHVzaW5nIFR1cmJvIGZvciBhIHNpbmdsZSBwYWNrYWdlXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5UdXJib1Rhc2tzRm9yU2luZ2xlUGFja2FnZShvcHRzOiB7XG4gIHRhc2tzOiBbVGFza1R5cGVzLCAuLi5UYXNrVHlwZXNbXV07XG4gIHBhY2thZ2VEaXI/OiBzdHJpbmc7XG4gIHNwYXduT3B0czogT21pdDxTcGF3bk9wdGlvbnNXaXRoRXh0cmE8U3Bhd25SZXN1bHRPcHRzPiwgJ2N3ZCc+O1xufSkge1xuICBjb25zdCByb290RGlyID0gb3B0cy5wYWNrYWdlRGlyID8/IHByb2Nlc3MuY3dkKCk7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICByZXR1cm4gYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbChcbiAgICB0dXJib1BhdGgoKSxcbiAgICBjbGlBcmdzUGlwZShcbiAgICAgIFtpbmhlcml0VHVyYm9Gb3JjZUFyZ0Zyb21FbnYoKV0sXG4gICAgICBbXG4gICAgICAgICdydW4nLFxuICAgICAgICAuLi5vcHRzLnRhc2tzLFxuICAgICAgICAnLS1maWx0ZXI9JyArIHJvb3REaXIucmVwbGFjZShjd2QsICcuJyksXG4gICAgICAgICctLW91dHB1dC1sb2dzPW5ldy1vbmx5JyxcbiAgICAgIF1cbiAgICApLFxuICAgIHtcbiAgICAgIC4uLm9wdHMuc3Bhd25PcHRzLFxuICAgICAgY3dkLFxuICAgIH1cbiAgKTtcbn1cbiIsImltcG9ydCB7IGxvYWQgfSBmcm9tICdqcy15YW1sJztcbmltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICcuL29uY2VBc3luYyc7XG5pbXBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3JlcG9zaXRvcnlSb290UGF0aCc7XG5cbmNvbnN0IHJlYWRQYWNrYWdlc0dsb2JzQXQgPSBhc3luYyAobW9ub3JlcG9Sb290OiBzdHJpbmcpID0+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVhZEZpbGUoXG4gICAgICBqb2luKG1vbm9yZXBvUm9vdCwgJ3BucG0td29ya3NwYWNlLnlhbWwnKSxcbiAgICAgICd1dGYtOCdcbiAgICApO1xuICAgIGNvbnN0IHJvb3RQYXRoID0gbG9hZCh0ZXh0KSBhcyB7XG4gICAgICBwYWNrYWdlcz86IHN0cmluZ1tdO1xuICAgIH07XG4gICAgcmV0dXJuIHJvb3RQYXRoLnBhY2thZ2VzID8/IFtdO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIuZXJyb3IoZXJyKTtcbiAgICByZXR1cm4gW107XG4gIH1cbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIG1vbm9yZXBvIHBhY2thZ2VzIGdsb2IgYnkgcmVhZGluZyBvbmUgb2YgdGhlIHN1cHBvcnRlZFxuICogZmlsZXNcbiAqXG4gKiBOT1RFOiBvbmx5IHBucG0gaXMgc3VwcG9ydGVkIGF0IHRoZSBtb21lbnRcbiAqL1xuZXhwb3J0IGNvbnN0IHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMgPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290ID0gYXdhaXQgcmVwb3NpdG9yeVJvb3RQYXRoKCk7XG4gIGNvbnN0IHBhY2thZ2VzR2xvYnMgPSBhd2FpdCByZWFkUGFja2FnZXNHbG9ic0F0KHJvb3QpO1xuICByZXR1cm4ge1xuICAgIHJvb3QsXG4gICAgcGFja2FnZXNHbG9icyxcbiAgfTtcbn0pO1xuIiwiaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgaGFzVHVyYm9Kc29uIH0gZnJvbSAnLi4vdHVyYm8nO1xuaW1wb3J0IHsgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyB9IGZyb20gJy4vcmVhZFBhY2thZ2VzR2xvYnMnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uKCkge1xuICBjb25zdCBbeyByb290LCBwYWNrYWdlc0dsb2JzIH0sIGhhc1R1cmJvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzKCksXG4gICAgaGFzVHVyYm9Kc29uKCksXG4gIF0pO1xuICBpZiAocGFja2FnZXNHbG9icy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4ge1xuICAgICAgcm9vdCxcbiAgICAgIHBhY2thZ2VzR2xvYnMsXG4gICAgICBwYWNrYWdlTG9jYXRpb25zOiBbXSxcbiAgICAgIGhhc1R1cmJvLFxuICAgICAgdHlwZTogJ3NpbmdsZS1wYWNrYWdlJyBhcyBjb25zdCxcbiAgICB9O1xuICB9XG4gIGNvbnN0IHBhY2thZ2VMb2NhdGlvbnMgPSBhd2FpdCBmZyhcbiAgICBwYWNrYWdlc0dsb2JzLm1hcCgoZ2xvYikgPT4gYCR7Z2xvYn0vcGFja2FnZS5qc29uYCksXG4gICAge1xuICAgICAgY3dkOiByb290LFxuICAgIH1cbiAgKTtcbiAgcmV0dXJuIHtcbiAgICByb290LFxuICAgIHBhY2thZ2VzR2xvYnMsXG4gICAgcGFja2FnZUxvY2F0aW9uczogcGFja2FnZUxvY2F0aW9ucy5tYXAoKGxvY2F0aW9uKSA9PiBkaXJuYW1lKGxvY2F0aW9uKSksXG4gICAgaGFzVHVyYm8sXG4gICAgdHlwZTogJ211bHRpcGxlLXBhY2thZ2VzJyBhcyBjb25zdCxcbiAgfTtcbn1cbiIsImltcG9ydCB7IHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IHJlYWRDd2RQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuaW1wb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5leHBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmV4cG9ydCB7IGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbiB9IGZyb20gJy4vbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uJztcbmV4cG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuYXN5bmMgZnVuY3Rpb24gdGVzdFBhdGgob3B0czoge1xuICByb290OiBzdHJpbmc7XG4gIHdyYXBwZXJQYWNrYWdlTmFtZTogc3RyaW5nO1xuICBsb29rdXBQYWNrYWdlTmFtZTogc3RyaW5nO1xufSkge1xuICBjb25zdCBwYXRoID0gam9pbihcbiAgICBvcHRzLnJvb3QsXG4gICAgYG5vZGVfbW9kdWxlcy8ke29wdHMud3JhcHBlclBhY2thZ2VOYW1lfS9ub2RlX21vZHVsZXMvJHtvcHRzLmxvb2t1cFBhY2thZ2VOYW1lfWBcbiAgKTtcbiAgcmV0dXJuIHN0YXQocGF0aClcbiAgICAudGhlbigocmVzdWx0KSA9PiAocmVzdWx0LmlzRGlyZWN0b3J5KCkgPyBwYXRoIDogdW5kZWZpbmVkKSlcbiAgICAuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdGVzdExvY2FsQW5kUm9vdCh7XG4gIHdyYXBwZXJQYWNrYWdlTmFtZSxcbiAgbG9va3VwUGFja2FnZU5hbWUsXG4gIHJlcG9Sb290UGF0aFByb21pc2UsXG59OiB7XG4gIHJlcG9Sb290UGF0aFByb21pc2U6IFByb21pc2U8c3RyaW5nPjtcbiAgd3JhcHBlclBhY2thZ2VOYW1lOiBzdHJpbmc7XG4gIGxvb2t1cFBhY2thZ2VOYW1lOiBzdHJpbmc7XG59KSB7XG4gIGNvbnN0IGxvY2FsUHJvbWlzZSA9IHRlc3RQYXRoKHtcbiAgICByb290OiBwcm9jZXNzLmN3ZCgpLFxuICAgIHdyYXBwZXJQYWNrYWdlTmFtZSxcbiAgICBsb29rdXBQYWNrYWdlTmFtZSxcbiAgfSk7XG4gIGNvbnN0IHJlcG9Sb290UGF0aCA9IGF3YWl0IHJlcG9Sb290UGF0aFByb21pc2U7XG4gIGlmIChyZXBvUm9vdFBhdGggPT09IHByb2Nlc3MuY3dkKCkpIHtcbiAgICBjb25zdCBsb2NhbCA9IGF3YWl0IGxvY2FsUHJvbWlzZTtcbiAgICBpZiAobG9jYWwpIHtcbiAgICAgIHJldHVybiBsb2NhbDtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gdGVzdCBtb25vcmVwbyByb290IGFzIHdlbGw6XG4gICAgY29uc3Qgcm9vdFByb21pc2UgPSB0ZXN0UGF0aCh7XG4gICAgICByb290OiByZXBvUm9vdFBhdGgsXG4gICAgICB3cmFwcGVyUGFja2FnZU5hbWUsXG4gICAgICBsb29rdXBQYWNrYWdlTmFtZSxcbiAgICB9KTtcbiAgICBjb25zdCBsb2NhbCA9IGF3YWl0IGxvY2FsUHJvbWlzZTtcbiAgICBpZiAobG9jYWwpIHtcbiAgICAgIHJldHVybiBsb2NhbDtcbiAgICB9XG4gICAgY29uc3Qgcm9vdCA9IGF3YWl0IHJvb3RQcm9taXNlO1xuICAgIGlmIChyb290KSB7XG4gICAgICByZXR1cm4gcm9vdDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcGFja2FnZU5hbWUoW2tleSwgdmFsdWVdOiBbc3RyaW5nLCBzdHJpbmddKSB7XG4gIGlmICh2YWx1ZS5zdGFydHNXaXRoKCd3b3Jrc3BhY2U6JykpIHtcbiAgICAvLyB3b3Jrc3BhY2U6cGFja2FnZUBzZW0udmVyLnhcbiAgICBjb25zdCByZXN1bHQgPSAvd29ya3NwYWNlOiguKilAKC4qKS8uZXhlYyh2YWx1ZSk7XG4gICAgaWYgKHJlc3VsdCkge1xuICAgICAgY29uc3QgWywgcGFja2FnZU5hbWVdID0gcmVzdWx0O1xuICAgICAgaWYgKHBhY2thZ2VOYW1lKSB7XG4gICAgICAgIHJldHVybiBwYWNrYWdlTmFtZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgoJ25wbTonKSkge1xuICAgIC8vIG5wbTpwYWNrYWdlQHNlbS52ZXIueFxuICAgIGNvbnN0IHJlc3VsdCA9IC9ucG06KC4qKUAoLiopLy5leGVjKHZhbHVlKTtcbiAgICBpZiAocmVzdWx0KSB7XG4gICAgICBjb25zdCBbLCBwYWNrYWdlTmFtZV0gPSByZXN1bHQ7XG4gICAgICBpZiAocGFja2FnZU5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHBhY2thZ2VOYW1lO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4ga2V5O1xufVxuXG4vKipcbiAqIExvb2t1cCBsb2NhdGlvbiBmb3IgZGV2RGVwZW5kZW5jaWVzIG9mIFwiQHJlcGthLWtpdC90c1wiIC0gdGhpcyBmdW5jdGlvbiB3aWxsXG4gKiBsb29rdXAgZm9yIFwib3B0cy5sb29rdXBQYWNrYWdlTmFtZVwiLCBpdCBmYXZvdXJzIHRoZSBsb2NhbCAuL25vZGVfbW9kdWxlcy8gcGF0aFxuICogYW5kIGZhbGxzIGJhY2sgdG8gdGhlIG1vbm9yZXBvIHJvb3QuXG4gKlxuICogVGhpcyB3aWxsIGFsc28gdHJ5IHRvIGxvb2t1cCBhbGlhcyBvZiB0aGUgXCJAcmVwa2Eta2l0L3RzXCIgcGFja2FnZSBhbmQgaWYgdGhhdCBpcyBkZWZpbmVkXG4gKiB3aWxsIHRyeSB0byBmaW5kIHRoZSBkZXBlbmRlbmNpZXMgaW4gdGhlIGRlcGVuZGVuY2llcyBvZiB0aGUgYWxpYXNlZCBwYWNrYWdlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmluZERldkRlcGVuZGVuY3kob3B0czoge1xuICB3cmFwcGVyUGFja2FnZU5hbWU/OiBzdHJpbmc7XG4gIGxvb2t1cFBhY2thZ2VOYW1lOiBzdHJpbmc7XG59KSB7XG4gIGNvbnN0IHdyYXBwZXJQYWNrYWdlTmFtZSA9IG9wdHMud3JhcHBlclBhY2thZ2VOYW1lID8/ICdAcmVwa2Eta2l0L3RzJztcbiAgY29uc3QgbG9va3VwUGFja2FnZU5hbWUgPSBvcHRzLmxvb2t1cFBhY2thZ2VOYW1lO1xuICAvLyBzdGFydCBsb29raW5nIHVwIHRoZSByZXBvc2l0b3J5IHJvb3QgdG8gY2hlY2sgbW9ub3JlcG8gc2NlbmFyaW9zOlxuICBjb25zdCByZXBvUm9vdFBhdGhQcm9taXNlID0gcmVwb3NpdG9yeVJvb3RQYXRoKCk7XG5cbiAgY29uc3QgZGVmYXVsdFJlc3VsdCA9IGF3YWl0IHRlc3RQYXRoKHtcbiAgICByb290OiBwcm9jZXNzLmN3ZCgpLFxuICAgIGxvb2t1cFBhY2thZ2VOYW1lLFxuICAgIHdyYXBwZXJQYWNrYWdlTmFtZSxcbiAgfSk7XG4gIGlmIChkZWZhdWx0UmVzdWx0KSB7XG4gICAgcmV0dXJuIGRlZmF1bHRSZXN1bHQ7XG4gIH1cblxuICAvLyBsb29rdXAgZm9yIGFsdGVybmF0aXZlIG5hbWUgb2YgQHJlcGthLWtpdC90c1xuICBjb25zdCB3cmFwcGVyQWxpYXNOYW1lID0gYXdhaXQgcmVhZEN3ZFBhY2thZ2VKc29uKClcbiAgICAudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICBjb25zdCBkZXBlbmRlbmN5ID0gT2JqZWN0LmVudHJpZXMocmVzdWx0LmRldkRlcGVuZGVuY2llcyB8fCB7fSkuZmluZChcbiAgICAgICAgKGRlcGVuZGVuY3kpID0+IHBhY2thZ2VOYW1lKGRlcGVuZGVuY3kpID09PSB3cmFwcGVyUGFja2FnZU5hbWVcbiAgICAgICk7XG4gICAgICByZXR1cm4gZGVwZW5kZW5jeSA/IGRlcGVuZGVuY3lbMF0gOiB1bmRlZmluZWQ7XG4gICAgfSlcbiAgICAuY2F0Y2goKGVycikgPT4ge1xuICAgICAgbG9nZ2VyLndhcm4oJ0Nhbm5vdCByZWFkIHBhY2thZ2UganNvbicsIGVycik7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH0pO1xuXG4gIGlmICghd3JhcHBlckFsaWFzTmFtZSkge1xuICAgIC8vIHRoZSBvbmx5IGFsdGVybmF0aXZlIG5vdyBpcyB0aGUgcmVwb3NpdG9yeSByb290XG4gICAgY29uc3QgcmVwb1Jvb3RQYXRoID0gYXdhaXQgcmVwb1Jvb3RQYXRoUHJvbWlzZTtcbiAgICBpZiAocmVwb1Jvb3RQYXRoICE9PSBwcm9jZXNzLmN3ZCgpKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGVzdFBhdGgoe1xuICAgICAgICByb290OiByZXBvUm9vdFBhdGgsXG4gICAgICAgIGxvb2t1cFBhY2thZ2VOYW1lLFxuICAgICAgICB3cmFwcGVyUGFja2FnZU5hbWUsXG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IGFsaWFzUmVzdWx0ID0gYXdhaXQgdGVzdExvY2FsQW5kUm9vdCh7XG4gICAgcmVwb1Jvb3RQYXRoUHJvbWlzZSxcbiAgICBsb29rdXBQYWNrYWdlTmFtZSxcbiAgICB3cmFwcGVyUGFja2FnZU5hbWU6IHdyYXBwZXJBbGlhc05hbWUsXG4gIH0pO1xuXG4gIHJldHVybiBhbGlhc1Jlc3VsdDtcbn1cbiIsImltcG9ydCB0eXBlIHsgQ29uZmlnIH0gZnJvbSAnQGplc3QvdHlwZXMnO1xuaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4uL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmltcG9ydCB7IHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlIH0gZnJvbSAnLi4vdHVyYm8nO1xuXG5hc3luYyBmdW5jdGlvbiBsb2FkU3RhbmRhcmRHbG9iYWxIb29rKFxuICBzY3JpcHQ6IHN0cmluZyxcbiAgZ2xvYmFsQ29uZmlnOiBDb25maWcuR2xvYmFsQ29uZmlnLFxuICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZ1xuKSB7XG4gIGNvbnN0IGhhc0hvb2sgPSBhd2FpdCBzdGF0KHNjcmlwdClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbiAgcmV0dXJuIHtcbiAgICBoYXNIb29rLFxuICAgIGV4ZWN1dGU6IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghaGFzSG9vaykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBsb2NhdGlvbiA9IGpvaW4ocHJvY2Vzcy5jd2QoKSwgc2NyaXB0KTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IChhd2FpdCBpbXBvcnQobG9jYXRpb24pKSBhc1xuICAgICAgICB8IHtcbiAgICAgICAgICAgIGRlZmF1bHQ/OiAoXG4gICAgICAgICAgICAgIGdsb2JhbENvbmZpZzogQ29uZmlnLkdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgICAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWdcbiAgICAgICAgICAgICkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgICAgICAgICB9XG4gICAgICAgIHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKCFyZXN1bHQgfHwgIXJlc3VsdC5kZWZhdWx0KSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGDimqDvuI8gTm8gZGVmYXVsdCBleHBvcnQgZm91bmQgaW4gXCIke3NjcmlwdH1cImApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBhd2FpdCBQcm9taXNlLnJlc29sdmUocmVzdWx0LmRlZmF1bHQoZ2xvYmFsQ29uZmlnLCBwcm9qZWN0Q29uZmlnKSk7XG4gICAgfSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEN1c3RvbUdsb2JhbEhvb2soc2NyaXB0OiBzdHJpbmcpIHtcbiAgY29uc3QgaGFzSG9vayA9IGF3YWl0IHN0YXQoc2NyaXB0KVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuICByZXR1cm4ge1xuICAgIGhhc0hvb2ssXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFoYXNIb29rKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxvY2F0aW9uID0gam9pbihwcm9jZXNzLmN3ZCgpLCBzY3JpcHQpO1xuICAgICAgY29uc3QgcGFja2FnZUpzb24gPSBhd2FpdCByZWFkUGFja2FnZUpzb24oXG4gICAgICAgIGpvaW4ocHJvY2Vzcy5jd2QoKSwgJ3BhY2thZ2UuanNvbicpXG4gICAgICApO1xuXG4gICAgICBpZiAoXG4gICAgICAgIHNjcmlwdC5lbmRzV2l0aCgnc2V0dXAudHMnKSAmJlxuICAgICAgICB0eXBlb2YgcGFja2FnZUpzb25bJ3NjcmlwdHMnXSA9PT0gJ29iamVjdCcgJiZcbiAgICAgICAgcGFja2FnZUpzb25bJ3NjcmlwdHMnXVsnc2V0dXA6aW50ZWdyYXRpb24nXSA9PT0gYHRzeCAke3NjcmlwdH1gXG4gICAgICApIHtcbiAgICAgICAgYXdhaXQgcnVuVHVyYm9UYXNrc0ZvclNpbmdsZVBhY2thZ2Uoe1xuICAgICAgICAgIHRhc2tzOiBbJ3NldHVwOmludGVncmF0aW9uJ10sXG4gICAgICAgICAgc3Bhd25PcHRzOiB7XG4gICAgICAgICAgICBleGl0Q29kZXM6IFswXSxcbiAgICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICAgICAgTE9HX0xFVkVMOiBsb2dnZXIubG9nTGV2ZWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbCgndHN4JywgW2xvY2F0aW9uXSwge1xuICAgICAgICAgIGV4aXRDb2RlczogWzBdLFxuICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgICBMT0dfTEVWRUw6IGxvZ2dlci5sb2dMZXZlbCxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZEFuZFJ1bkdsb2JhbEhvb2soXG4gIHNjcmlwdDogc3RyaW5nLFxuICBnbG9iYWxDb25maWc6IENvbmZpZy5HbG9iYWxDb25maWcsXG4gIHByb2plY3RDb25maWc6IENvbmZpZy5Qcm9qZWN0Q29uZmlnLFxuICB0aXA/OiBzdHJpbmdcbikge1xuICBjb25zdCBbc3RhbmRhcmQsIGN1c3RvbV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgbG9hZFN0YW5kYXJkR2xvYmFsSG9vayhgJHtzY3JpcHR9Lm1qc2AsIGdsb2JhbENvbmZpZywgcHJvamVjdENvbmZpZyksXG4gICAgbG9hZEN1c3RvbUdsb2JhbEhvb2soYCR7c2NyaXB0fS50c2ApLFxuICBdKTtcbiAgaWYgKCFjdXN0b20uaGFzSG9vayAmJiB0aXApIHtcbiAgICBsb2dnZXIudGlwKHRpcCk7XG4gIH1cbiAgYXdhaXQgc3RhbmRhcmQuZXhlY3V0ZSgpO1xuICBhd2FpdCBjdXN0b20uZXhlY3V0ZSgpO1xufVxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgZmluZERldkRlcGVuZGVuY3kgfSBmcm9tICcuLi91dGlscy9maW5kRGV2RGVwZW5kZW5jeSc7XG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICcuLi91dGlscy9vbmNlQXN5bmMnO1xuXG5leHBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmV4cG9ydCB7IGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbiB9IGZyb20gJy4uL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbic7XG5leHBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuLi91dGlscy9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuZXhwb3J0IHsgbG9hZEFuZFJ1bkdsb2JhbEhvb2sgfSBmcm9tICcuL2xvYWRBbmRSdW5HbG9iYWxIb29rJztcblxuZXhwb3J0IGNvbnN0IGplc3RQbHVnaW5Sb290ID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmluZERldkRlcGVuZGVuY3koe1xuICAgIGxvb2t1cFBhY2thZ2VOYW1lOiAnZXNidWlsZC1qZXN0JyxcbiAgfSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgbG9nZ2VyLndhcm4oXG4gICAgICAnSmVzdCBwbHVnaW5zIHJvb3QgY2Fubm90IGJlIGRldGVybWluZWQuIERvIHlvdSBoYXZlIFwiQHJlcGthLWtpdC90c1wiIGluIGRldkRlcGVuZGVuY2llcyBhdCB0aGUgbW9ub3JlcG8gcm9vdCBvciBhdCB0aGUgbG9jYWwgcGFja2FnZT8nXG4gICAgKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAobG9nZ2VyLmxvZ0xldmVsID09PSAnZGVidWcnKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ0ZvdW5kIGplc3QgcGx1Z2lucyByb290IGF0JywgZGlybmFtZShyZXN1bHQpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdCA/IGRpcm5hbWUocmVzdWx0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
