// This file is bundled up from './src/*' and needs to be committed
import { join, dirname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
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
  const path = join(opts.path, "node_modules", opts.lookupPackageName);
  return stat(path).then((result) => result.isDirectory() ? path : void 0).catch(() => void 0);
}
async function testPathRelativeTo(opts) {
  const path = join(opts.root, `node_modules/${opts.wrapperPackageName}/node_modules/${opts.lookupPackageName}`);
  return testPath({
    path,
    lookupPackageName: opts.lookupPackageName
  });
}
async function testLocalAndRoot({
  wrapperPackageName,
  lookupPackageName,
  repoRootPathPromise
}) {
  const localPromise = testPathRelativeTo({
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
    const rootPromise = testPathRelativeTo({
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
  const lookupPackageName = opts.lookupPackageName;
  const nodeModulesResult = await testPath({
    path: moduleRootDirectory(),
    lookupPackageName
  });
  if (nodeModulesResult) {
    return nodeModulesResult;
  }
  const wrapperPackageName = opts.wrapperPackageName ?? "@repka-kit/ts";
  const repoRootPathPromise = repositoryRootPath();
  const defaultResult = await testPathRelativeTo({
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
      return await testPathRelativeTo({
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWxzL29uY2UudHMiLCIuLi8uLi9zcmMvbG9nZ2VyL2xvZ2dlci50cyIsIi4uLy4uL3NyYy91dGlscy9vbmNlQXN5bmMudHMiLCIuLi8uLi9zcmMvcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbi50cyIsIi4uLy4uL3NyYy91dGlscy9tb2R1bGVSb290RGlyZWN0b3J5LnRzIiwiLi4vLi4vc3JjL3V0aWxzL2lzVHJ1dGh5LnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlcG9zaXRvcnlSb290UGF0aC50cyIsIi4uLy4uL3NyYy91dGlscy9zdGFja1RyYWNlLnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25Ub1Byb21pc2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdC50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduT3V0cHV0LnRzIiwiLi4vLi4vc3JjL3V0aWxzL2NsaUFyZ3NQaXBlLnRzIiwiLi4vLi4vc3JjL3V0aWxzL21vZHVsZXNCaW5QYXRoLnRzIiwiLi4vLi4vc3JjL3R1cmJvLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy91dGlscy9maW5kRGV2RGVwZW5kZW5jeS50cyIsIi4uLy4uL3NyYy9qZXN0L2xvYWRBbmRSdW5HbG9iYWxIb29rLnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdENvbmZpZ0hlbHBlcnMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIG9uY2U8VD4oZm46ICgpID0+IFQpOiAoKSA9PiBUIHtcbiAgbGV0IHZhbHVlOiBUO1xuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xuICByZXR1cm4gKCk6IFQgPT4ge1xuICAgIGlmIChjYWxjdWxhdGVkKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHZhbHVlID0gZm4oKTtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG59XG4iLCJpbXBvcnQgeyBvbmNlIH0gZnJvbSAnLi4vdXRpbHMvb25jZSc7XG5cbmNvbnN0IGxldmVscyA9IFsnZGVidWcnLCAnaW5mbycsICd3YXJuJywgJ2Vycm9yJywgJ2ZhdGFsJ10gYXMgY29uc3Q7XG5cbnR5cGUgTG9nTGV2ZWwgPSB0eXBlb2YgbGV2ZWxzW251bWJlcl07XG5cbnR5cGUgUGFyYW1zID0gUGFyYW1ldGVyczx0eXBlb2YgY29uc29sZS5sb2c+O1xuXG50eXBlIExvZ2dlciA9IHtcbiAgbG9nTGV2ZWw6IExvZ0xldmVsO1xuICBkZWJ1ZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGluZm8oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBhbGlhcyBmb3IgaW5mb1xuICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBzcGVjaWFsIHRyZWF0bWVudCwgZGlzYWJsZWQgb24gQ0kvVFRZXG4gIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbn07XG5cbmNvbnN0IGVuYWJsZWRMZXZlbHNBZnRlciA9IChsZXZlbDogTG9nTGV2ZWwgfCAnb2ZmJykgPT4ge1xuICBpZiAobGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIGNvbnN0IGluZGV4ID0gbGV2ZWxzLmZpbmRJbmRleCgoaXRlbSkgPT4gaXRlbSA9PT0gbGV2ZWwpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxldmVsJyk7XG4gIH1cbiAgcmV0dXJuIGxldmVscy5zbGljZShpbmRleCk7XG59O1xuXG5jb25zdCBpc0xldmVsID0gKGxldmVsPzogc3RyaW5nKTogbGV2ZWwgaXMgTG9nTGV2ZWwgPT4ge1xuICByZXR1cm4gbGV2ZWxzLmluY2x1ZGVzKGxldmVsIGFzIExvZ0xldmVsKTtcbn07XG5cbmNvbnN0IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncyA9IChcbiAgYXJncyA9IHByb2Nlc3MuYXJndlxuKTogTG9nTGV2ZWwgfCAnb2ZmJyB8IHVuZGVmaW5lZCA9PiB7XG4gIGNvbnN0IGluZGV4ID0gYXJncy5maW5kSW5kZXgoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gJy0tbG9nLWxldmVsJyk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGNvbnN0IGxldmVsID0gYXJnc1tpbmRleCArIDFdO1xuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiAnb2ZmJztcbiAgfVxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlGcm9tRW52ID0gKCk6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xuICBjb25zdCBsZXZlbCA9IHByb2Nlc3MuZW52WydMT0dfTEVWRUwnXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgZ2V0VmVyYm9zaXR5Q29uZmlnID0gKCkgPT4ge1xuICBjb25zdCBhcmdzTGV2ZWwgPSB2ZXJib3NpdHlGcm9tUHJvY2Vzc0FyZ3MoKTtcbiAgY29uc3QgZW52TGV2ZWwgPSB2ZXJib3NpdHlGcm9tRW52KCk7XG4gIHJldHVybiBhcmdzTGV2ZWwgPz8gZW52TGV2ZWwgPz8gJ2luZm8nO1xufTtcblxuY29uc3Qgbm9vcCA9ICguLi5fYXJnczogUGFyYW1zKSA9PiB7XG4gIHJldHVybjtcbn07XG5cbmNvbnN0IGxvZyA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5sb2coLi4uYXJncyk7XG59O1xuXG5jb25zdCBlcnJvciA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5lcnJvciguLi5hcmdzKTtcbn07XG5cbmNvbnN0IHNob3VsZEVuYWJsZVRpcCA9ICgpID0+ICFwcm9jZXNzLmVudlsnQ0knXSAmJiAhcHJvY2Vzcy5zdGRvdXQuaXNUVFk7XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoXG4gIGRlcHMgPSB7IGdldFZlcmJvc2l0eUNvbmZpZywgbG9nLCBlcnJvciwgc2hvdWxkRW5hYmxlVGlwIH1cbikgPT4ge1xuICBjb25zdCBsb2dMZXZlbCA9IGRlcHMuZ2V0VmVyYm9zaXR5Q29uZmlnKCk7XG4gIGNvbnN0IGVuYWJsZWQgPSBlbmFibGVkTGV2ZWxzQWZ0ZXIobG9nTGV2ZWwpO1xuICByZXR1cm4gbGV2ZWxzLnJlZHVjZShcbiAgICAoYWNjLCBsdmwpID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmFjYyxcbiAgICAgICAgW2x2bF06IGVuYWJsZWQuaW5jbHVkZXMobHZsKVxuICAgICAgICAgID8gWydmYXRhbCcsICdlcnJvciddLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICAgID8gZGVwcy5lcnJvclxuICAgICAgICAgICAgOiBkZXBzLmxvZ1xuICAgICAgICAgIDogbm9vcCxcbiAgICAgIH07XG4gICAgfSxcbiAgICB7XG4gICAgICBsb2dMZXZlbCxcbiAgICAgIGxvZzogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpID8gZGVwcy5sb2cgOiBub29wLFxuICAgICAgdGlwOiBlbmFibGVkLmluY2x1ZGVzKCdpbmZvJykgJiYgZGVwcy5zaG91bGRFbmFibGVUaXAoKSA/IGRlcHMubG9nIDogbm9vcCxcbiAgICB9IGFzIExvZ2dlclxuICApO1xufTtcblxuY29uc3QgY3JlYXRlRGVsZWdhdGluZ0xvZ2dlciA9IChvcHRzOiB7IHBhcmVudDogTG9nZ2VyIH0pOiBMb2dnZXIgPT5cbiAgT2JqZWN0LmZyZWV6ZSh7XG4gICAgZ2V0IGxvZ0xldmVsKCkge1xuICAgICAgcmV0dXJuIG9wdHMucGFyZW50LmxvZ0xldmVsO1xuICAgIH0sXG4gICAgZGVidWcoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmRlYnVnKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5pbmZvKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmxvZyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgdGlwKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC50aXAoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50Lndhcm4oLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGVycm9yKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5lcnJvciguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgZmF0YWwoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmZhdGFsKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgfSk7XG5cbmxldCBkZWZhdWx0TG9nZ2VyRmFjdG9yeTogKCgpID0+IExvZ2dlcikgfCBudWxsO1xuXG5leHBvcnQgY29uc3QgY29uZmlndXJlRGVmYXVsdExvZ2dlciA9IChmYWN0b3J5OiAoKSA9PiBMb2dnZXIpID0+IHtcbiAgaWYgKGRlZmF1bHRMb2dnZXJGYWN0b3J5KSB7XG4gICAgY29uc3QgZXJyb3IgPSB7XG4gICAgICBzdGFjazogJycsXG4gICAgfTtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShlcnJvcik7XG4gICAgbG9nZ2VyLmRlYnVnKCdDYW5ub3Qgb3ZlcnJpZGUgZGVmYXVsdCBsb2dnZXIgbXVsdGlwbGUgdGltZXMnLCBlcnJvci5zdGFjayk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGRlZmF1bHRMb2dnZXJGYWN0b3J5ID0gZmFjdG9yeTtcbn07XG5cbmNvbnN0IGRlZmF1bHRMb2dnZXIgPSBvbmNlKCgpID0+IHtcbiAgbGV0IGZhY3RvcnkgPSBkZWZhdWx0TG9nZ2VyRmFjdG9yeTtcbiAgaWYgKCFmYWN0b3J5KSB7XG4gICAgZmFjdG9yeSA9ICgpID0+IGNyZWF0ZUxvZ2dlcigpO1xuICB9XG4gIHJldHVybiBmYWN0b3J5KCk7XG59KTtcblxuLyoqXG4gKiBEZWZhdWx0IGxvZ2dlciBpbnN0YW5jZSBjYW4gYmUgY29uZmlndXJlZCBvbmNlIGF0IHN0YXJ0dXBcbiAqL1xuZXhwb3J0IGNvbnN0IGxvZ2dlcjogTG9nZ2VyID0gY3JlYXRlRGVsZWdhdGluZ0xvZ2dlcih7XG4gIGdldCBwYXJlbnQoKSB7XG4gICAgcmV0dXJuIGRlZmF1bHRMb2dnZXIoKTtcbiAgfSxcbn0pO1xuIiwiZXhwb3J0IGZ1bmN0aW9uIG9uY2VBc3luYzxUPihmbjogKCkgPT4gVCB8IFByb21pc2U8VD4pOiAoKSA9PiBQcm9taXNlPFQ+IHtcbiAgbGV0IHZhbHVlOiBUO1xuICBsZXQgaW5GbGlnaHQ6IFByb21pc2U8VD4gfCBudWxsO1xuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xuICByZXR1cm4gYXN5bmMgKCk6IFByb21pc2U8VD4gPT4ge1xuICAgIGlmIChjYWxjdWxhdGVkKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGlmIChpbkZsaWdodCkge1xuICAgICAgcmV0dXJuIGluRmxpZ2h0O1xuICAgIH1cbiAgICBpbkZsaWdodCA9IFByb21pc2UucmVzb2x2ZShmbigpKTtcbiAgICB2YWx1ZSA9IGF3YWl0IGluRmxpZ2h0O1xuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xuICAgIGluRmxpZ2h0ID0gbnVsbDtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG59XG4iLCJpbXBvcnQgeyByZWFkRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJy4uL3V0aWxzL29uY2VBc3luYyc7XG5pbXBvcnQgdHlwZSB7IFBhY2thZ2VKc29uIH0gZnJvbSAnLi9wYWNrYWdlSnNvbic7XG5cbmNvbnN0IGN3ZFBhY2thZ2VKc29uUGF0aCA9ICgpID0+IGpvaW4ocHJvY2Vzcy5jd2QoKSwgJy4vcGFja2FnZS5qc29uJyk7XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbkF0KHBhdGg6IHN0cmluZyk6IFByb21pc2U8UGFja2FnZUpzb24+IHtcbiAgcmV0dXJuIGF3YWl0IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpLnRoZW4oXG4gICAgKHJlc3VsdCkgPT4gSlNPTi5wYXJzZShyZXN1bHQpIGFzIFBhY2thZ2VKc29uXG4gICk7XG59XG5cbmV4cG9ydCBjb25zdCByZWFkQ3dkUGFja2FnZUpzb24gPSBvbmNlQXN5bmMoKCkgPT5cbiAgcmVhZFBhY2thZ2VKc29uQXQoY3dkUGFja2FnZUpzb25QYXRoKCkpXG4pO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZFBhY2thZ2VKc29uKHBhdGg6IHN0cmluZyk6IFByb21pc2U8UGFja2FnZUpzb24+IHtcbiAgLy8gYXNzdW1pbmcgY3VycmVudCBkaXJlY3RvcnkgZG9lc24ndCBjaGFuZ2Ugd2hpbGUgYXBwIGlzIHJ1bm5pbmdcbiAgcmV0dXJuIHByb2Nlc3MuY3dkKCkgPT09IGN3ZFBhY2thZ2VKc29uUGF0aCgpXG4gICAgPyBhd2FpdCByZWFkQ3dkUGFja2FnZUpzb24oKVxuICAgIDogYXdhaXQgcmVhZFBhY2thZ2VKc29uQXQocGF0aCk7XG59XG4iLCJpbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmltcG9ydCB7IG9uY2UgfSBmcm9tICcuL29uY2UnO1xuXG5leHBvcnQgY29uc3QgZ2V0TW9kdWxlUm9vdERpcmVjdG9yeUZvckltcG9ydE1ldGFVcmwgPSAob3B0czoge1xuICBpbXBvcnRNZXRhVXJsOiBzdHJpbmc7XG59KSA9PiB7XG4gIC8vIHRoaXMgaXMgaGlnaGx5IGRlcGVuZGVudCBvbiB0aGUgb3V0cHV0IGRpcmVjdG9yeSBzdHJ1Y3R1cmVcbiAgLy8gYW5kIHRoZSBjb250ZXh0IGluIHdoaWNoIHRoaXMgZnVuY3Rpb24gaXMgcnVuIChidW5kbGVkIGNvZGUgdnMgdHN4IC4vc3JjL3RzZmlsZS50cylcbiAgY29uc3QgX19maWxlTmFtZSA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChvcHRzLmltcG9ydE1ldGFVcmwpKTtcbiAgY29uc3QgcGFyZW50ID0gZGlybmFtZShfX2ZpbGVOYW1lKTtcbiAgY29uc3Qgc3VwZXJQYXJlbnQgPSBkaXJuYW1lKHBhcmVudCk7XG5cbiAgY29uc3QgaXNCdW5kbGVkSW5EaXN0ID0gKCkgPT4gcGFyZW50LmVuZHNXaXRoKCcvZGlzdCcpO1xuICBjb25zdCBpc0J1bmRsZWRJbkJpbiA9ICgpID0+XG4gICAgcGFyZW50LmVuZHNXaXRoKCcvYmluJykgJiYgIXN1cGVyUGFyZW50LmVuZHNXaXRoKCcvc3JjJyk7XG5cbiAgaWYgKGlzQnVuZGxlZEluRGlzdCgpIHx8IGlzQnVuZGxlZEluQmluKCkpIHtcbiAgICByZXR1cm4gZmlsZVVSTFRvUGF0aChuZXcgVVJMKGAuLi9gLCBvcHRzLmltcG9ydE1ldGFVcmwpKTtcbiAgfVxuXG4gIC8vIHJ1biB2aWEgdHN4IHRvIGJ1aWxkIHRoZSBAcmVwa2Eta2l0L3RzIGl0c2VsZlxuICByZXR1cm4gZmlsZVVSTFRvUGF0aChuZXcgVVJMKGAuLi8uLi9gLCBvcHRzLmltcG9ydE1ldGFVcmwpKTtcbn07XG5cbmV4cG9ydCBjb25zdCBtb2R1bGVSb290RGlyZWN0b3J5ID0gb25jZSgoKSA9PlxuICBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCh7IGltcG9ydE1ldGFVcmw6IGltcG9ydC5tZXRhLnVybCB9KVxuKTtcbiIsImV4cG9ydCBmdW5jdGlvbiBpc1RydXRoeTxUPihcbiAgdmFsdWU6IE5vbk51bGxhYmxlPFQ+IHwgZmFsc2UgfCBudWxsIHwgdW5kZWZpbmVkIHwgJycgfCAwXG4pOiB2YWx1ZSBpcyBOb25OdWxsYWJsZTxUPiB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbHRlclRydXRoeTxcbiAgQXJyIGV4dGVuZHMgQXJyYXk8dW5rbm93biB8IGZhbHNlIHwgbnVsbCB8IHVuZGVmaW5lZCB8ICcnIHwgMD4sXG4gIFJldHVyblR5cGUgPSBBcnIgZXh0ZW5kcyBBcnJheTxpbmZlciBUIHwgZmFsc2UgfCBudWxsIHwgdW5kZWZpbmVkIHwgJycgfCAwPlxuICAgID8gTm9uTnVsbGFibGU8VD5bXVxuICAgIDogQXJyXG4+KGFycmF5OiBBcnIpOiBSZXR1cm5UeXBlIHtcbiAgcmV0dXJuIGFycmF5LmZpbHRlcihpc1RydXRoeSkgYXMgdW5rbm93biBhcyBSZXR1cm5UeXBlO1xufVxuIiwiaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0JztcbmltcG9ydCB7IGRpcm5hbWUsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBpc1RydXRoeSB9IGZyb20gJy4vaXNUcnV0aHknO1xuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnLi9vbmNlQXN5bmMnO1xuXG5jb25zdCBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzID0gKGN1cnJlbnREaXJlY3Rvcnk6IHN0cmluZykgPT4ge1xuICAvLyBoYXZpbmcgJ3BhY2thZ2VzLyonIGluIHRoZSByb290IG9mIGEgbW9ub3JlcG8gaXMgc3VwZXIgY29tbW9uXG4gIGNvbnN0IHJlc3VsdCA9IC8oLiooPz1cXC9wYWNrYWdlc1xcLykpfCguKig/PVxcL25vZGVfbW9kdWxlc1xcLykpfCguKikvLmV4ZWMoXG4gICAgY3VycmVudERpcmVjdG9yeVxuICApO1xuICBhc3NlcnQoISFyZXN1bHQpO1xuICBjb25zdCBbLCBwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdF0gPSByZXN1bHQ7XG4gIHJldHVybiBbcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdLmZpbHRlcihpc1RydXRoeSk7XG59O1xuXG4vLyByZXR1cm5zIHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2hpY2ggaGFzIG1vbm9yZXBvIG1hcmtlcnMsIG11bHRpcGxlXG4vLyBkaXJlY3RvcmllcyBjYW4gaGF2ZSB0aGVtIC0gd2hpY2hldmVyIHJlYWQgZmlyc3Qgd2lsbCBiZSByZXR1cm5lZFxuLy8gc28gaWYgb3JkZXIgaXMgaW1wb3J0YW50IC0gc2Nhbm5pbmcgc2hvdWxkIGJlIHNlcGFyYXRlZCB0byBtdWx0aXBsZSBqb2JzXG4vLyB2aWEgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnNcbmNvbnN0IGhhc1Jvb3RNYXJrZXJzID0gYXN5bmMgKGNhbmRpZGF0ZXM6IHN0cmluZ1tdKSA9PiB7XG4gIGNvbnN0IG1hcmtlcnMgPSBbXG4gICAgJy5naXQnLFxuICAgICd5YXJuLmxvY2snLFxuICAgICdwbnBtLWxvY2sueWFtbCcsXG4gICAgJ3BhY2thZ2UtbG9jay5qc29uJyxcbiAgICAncG5wbS13b3Jrc3BhY2UueWFtbCcsXG4gIF07XG4gIGNvbnN0IG1hcmtlcnNTdHJlYW0gPSBmZy5zdHJlYW0oXG4gICAgY2FuZGlkYXRlcy5mbGF0TWFwKChkaXIpID0+IG1hcmtlcnMubWFwKChtYXJrZXIpID0+IGpvaW4oZGlyLCBtYXJrZXIpKSksXG4gICAge1xuICAgICAgbWFya0RpcmVjdG9yaWVzOiB0cnVlLFxuICAgICAgb25seUZpbGVzOiBmYWxzZSxcbiAgICB9XG4gICk7XG4gIGZvciBhd2FpdCAoY29uc3QgZW50cnkgb2YgbWFya2Vyc1N0cmVhbSkge1xuICAgIGFzc2VydCh0eXBlb2YgZW50cnkgPT09ICdzdHJpbmcnKTtcbiAgICByZXR1cm4gZGlybmFtZShlbnRyeSk7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbmNvbnN0IHByaW9yaXRpemVkSGFzTWFya2VycyA9IChqb2JzOiBzdHJpbmdbXVtdKSA9PiB7XG4gIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgfVxuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPigocmVzKSA9PiB7XG4gICAgY29uc3QgcmVzdWx0cyA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmcgfCB1bmRlZmluZWQ+KCk7XG5cbiAgICBjb25zdCBjaGVja1Nob3VsZENvbXBsZXRlID0gKGluZGV4OiBudW1iZXIsIHJlc3VsdDogc3RyaW5nIHwgdW5kZWZpbmVkKSA9PiB7XG4gICAgICByZXN1bHRzLnNldChpbmRleCwgcmVzdWx0KTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgam9icy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBoYXNSZXN1bHQgPSByZXN1bHRzLmhhcyhpKTtcbiAgICAgICAgaWYgKCFoYXNSZXN1bHQpIHtcbiAgICAgICAgICAvLyBpZiBhIGpvYiB3aXRoIGhpZ2hlc3QgcHJpb3JpdHkgaGFzbid0IGZpbmlzaGVkIHlldFxuICAgICAgICAgIC8vIHRoZW4gd2FpdCBmb3IgaXRcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXN1bHQgPSByZXN1bHRzLmdldChpKTtcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIC8vIGpvYiBmaW5pc2hlZCBhbmQgd2UgZm91bmQgbWFya2VycywgYWxzbyBhbGwgam9ic1xuICAgICAgICAgIC8vIHdpdGggaGlnaGVyIHByaW9yaXR5IGZpbmlzaGVkIGFuZCB0aGV5IGRvbid0IGhhdmVcbiAgICAgICAgICAvLyBhbnkgbWFya2VycyAtIHdlIGFyZSBkb25lXG4gICAgICAgICAgcmVzKHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHRzLnNpemUgPT09IGpvYnMubGVuZ3RoKSB7XG4gICAgICAgIC8vIGFsbCBqb2JzIGZpbmlzaGVkIC0gbm8gbWFya2VycyBmb3VuZFxuICAgICAgICByZXModW5kZWZpbmVkKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgam9icy5mb3JFYWNoKChkaXJlY3RvcmllcywgaW5kZXgpID0+IHtcbiAgICAgIGhhc1Jvb3RNYXJrZXJzKGRpcmVjdG9yaWVzKVxuICAgICAgICAudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgICAgY2hlY2tTaG91bGRDb21wbGV0ZShpbmRleCwgcmVzdWx0KTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBpZ25vcmVcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn07XG5cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuID0gYXN5bmMgKFxuICBsb29rdXBEaXJlY3Rvcnk6IHN0cmluZ1xuKSA9PiB7XG4gIGNvbnN0IHVuaXF1ZURpcm5hbWUgPSAocGF0aD86IHN0cmluZykgPT4ge1xuICAgIGlmICghcGF0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBkaXJuYW1lKHBhdGgpO1xuICAgIGlmIChyZXN1bHQgPT09IHBhdGgpIHtcbiAgICAgIC8vIGUuZy4gdGhlIHBhdGggd2FzIGFscmVhZHkgYSByb290IFwiL1wiXG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgY29uc3QgcGFyZW50ID0gdW5pcXVlRGlybmFtZShsb29rdXBEaXJlY3RvcnkpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IHVuaXF1ZURpcm5hbWUocGFyZW50KTtcblxuICByZXR1cm4gKFxuICAgIChhd2FpdCBwcmlvcml0aXplZEhhc01hcmtlcnMoXG4gICAgICAvLyBzY2FuIGluIG1vc3QgbGlrZWx5IGxvY2F0aW9ucyBmaXJzdCB3aXRoIGN1cnJlbnQgbG9va3VwIGRpcmVjdG9yeSB0YWtpbmcgcHJpb3JpdHlcbiAgICAgIFtcbiAgICAgICAgW2xvb2t1cERpcmVjdG9yeV0sXG4gICAgICAgIGdldFJlcG9zaXRvcnlSb290U2NhbkNhbmRpZGF0ZXMobG9va3VwRGlyZWN0b3J5KSxcbiAgICAgICAgLy8gc2NhbiAyIGRpcmVjdG9yaWVzIHVwd2FyZHNcbiAgICAgICAgW3BhcmVudF0sXG4gICAgICAgIFtzdXBlclBhcmVudF0sXG4gICAgICBdXG4gICAgICAgIC5tYXAoKGRpcnMpID0+IGRpcnMuZmlsdGVyKGlzVHJ1dGh5KSlcbiAgICAgICAgLmZpbHRlcigoam9iKSA9PiBqb2IubGVuZ3RoID4gMClcbiAgICApKSB8fCBsb29rdXBEaXJlY3RvcnkgLyogZmFsbGJhY2sgdG8gY3VycmVudCBkaXJlY3RvcnkgaW4gd29yc2Ugc2NlbmFyaW8gKi9cbiAgKTtcbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIHJlcG9zaXRvcnkgcm9vdCBwYXRoIGJ5IHNjYW5uaW5nIGN1cnJlbnQgYW5kIHBhcmVudCBkaXJlY3Rvcmllc1xuICogYW5kIGxvb2tpbmcgZm9yIG1hcmtlciBmaWxlcy9kaXJzIGxpa2U6XG4gKlxuICogLSAuZ2l0XG4gKiAtIHBhY2thZ2UtbG9jay5qc29uXG4gKiAtIHlhcm4ubG9ja1xuICogLSBwbnBtLWxvY2sueWFtbFxuICogLSBwbnBtLXdvcmtzcGFjZS55YW1sXG4gKi9cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGggPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290UGF0aCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4ocHJvY2Vzcy5jd2QoKSk7XG4gIHJldHVybiByb290UGF0aDtcbn0pO1xuIiwiLyoqXG4gKiBDYXB0dXJlIHRoZSBzdGFjayB0cmFjZSBhbmQgYWxsb3cgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgdGhyb3duIGluIGFzeW5jaHJvbm91cyBjYWxsYmFja3NcbiAqIHdpdGggYWRkaXRpb25hbCBzdGFjayBpbmZvcm1hdGlvbiBjYXB0dXJlZCBhdCB0aGUgbW9tZW50IG9mIHRoZSBjYWxsIG9mIHRoaXMgZnVuY3Rpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhcHR1cmVTdGFja1RyYWNlKHJlbW92ZSA9IDApIHtcbiAgY29uc3Qgc3RhY2tDb250YWluZXIgPSB7XG4gICAgc3RhY2s6ICcnLFxuICB9O1xuICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShzdGFja0NvbnRhaW5lcik7XG4gIGNvbnN0IHN0YWNrVHJhY2UgPSBzdGFja0NvbnRhaW5lci5zdGFja1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuc2xpY2UoNiArIHJlbW92ZSlcbiAgICAuam9pbignXFxuJyk7XG4gIHJldHVybiB7XG4gICAgLyoqXG4gICAgICogQ2FwdHVyZWQgc3RhY2sgdHJhY2UgaW5mb3JtYXRpb25cbiAgICAgKi9cbiAgICBzdGFja1RyYWNlLFxuICAgIC8qKlxuICAgICAqIENhbiBiZSBjYWxsZWQgaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrIHRvIGVucmljaCBleGNlcHRpb25zIHdpdGggYWRkaXRpb25hbCBpbmZvcm1hdGlvblxuICAgICAqIEBwYXJhbSBlcnIgRXhjZXB0aW9uIHRvIGVucmljaCAtIGl0IGlzIGdvaW5nIHRvIGhhdmUgaXRzIGAuc3RhY2tgIHByb3AgbXV0YXRlZFxuICAgICAqIEByZXR1cm5zIFNhbWUgZXhjZXB0aW9uXG4gICAgICovXG4gICAgcHJlcGFyZUZvclJldGhyb3c6IChlcnI6IEVycm9yKSA9PiB7XG4gICAgICBjb25zdCBvbGRTdGFja1RyYWNlID0gZXJyLnN0YWNrID8/ICcnLnNwbGl0KCdcXG4nKS5zbGljZSgxKS5qb2luKCdcXG4nKTtcbiAgICAgIGVyci5zdGFjayA9IGAke2Vyci5uYW1lIHx8ICdFcnJvcid9OiAke1xuICAgICAgICBlcnIubWVzc2FnZVxuICAgICAgfVxcbiR7b2xkU3RhY2tUcmFjZX1cXG4ke3N0YWNrVHJhY2V9YDtcbiAgICAgIHJldHVybiBlcnI7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHNwYXduIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IEFzc2lnbiB9IGZyb20gJ3V0aWxpdHktdHlwZXMnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IGNhcHR1cmVTdGFja1RyYWNlIH0gZnJvbSAnLi4vdXRpbHMvc3RhY2tUcmFjZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduVG9Qcm9taXNlT3B0cyA9IHtcbiAgLyoqXG4gICAqIFNwZWNpZnkgZXhpdCBjb2RlcyB3aGljaCBzaG91bGQgbm90IHJlc3VsdCBpbiB0aHJvd2luZyBhbiBlcnJvciB3aGVuXG4gICAqIHRoZSBwcm9jZXNzIGhhcyBmaW5pc2hlZCwgZS5nLiBzcGVjaWZ5aW5nIGBbMF1gIG1lYW5zIGlmIHByb2Nlc3MgZmluaXNoZWRcbiAgICogd2l0aCB6ZXJvIGV4aXQgY29kZSB0aGVuIHRoZSBwcm9taXNlIHdpbGwgcmVzb2x2ZSBpbnN0ZWFkIG9mIHJlamVjdGluZy5cbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgc3BlY2lmeSBgaW5oZXJpdGAgdG8gc2F2ZSBzdGF0dXMgY29kZSB0byB0aGUgY3VycmVudCBgcHJvY2Vzcy5leGl0Q29kZWBcbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgY29tcGxldGVseSBpZ25vcmUgdGhlIGV4aXQgY29kZSAoZS5nLiB5b3UgZm9sbG93IHVwIGFuZCBpbnRlcnJvZ2F0ZVxuICAgKiB0aGUgcHJvY2VzcyBjb2RlIG1hbnVhbGx5IGFmdGVyd2FyZHMpXG4gICAqL1xuICBleGl0Q29kZXM6IG51bWJlcltdIHwgJ2luaGVyaXQnIHwgJ2FueSc7XG59O1xuXG50eXBlIFNoYXJlZE9wdHMgPSBQaWNrPFNwYXduT3B0aW9ucywgJ2N3ZCc+O1xuXG50eXBlIFNwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PiA9IFtcbiAgY29tbWFuZDogc3RyaW5nLFxuICBhcmdzOiBSZWFkb25seUFycmF5PHN0cmluZz4sXG4gIG9wdGlvbnM6IEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+XG5dO1xuXG5leHBvcnQgdHlwZSBTcGF3bk9wdGlvbnNXaXRoRXh0cmE8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICBBc3NpZ248U3Bhd25PcHRpb25zLCBFPjtcblxuZXhwb3J0IHR5cGUgU3Bhd25QYXJhbWV0ZXJNaXg8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICB8IFtjcDogQ2hpbGRQcm9jZXNzLCBleHRyYU9wdHM6IEFzc2lnbjxFLCBTaGFyZWRPcHRzPl1cbiAgfCBTcGF3bkFyZ3M8RT47XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgYXJnczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbik6IGFyZ3MgaXMgU3Bhd25BcmdzPEU+IHtcbiAgcmV0dXJuICEoYXJnc1swXSBpbnN0YW5jZW9mIENoaWxkUHJvY2VzcykgJiYgdHlwZW9mIGFyZ3NbMF0gPT09ICdzdHJpbmcnO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzPEUgZXh0ZW5kcyBvYmplY3Q+KFxuICBwYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxFPlxuKSB7XG4gIGNvbnN0IFtjaGlsZCwgW2NvbW1hbmQsIGFyZ3MsIG9wdHNdXSA9IGlzU3Bhd25BcmdzKHBhcmFtZXRlcnMpXG4gICAgPyBbXG4gICAgICAgIHNwYXduKC4uLihwYXJhbWV0ZXJzIGFzIHVua25vd24gYXMgUGFyYW1ldGVyczx0eXBlb2Ygc3Bhd24+KSksXG4gICAgICAgIHBhcmFtZXRlcnMsXG4gICAgICBdXG4gICAgOiBbXG4gICAgICAgIHBhcmFtZXRlcnNbMF0sXG4gICAgICAgIFtcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduZmlsZSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduYXJncy5zbGljZSgxKSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzFdIGFzIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+LFxuICAgICAgICBdLFxuICAgICAgXTtcbiAgcmV0dXJuIHtcbiAgICBjaGlsZCxcbiAgICBjb21tYW5kLFxuICAgIGFyZ3MsXG4gICAgb3B0cyxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduVG9Qcm9taXNlKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHsgY2hpbGQsIGNvbW1hbmQsIGFyZ3MsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgeyBwcmVwYXJlRm9yUmV0aHJvdyB9ID0gY2FwdHVyZVN0YWNrVHJhY2UoKTtcblxuICBjb25zdCBleGl0Q29kZXMgPSBvcHRzLmV4aXRDb2RlcztcblxuICBjb25zdCBjd2QgPSBvcHRzLmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY21kID0gKCkgPT4gW2NvbW1hbmQsIC4uLmFyZ3NdLmpvaW4oJyAnKTtcblxuICBsb2dnZXIuZGVidWcoWyc+JywgY21kKCldLmpvaW4oJyAnKSwgLi4uKGN3ZCA/IFtgaW4gJHtjd2R9YF0gOiBbXSkpO1xuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMsIHJlaikgPT5cbiAgICBjaGlsZFxuICAgICAgLm9uKCdjbG9zZScsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGV4aXRDb2RlcyAhPT0gJ2luaGVyaXQnICYmXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdhbnknICYmXG4gICAgICAgICAgICAhZXhpdENvZGVzLmluY2x1ZGVzKGNvZGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZWooXG4gICAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihgQ29tbWFuZCBcIiR7Y21kKCl9XCIgaGFzIGZhaWxlZCB3aXRoIGNvZGUgJHtjb2RlfWApXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgICByZWooXG4gICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBGYWlsZWQgdG8gZXhlY3V0ZSBjb21tYW5kIFwiJHtjbWQoKX1cIiAtICR7c2lnbmFsfWApXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLm9uKCdlcnJvcicsIHJlailcbiAgKTtcbiAgLy8gaW5oZXJpdCBleGl0IGNvZGVcbiAgaWYgKGV4aXRDb2RlcyA9PT0gJ2luaGVyaXQnKSB7XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIGNoaWxkLmV4aXRDb2RlID09PSAnbnVtYmVyJyAmJlxuICAgICAgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJyB8fCBwcm9jZXNzLmV4aXRDb2RlID09PSAwKVxuICAgICkge1xuICAgICAgcHJvY2Vzcy5leGl0Q29kZSA9IGNoaWxkLmV4aXRDb2RlO1xuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuXG5pbXBvcnQgdHlwZSB7IFNwYXduUGFyYW1ldGVyTWl4LCBTcGF3blRvUHJvbWlzZU9wdHMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcblxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRPcHRzID0ge1xuICBvdXRwdXQ/OiBbJ3N0ZG91dCcgfCAnc3RkZXJyJywgLi4uQXJyYXk8J3N0ZG91dCcgfCAnc3RkZXJyJz5dO1xufSAmIFNwYXduVG9Qcm9taXNlT3B0cztcblxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRSZXR1cm4gPSB7XG4gIHBpZD86IG51bWJlcjtcbiAgb3V0cHV0OiBzdHJpbmdbXTtcbiAgc3Rkb3V0OiBzdHJpbmc7XG4gIHN0ZGVycjogc3RyaW5nO1xuICBzdGF0dXM6IG51bWJlciB8IG51bGw7XG4gIHNpZ25hbDogTm9kZUpTLlNpZ25hbHMgfCBudWxsO1xuICBlcnJvcj86IEVycm9yIHwgdW5kZWZpbmVkO1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduUmVzdWx0KFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxTcGF3blJlc3VsdE9wdHM+XG4pOiBQcm9taXNlPFNwYXduUmVzdWx0UmV0dXJuPiB7XG4gIGNvbnN0IHsgY2hpbGQsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgY29tYmluZWREYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGRvdXREYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBvdXRwdXQgPSBvcHRzLm91dHB1dCA/PyBbJ3N0ZG91dCcsICdzdGRlcnInXTtcbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3Rkb3V0JykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZG91dCxcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRvdXRcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRvdXREYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3RkZXJyJykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZGVycixcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRlcnJcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3NwYXduVG9Qcm9taXNlKGNoaWxkLCBvcHRzKV0pO1xuICByZXR1cm4ge1xuICAgIHBpZDogY2hpbGQucGlkLFxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcbiAgICBzdGF0dXM6IGNoaWxkLmV4aXRDb2RlLFxuICAgIGdldCBvdXRwdXQoKSB7XG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xuICAgIH0sXG4gICAgZ2V0IHN0ZGVycigpIHtcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IHN0ZG91dCgpIHtcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IGVycm9yKCkge1xuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcbiAgICAgICAgPyAocmVzdWx0LnJlYXNvbiBhcyBFcnJvcilcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMsIFNwYXduUmVzdWx0UmV0dXJuIH0gZnJvbSAnLi9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBzcGF3blJlc3VsdCB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwgb3B0cyk7XG4gIHJldHVybiByZXN1bHQub3V0cHV0LmpvaW4oJycpO1xufVxuXG5jb25zdCBkZWZhdWx0U2hvdWxkT3V0cHV0ID0gKHJlc3VsdDogU3Bhd25SZXN1bHRSZXR1cm4pID0+IHtcbiAgcmV0dXJuIHJlc3VsdC5lcnJvciB8fCByZXN1bHQuc3RhdHVzICE9PSAwIHx8IGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJztcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxcbiAgICBTcGF3blJlc3VsdE9wdHMgJiB7XG4gICAgICAvKipcbiAgICAgICAqIEJ5IGRlZmF1bHQgd2lsbCBvdXRwdXQgdG8gYHN0ZGVycmAgd2hlbiBzcGF3biByZXN1bHQgZmFpbGVkIHdpdGggYW4gZXJyb3IsIHdoZW5cbiAgICAgICAqIHN0YXR1cyBjb2RlIGlzIG5vdCB6ZXJvIG9yIHdoZW4gYExvZ2dlci5sb2dMZXZlbGAgaXMgYGRlYnVnYFxuICAgICAgICovXG4gICAgICBzaG91bGRPdXRwdXQ/OiAocmVzdWx0OiBTcGF3blJlc3VsdFJldHVybikgPT4gYm9vbGVhbjtcbiAgICB9XG4gID5cbikge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcbiAgY29uc3Qgc2hvdWxkT3V0cHV0ID0gb3B0cy5zaG91bGRPdXRwdXQgPz8gZGVmYXVsdFNob3VsZE91dHB1dDtcbiAgaWYgKHNob3VsZE91dHB1dChyZXN1bHQpKSB7XG4gICAgbG9nZ2VyLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xuICB9XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzdWx0KTtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBpbmNsdWRlc0FueU9mKHRhcmdldDogc3RyaW5nW10sIGhhc0FueU9mQXJnczogc3RyaW5nW10pIHtcbiAgcmV0dXJuIGhhc0FueU9mQXJncy5zb21lKCh2YXJpYW50KSA9PiB0YXJnZXQuaW5jbHVkZXModmFyaWFudCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5zZXJ0QWZ0ZXJBbnlPZihcbiAgdGFyZ2V0OiBzdHJpbmdbXSxcbiAgaW5zZXJ0OiBzdHJpbmdbXSxcbiAgaGFzQW55T2ZBcmdzOiBzdHJpbmdbXVxuKSB7XG4gIGNvbnN0IGluZGV4ID0gdGFyZ2V0LmZpbmRJbmRleCgodmFsdWUpID0+IGhhc0FueU9mQXJncy5pbmNsdWRlcyh2YWx1ZSkpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgcmV0dXJuIHRhcmdldDtcbiAgfVxuICBjb25zdCByZXN1bHQgPSBbLi4udGFyZ2V0XTtcbiAgcmVzdWx0LnNwbGljZShpbmRleCArIDEsIDAsIC4uLmluc2VydCk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVBcmdzRnJvbShcbiAgdGFyZ2V0OiBzdHJpbmdbXSxcbiAgYXJnczogQXJyYXk8c3RyaW5nIHwgUmVnRXhwPixcbiAgb3B0cz86IHsgbnVtVmFsdWVzOiBudW1iZXIgfVxuKSB7XG4gIGNvbnN0IHJlc3VsdCA9IFsuLi50YXJnZXRdO1xuICBmb3IgKGNvbnN0IGFyZyBvZiBhcmdzKSB7XG4gICAgY29uc3QgaW5kZXggPSB0YXJnZXQuZmluZEluZGV4KCh2YWx1ZSkgPT5cbiAgICAgIHR5cGVvZiBhcmcgPT09ICdzdHJpbmcnID8gdmFsdWUgPT09IGFyZyA6IGFyZy50ZXN0KHZhbHVlKVxuICAgICk7XG4gICAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgICAgcmVzdWx0LnNwbGljZShpbmRleCwgb3B0cz8ubnVtVmFsdWVzID8gb3B0cy5udW1WYWx1ZXMgKyAxIDogMSk7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVJbnB1dEFyZ3MoXG4gIGFyZ3M6IEFycmF5PHN0cmluZyB8IFJlZ0V4cD4sXG4gIG9wdHM/OiB7IG51bVZhbHVlczogbnVtYmVyIH1cbikge1xuICByZXR1cm4gKHN0YXRlOiBDbGlBcmdzKSA9PiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgaW5wdXRBcmdzOiByZW1vdmVBcmdzRnJvbShzdGF0ZS5pbnB1dEFyZ3MsIGFyZ3MsIG9wdHMpLFxuICAgIH07XG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXREZWZhdWx0QXJncyhcbiAgYXJnczogW3N0cmluZywgLi4uc3RyaW5nW11dLFxuICB2YWx1ZXM6IHN0cmluZ1tdID0gW10sXG4gIGNvbmRpdGlvbj86IChzdGF0ZTogQ2xpQXJncykgPT4gYm9vbGVhbixcbiAgYXBwbHk/OiAoYXJnczogc3RyaW5nW10sIHN0YXRlOiBDbGlBcmdzKSA9PiBDbGlBcmdzXG4pIHtcbiAgcmV0dXJuIChzdGF0ZTogQ2xpQXJncykgPT4ge1xuICAgIGlmIChjb25kaXRpb24pIHtcbiAgICAgIGlmICghY29uZGl0aW9uKHN0YXRlKSkge1xuICAgICAgICByZXR1cm4gc3RhdGU7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChpbmNsdWRlc0FueU9mKHN0YXRlLmlucHV0QXJncywgYXJncykpIHtcbiAgICAgIHJldHVybiBzdGF0ZTtcbiAgICB9XG4gICAgY29uc3Qgc2V0OiBOb25OdWxsYWJsZTx0eXBlb2YgYXBwbHk+ID0gYXBwbHlcbiAgICAgID8gYXBwbHlcbiAgICAgIDogKGFyZ3MsIHRvKSA9PiAoe1xuICAgICAgICAgIC4uLnRvLFxuICAgICAgICAgIHByZUFyZ3M6IFsuLi5zdGF0ZS5wcmVBcmdzLCAuLi5hcmdzXSxcbiAgICAgICAgfSk7XG4gICAgcmV0dXJuIHNldChbYXJnc1swXSwgLi4udmFsdWVzXSwgc3RhdGUpO1xuICB9O1xufVxuXG5leHBvcnQgY29uc3QgcmVtb3ZlTG9nTGV2ZWxPcHRpb24gPSAoKSA9PlxuICByZW1vdmVJbnB1dEFyZ3MoWyctLWxvZy1sZXZlbCddLCB7IG51bVZhbHVlczogMSB9KTtcblxuZXhwb3J0IHR5cGUgQ2xpQXJncyA9IHtcbiAgLyoqXG4gICAqIEV4dHJhIGFyZ3VtZW50cyB0aGF0IGdvIGJlZm9yZSBhcmd1bWVudHMgcGFzc2VkIGluIGJ5IHRoZSB1c2VyXG4gICAqL1xuICBwcmVBcmdzOiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIEFyZ3VtZW50cyBhcyBwYXNzZWQgaW4gYnkgdGhlIHVzZXIsIGNvdWxkIGJlIG1vZGlmaWVkIGJ5XG4gICAqIHRyYW5zZm9ybXMgdGhhdCBjb21lIGJlZm9yZSBjdXJyZW50XG4gICAqL1xuICBpbnB1dEFyZ3M6IHN0cmluZ1tdO1xuICAvKipcbiAgICogRXh0cmEgYXJndW1lbnRzIHRoYXQgZ28gYWZ0ZXIgYXJndW1lbnRzIHBhc3NlZCBpbiBieSB0aGUgdXNlclxuICAgKi9cbiAgcG9zdEFyZ3M6IHN0cmluZ1tdO1xufTtcblxuZXhwb3J0IHR5cGUgQ2xpQXJnc1RyYW5zZm9ybSA9IChzdGF0ZTogQ2xpQXJncykgPT4gQ2xpQXJncztcblxuZXhwb3J0IGZ1bmN0aW9uIGNsaUFyZ3NQaXBlKFxuICB0cmFuc2Zvcm1zOiBDbGlBcmdzVHJhbnNmb3JtW10sXG4gIGlucHV0QXJnczogc3RyaW5nW11cbikge1xuICBjb25zdCB7XG4gICAgcHJlQXJncyxcbiAgICBpbnB1dEFyZ3M6IG1vZGlmaWVkSW5wdXRBcmdzLFxuICAgIHBvc3RBcmdzLFxuICB9ID0gdHJhbnNmb3Jtcy5yZWR1Y2U8Q2xpQXJncz4oKGFjYywgdHJhbnNmb3JtKSA9PiB0cmFuc2Zvcm0oYWNjKSwge1xuICAgIGlucHV0QXJncyxcbiAgICBwcmVBcmdzOiBbXSxcbiAgICBwb3N0QXJnczogW10sXG4gIH0pO1xuICByZXR1cm4gWy4uLnByZUFyZ3MsIC4uLm1vZGlmaWVkSW5wdXRBcmdzLCAuLi5wb3N0QXJnc107XG59XG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4vbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5cbmV4cG9ydCBmdW5jdGlvbiBtb2R1bGVzQmluUGF0aChiaW46IHN0cmluZykge1xuICByZXR1cm4gam9pbihtb2R1bGVSb290RGlyZWN0b3J5KCksIGAuL25vZGVfbW9kdWxlcy8uYmluLyR7YmlufWApO1xufVxuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnNXaXRoRXh0cmEgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IFNwYXduUmVzdWx0T3B0cyB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdCc7XG5pbXBvcnQgdHlwZSB7IENsaUFyZ3MgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGNsaUFyZ3NQaXBlIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBpbnNlcnRBZnRlckFueU9mIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBpbmNsdWRlc0FueU9mIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBtb2R1bGVzQmluUGF0aCB9IGZyb20gJy4vdXRpbHMvbW9kdWxlc0JpblBhdGgnO1xuaW1wb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi91dGlscy9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5leHBvcnQgdHlwZSBUYXNrVHlwZXMgPVxuICB8ICdsaW50J1xuICB8ICdidWlsZCdcbiAgfCAndGVzdCdcbiAgfCAnZGVjbGFyYXRpb25zJ1xuICB8ICdpbnRlZ3JhdGlvbidcbiAgfCAnc2V0dXA6aW50ZWdyYXRpb24nXG4gIHwgKHN0cmluZyAmIHtcbiAgICAgIF9hbGxvd1N0cmluZ3M/OiB1bmRlZmluZWQ7XG4gICAgfSk7XG5cbmNvbnN0IHR1cmJvUGF0aCA9ICgpID0+IG1vZHVsZXNCaW5QYXRoKCd0dXJibycpO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFzVHVyYm9Kc29uKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBjd2QgPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGgoKTtcbiAgcmV0dXJuIGF3YWl0IHN0YXQoam9pbihjd2QsICd0dXJiby5qc29uJykpXG4gICAgLnRoZW4oKHJlcykgPT4gcmVzLmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXNzVHVyYm9Gb3JjZUVudihhcmdzOiBzdHJpbmdbXSkge1xuICByZXR1cm4gaW5jbHVkZXNBbnlPZihhcmdzLCBbJ3J1biddKSAmJiBpbmNsdWRlc0FueU9mKGFyZ3MsIFsnLS1mb3JjZSddKVxuICAgID8ge1xuICAgICAgICBUVVJCT19GT1JDRTogJzEnLFxuICAgICAgfVxuICAgIDogdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5oZXJpdFR1cmJvRm9yY2VBcmdGcm9tRW52KCkge1xuICByZXR1cm4gKHN0YXRlOiBDbGlBcmdzKSA9PiAoe1xuICAgIC4uLnN0YXRlLFxuICAgIGlucHV0QXJnczpcbiAgICAgIGluY2x1ZGVzQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBbJ3J1biddKSAmJlxuICAgICAgIWluY2x1ZGVzQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBbJy0tZm9yY2UnXSkgJiZcbiAgICAgIHByb2Nlc3MuZW52WydUVVJCT19GT1JDRSddXG4gICAgICAgID8gaW5zZXJ0QWZ0ZXJBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsnLS1mb3JjZSddLCBbJ3J1biddKVxuICAgICAgICA6IHN0YXRlLmlucHV0QXJncyxcbiAgfSk7XG59XG5cbi8qKlxuICogUnVuIG9uZSBvZiB0aGUgZGV2IHBpcGVsaW5lIHRhc2tzIHVzaW5nIFR1cmJvIGZvciBhIHNpbmdsZSBwYWNrYWdlXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5UdXJib1Rhc2tzRm9yU2luZ2xlUGFja2FnZShvcHRzOiB7XG4gIHRhc2tzOiBbVGFza1R5cGVzLCAuLi5UYXNrVHlwZXNbXV07XG4gIHBhY2thZ2VEaXI/OiBzdHJpbmc7XG4gIHNwYXduT3B0czogT21pdDxTcGF3bk9wdGlvbnNXaXRoRXh0cmE8U3Bhd25SZXN1bHRPcHRzPiwgJ2N3ZCc+O1xufSkge1xuICBjb25zdCByb290RGlyID0gb3B0cy5wYWNrYWdlRGlyID8/IHByb2Nlc3MuY3dkKCk7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICByZXR1cm4gYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbChcbiAgICB0dXJib1BhdGgoKSxcbiAgICBjbGlBcmdzUGlwZShcbiAgICAgIFtpbmhlcml0VHVyYm9Gb3JjZUFyZ0Zyb21FbnYoKV0sXG4gICAgICBbXG4gICAgICAgICdydW4nLFxuICAgICAgICAuLi5vcHRzLnRhc2tzLFxuICAgICAgICAnLS1maWx0ZXI9JyArIHJvb3REaXIucmVwbGFjZShjd2QsICcuJyksXG4gICAgICAgICctLW91dHB1dC1sb2dzPW5ldy1vbmx5JyxcbiAgICAgIF1cbiAgICApLFxuICAgIHtcbiAgICAgIC4uLm9wdHMuc3Bhd25PcHRzLFxuICAgICAgY3dkLFxuICAgIH1cbiAgKTtcbn1cbiIsImltcG9ydCB7IGxvYWQgfSBmcm9tICdqcy15YW1sJztcbmltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICcuL29uY2VBc3luYyc7XG5pbXBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3JlcG9zaXRvcnlSb290UGF0aCc7XG5cbmNvbnN0IHJlYWRQYWNrYWdlc0dsb2JzQXQgPSBhc3luYyAobW9ub3JlcG9Sb290OiBzdHJpbmcpID0+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVhZEZpbGUoXG4gICAgICBqb2luKG1vbm9yZXBvUm9vdCwgJ3BucG0td29ya3NwYWNlLnlhbWwnKSxcbiAgICAgICd1dGYtOCdcbiAgICApO1xuICAgIGNvbnN0IHJvb3RQYXRoID0gbG9hZCh0ZXh0KSBhcyB7XG4gICAgICBwYWNrYWdlcz86IHN0cmluZ1tdO1xuICAgIH07XG4gICAgcmV0dXJuIHJvb3RQYXRoLnBhY2thZ2VzID8/IFtdO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIuZXJyb3IoZXJyKTtcbiAgICByZXR1cm4gW107XG4gIH1cbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIG1vbm9yZXBvIHBhY2thZ2VzIGdsb2IgYnkgcmVhZGluZyBvbmUgb2YgdGhlIHN1cHBvcnRlZFxuICogZmlsZXNcbiAqXG4gKiBOT1RFOiBvbmx5IHBucG0gaXMgc3VwcG9ydGVkIGF0IHRoZSBtb21lbnRcbiAqL1xuZXhwb3J0IGNvbnN0IHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMgPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290ID0gYXdhaXQgcmVwb3NpdG9yeVJvb3RQYXRoKCk7XG4gIGNvbnN0IHBhY2thZ2VzR2xvYnMgPSBhd2FpdCByZWFkUGFja2FnZXNHbG9ic0F0KHJvb3QpO1xuICByZXR1cm4ge1xuICAgIHJvb3QsXG4gICAgcGFja2FnZXNHbG9icyxcbiAgfTtcbn0pO1xuIiwiaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgaGFzVHVyYm9Kc29uIH0gZnJvbSAnLi4vdHVyYm8nO1xuaW1wb3J0IHsgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyB9IGZyb20gJy4vcmVhZFBhY2thZ2VzR2xvYnMnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uKCkge1xuICBjb25zdCBbeyByb290LCBwYWNrYWdlc0dsb2JzIH0sIGhhc1R1cmJvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzKCksXG4gICAgaGFzVHVyYm9Kc29uKCksXG4gIF0pO1xuICBpZiAocGFja2FnZXNHbG9icy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4ge1xuICAgICAgcm9vdCxcbiAgICAgIHBhY2thZ2VzR2xvYnMsXG4gICAgICBwYWNrYWdlTG9jYXRpb25zOiBbXSxcbiAgICAgIGhhc1R1cmJvLFxuICAgICAgdHlwZTogJ3NpbmdsZS1wYWNrYWdlJyBhcyBjb25zdCxcbiAgICB9O1xuICB9XG4gIGNvbnN0IHBhY2thZ2VMb2NhdGlvbnMgPSBhd2FpdCBmZyhcbiAgICBwYWNrYWdlc0dsb2JzLm1hcCgoZ2xvYikgPT4gYCR7Z2xvYn0vcGFja2FnZS5qc29uYCksXG4gICAge1xuICAgICAgY3dkOiByb290LFxuICAgIH1cbiAgKTtcbiAgcmV0dXJuIHtcbiAgICByb290LFxuICAgIHBhY2thZ2VzR2xvYnMsXG4gICAgcGFja2FnZUxvY2F0aW9uczogcGFja2FnZUxvY2F0aW9ucy5tYXAoKGxvY2F0aW9uKSA9PiBkaXJuYW1lKGxvY2F0aW9uKSksXG4gICAgaGFzVHVyYm8sXG4gICAgdHlwZTogJ211bHRpcGxlLXBhY2thZ2VzJyBhcyBjb25zdCxcbiAgfTtcbn1cbiIsImltcG9ydCB7IHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IHJlYWRDd2RQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4vbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5pbXBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3JlcG9zaXRvcnlSb290UGF0aCc7XG5cbmV4cG9ydCB7IHJlYWRQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuZXhwb3J0IHsgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uIH0gZnJvbSAnLi9sb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24nO1xuZXhwb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiB0ZXN0UGF0aChvcHRzOiB7IHBhdGg6IHN0cmluZzsgbG9va3VwUGFja2FnZU5hbWU6IHN0cmluZyB9KSB7XG4gIGNvbnN0IHBhdGggPSBqb2luKG9wdHMucGF0aCwgJ25vZGVfbW9kdWxlcycsIG9wdHMubG9va3VwUGFja2FnZU5hbWUpO1xuICByZXR1cm4gc3RhdChwYXRoKVxuICAgIC50aGVuKChyZXN1bHQpID0+IChyZXN1bHQuaXNEaXJlY3RvcnkoKSA/IHBhdGggOiB1bmRlZmluZWQpKVxuICAgIC5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xufVxuXG5hc3luYyBmdW5jdGlvbiB0ZXN0UGF0aFJlbGF0aXZlVG8ob3B0czoge1xuICByb290OiBzdHJpbmc7XG4gIHdyYXBwZXJQYWNrYWdlTmFtZTogc3RyaW5nO1xuICBsb29rdXBQYWNrYWdlTmFtZTogc3RyaW5nO1xufSkge1xuICBjb25zdCBwYXRoID0gam9pbihcbiAgICBvcHRzLnJvb3QsXG4gICAgYG5vZGVfbW9kdWxlcy8ke29wdHMud3JhcHBlclBhY2thZ2VOYW1lfS9ub2RlX21vZHVsZXMvJHtvcHRzLmxvb2t1cFBhY2thZ2VOYW1lfWBcbiAgKTtcbiAgcmV0dXJuIHRlc3RQYXRoKHtcbiAgICBwYXRoLFxuICAgIGxvb2t1cFBhY2thZ2VOYW1lOiBvcHRzLmxvb2t1cFBhY2thZ2VOYW1lLFxuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdGVzdExvY2FsQW5kUm9vdCh7XG4gIHdyYXBwZXJQYWNrYWdlTmFtZSxcbiAgbG9va3VwUGFja2FnZU5hbWUsXG4gIHJlcG9Sb290UGF0aFByb21pc2UsXG59OiB7XG4gIHJlcG9Sb290UGF0aFByb21pc2U6IFByb21pc2U8c3RyaW5nPjtcbiAgd3JhcHBlclBhY2thZ2VOYW1lOiBzdHJpbmc7XG4gIGxvb2t1cFBhY2thZ2VOYW1lOiBzdHJpbmc7XG59KSB7XG4gIGNvbnN0IGxvY2FsUHJvbWlzZSA9IHRlc3RQYXRoUmVsYXRpdmVUbyh7XG4gICAgcm9vdDogcHJvY2Vzcy5jd2QoKSxcbiAgICB3cmFwcGVyUGFja2FnZU5hbWUsXG4gICAgbG9va3VwUGFja2FnZU5hbWUsXG4gIH0pO1xuICBjb25zdCByZXBvUm9vdFBhdGggPSBhd2FpdCByZXBvUm9vdFBhdGhQcm9taXNlO1xuICBpZiAocmVwb1Jvb3RQYXRoID09PSBwcm9jZXNzLmN3ZCgpKSB7XG4gICAgY29uc3QgbG9jYWwgPSBhd2FpdCBsb2NhbFByb21pc2U7XG4gICAgaWYgKGxvY2FsKSB7XG4gICAgICByZXR1cm4gbG9jYWw7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIC8vIHRlc3QgbW9ub3JlcG8gcm9vdCBhcyB3ZWxsOlxuICAgIGNvbnN0IHJvb3RQcm9taXNlID0gdGVzdFBhdGhSZWxhdGl2ZVRvKHtcbiAgICAgIHJvb3Q6IHJlcG9Sb290UGF0aCxcbiAgICAgIHdyYXBwZXJQYWNrYWdlTmFtZSxcbiAgICAgIGxvb2t1cFBhY2thZ2VOYW1lLFxuICAgIH0pO1xuICAgIGNvbnN0IGxvY2FsID0gYXdhaXQgbG9jYWxQcm9taXNlO1xuICAgIGlmIChsb2NhbCkge1xuICAgICAgcmV0dXJuIGxvY2FsO1xuICAgIH1cbiAgICBjb25zdCByb290ID0gYXdhaXQgcm9vdFByb21pc2U7XG4gICAgaWYgKHJvb3QpIHtcbiAgICAgIHJldHVybiByb290O1xuICAgIH1cbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBwYWNrYWdlTmFtZShba2V5LCB2YWx1ZV06IFtzdHJpbmcsIHN0cmluZ10pIHtcbiAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgoJ3dvcmtzcGFjZTonKSkge1xuICAgIC8vIHdvcmtzcGFjZTpwYWNrYWdlQHNlbS52ZXIueFxuICAgIGNvbnN0IHJlc3VsdCA9IC93b3Jrc3BhY2U6KC4qKUAoLiopLy5leGVjKHZhbHVlKTtcbiAgICBpZiAocmVzdWx0KSB7XG4gICAgICBjb25zdCBbLCBwYWNrYWdlTmFtZV0gPSByZXN1bHQ7XG4gICAgICBpZiAocGFja2FnZU5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHBhY2thZ2VOYW1lO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBpZiAodmFsdWUuc3RhcnRzV2l0aCgnbnBtOicpKSB7XG4gICAgLy8gbnBtOnBhY2thZ2VAc2VtLnZlci54XG4gICAgY29uc3QgcmVzdWx0ID0gL25wbTooLiopQCguKikvLmV4ZWModmFsdWUpO1xuICAgIGlmIChyZXN1bHQpIHtcbiAgICAgIGNvbnN0IFssIHBhY2thZ2VOYW1lXSA9IHJlc3VsdDtcbiAgICAgIGlmIChwYWNrYWdlTmFtZSkge1xuICAgICAgICByZXR1cm4gcGFja2FnZU5hbWU7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBrZXk7XG59XG5cbi8qKlxuICogTG9va3VwIGxvY2F0aW9uIGZvciBkZXZEZXBlbmRlbmNpZXMgb2YgXCJAcmVwa2Eta2l0L3RzXCIgLSB0aGlzIGZ1bmN0aW9uIHdpbGxcbiAqIGxvb2t1cCBmb3IgXCJvcHRzLmxvb2t1cFBhY2thZ2VOYW1lXCIsIGl0IGZhdm91cnMgdGhlIGxvY2FsIC4vbm9kZV9tb2R1bGVzLyBwYXRoXG4gKiBhbmQgZmFsbHMgYmFjayB0byB0aGUgbW9ub3JlcG8gcm9vdC5cbiAqXG4gKiBUaGlzIHdpbGwgYWxzbyB0cnkgdG8gbG9va3VwIGFsaWFzIG9mIHRoZSBcIkByZXBrYS1raXQvdHNcIiBwYWNrYWdlIGFuZCBpZiB0aGF0IGlzIGRlZmluZWRcbiAqIHdpbGwgdHJ5IHRvIGZpbmQgdGhlIGRlcGVuZGVuY2llcyBpbiB0aGUgZGVwZW5kZW5jaWVzIG9mIHRoZSBhbGlhc2VkIHBhY2thZ2UuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmaW5kRGV2RGVwZW5kZW5jeShvcHRzOiB7XG4gIHdyYXBwZXJQYWNrYWdlTmFtZT86IHN0cmluZztcbiAgbG9va3VwUGFja2FnZU5hbWU6IHN0cmluZztcbn0pIHtcbiAgY29uc3QgbG9va3VwUGFja2FnZU5hbWUgPSBvcHRzLmxvb2t1cFBhY2thZ2VOYW1lO1xuICBjb25zdCBub2RlTW9kdWxlc1Jlc3VsdCA9IGF3YWl0IHRlc3RQYXRoKHtcbiAgICBwYXRoOiBtb2R1bGVSb290RGlyZWN0b3J5KCksXG4gICAgbG9va3VwUGFja2FnZU5hbWUsXG4gIH0pO1xuICBpZiAobm9kZU1vZHVsZXNSZXN1bHQpIHtcbiAgICByZXR1cm4gbm9kZU1vZHVsZXNSZXN1bHQ7XG4gIH1cblxuICBjb25zdCB3cmFwcGVyUGFja2FnZU5hbWUgPSBvcHRzLndyYXBwZXJQYWNrYWdlTmFtZSA/PyAnQHJlcGthLWtpdC90cyc7XG5cbiAgLy8gc3RhcnQgbG9va2luZyB1cCB0aGUgcmVwb3NpdG9yeSByb290IHRvIGNoZWNrIG1vbm9yZXBvIHNjZW5hcmlvczpcbiAgY29uc3QgcmVwb1Jvb3RQYXRoUHJvbWlzZSA9IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuXG4gIGNvbnN0IGRlZmF1bHRSZXN1bHQgPSBhd2FpdCB0ZXN0UGF0aFJlbGF0aXZlVG8oe1xuICAgIHJvb3Q6IHByb2Nlc3MuY3dkKCksXG4gICAgbG9va3VwUGFja2FnZU5hbWUsXG4gICAgd3JhcHBlclBhY2thZ2VOYW1lLFxuICB9KTtcbiAgaWYgKGRlZmF1bHRSZXN1bHQpIHtcbiAgICByZXR1cm4gZGVmYXVsdFJlc3VsdDtcbiAgfVxuXG4gIC8vIGxvb2t1cCBmb3IgYWx0ZXJuYXRpdmUgbmFtZSBvZiBAcmVwa2Eta2l0L3RzXG4gIGNvbnN0IHdyYXBwZXJBbGlhc05hbWUgPSBhd2FpdCByZWFkQ3dkUGFja2FnZUpzb24oKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgIGNvbnN0IGRlcGVuZGVuY3kgPSBPYmplY3QuZW50cmllcyhyZXN1bHQuZGV2RGVwZW5kZW5jaWVzIHx8IHt9KS5maW5kKFxuICAgICAgICAoZGVwZW5kZW5jeSkgPT4gcGFja2FnZU5hbWUoZGVwZW5kZW5jeSkgPT09IHdyYXBwZXJQYWNrYWdlTmFtZVxuICAgICAgKTtcbiAgICAgIHJldHVybiBkZXBlbmRlbmN5ID8gZGVwZW5kZW5jeVswXSA6IHVuZGVmaW5lZDtcbiAgICB9KVxuICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICBsb2dnZXIud2FybignQ2Fubm90IHJlYWQgcGFja2FnZSBqc29uJywgZXJyKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfSk7XG5cbiAgaWYgKCF3cmFwcGVyQWxpYXNOYW1lKSB7XG4gICAgLy8gdGhlIG9ubHkgYWx0ZXJuYXRpdmUgbm93IGlzIHRoZSByZXBvc2l0b3J5IHJvb3RcbiAgICBjb25zdCByZXBvUm9vdFBhdGggPSBhd2FpdCByZXBvUm9vdFBhdGhQcm9taXNlO1xuICAgIGlmIChyZXBvUm9vdFBhdGggIT09IHByb2Nlc3MuY3dkKCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0ZXN0UGF0aFJlbGF0aXZlVG8oe1xuICAgICAgICByb290OiByZXBvUm9vdFBhdGgsXG4gICAgICAgIGxvb2t1cFBhY2thZ2VOYW1lLFxuICAgICAgICB3cmFwcGVyUGFja2FnZU5hbWUsXG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IGFsaWFzUmVzdWx0ID0gYXdhaXQgdGVzdExvY2FsQW5kUm9vdCh7XG4gICAgcmVwb1Jvb3RQYXRoUHJvbWlzZSxcbiAgICBsb29rdXBQYWNrYWdlTmFtZSxcbiAgICB3cmFwcGVyUGFja2FnZU5hbWU6IHdyYXBwZXJBbGlhc05hbWUsXG4gIH0pO1xuXG4gIHJldHVybiBhbGlhc1Jlc3VsdDtcbn1cbiIsImltcG9ydCB0eXBlIHsgQ29uZmlnIH0gZnJvbSAnQGplc3QvdHlwZXMnO1xuaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4uL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmltcG9ydCB7IHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlIH0gZnJvbSAnLi4vdHVyYm8nO1xuXG5hc3luYyBmdW5jdGlvbiBsb2FkU3RhbmRhcmRHbG9iYWxIb29rKFxuICBzY3JpcHQ6IHN0cmluZyxcbiAgZ2xvYmFsQ29uZmlnOiBDb25maWcuR2xvYmFsQ29uZmlnLFxuICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZ1xuKSB7XG4gIGNvbnN0IGhhc0hvb2sgPSBhd2FpdCBzdGF0KHNjcmlwdClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbiAgcmV0dXJuIHtcbiAgICBoYXNIb29rLFxuICAgIGV4ZWN1dGU6IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghaGFzSG9vaykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBsb2NhdGlvbiA9IGpvaW4ocHJvY2Vzcy5jd2QoKSwgc2NyaXB0KTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IChhd2FpdCBpbXBvcnQobG9jYXRpb24pKSBhc1xuICAgICAgICB8IHtcbiAgICAgICAgICAgIGRlZmF1bHQ/OiAoXG4gICAgICAgICAgICAgIGdsb2JhbENvbmZpZzogQ29uZmlnLkdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgICAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWdcbiAgICAgICAgICAgICkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgICAgICAgICB9XG4gICAgICAgIHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKCFyZXN1bHQgfHwgIXJlc3VsdC5kZWZhdWx0KSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGDimqDvuI8gTm8gZGVmYXVsdCBleHBvcnQgZm91bmQgaW4gXCIke3NjcmlwdH1cImApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBhd2FpdCBQcm9taXNlLnJlc29sdmUocmVzdWx0LmRlZmF1bHQoZ2xvYmFsQ29uZmlnLCBwcm9qZWN0Q29uZmlnKSk7XG4gICAgfSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEN1c3RvbUdsb2JhbEhvb2soc2NyaXB0OiBzdHJpbmcpIHtcbiAgY29uc3QgaGFzSG9vayA9IGF3YWl0IHN0YXQoc2NyaXB0KVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuICByZXR1cm4ge1xuICAgIGhhc0hvb2ssXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFoYXNIb29rKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxvY2F0aW9uID0gam9pbihwcm9jZXNzLmN3ZCgpLCBzY3JpcHQpO1xuICAgICAgY29uc3QgcGFja2FnZUpzb24gPSBhd2FpdCByZWFkUGFja2FnZUpzb24oXG4gICAgICAgIGpvaW4ocHJvY2Vzcy5jd2QoKSwgJ3BhY2thZ2UuanNvbicpXG4gICAgICApO1xuXG4gICAgICBpZiAoXG4gICAgICAgIHNjcmlwdC5lbmRzV2l0aCgnc2V0dXAudHMnKSAmJlxuICAgICAgICB0eXBlb2YgcGFja2FnZUpzb25bJ3NjcmlwdHMnXSA9PT0gJ29iamVjdCcgJiZcbiAgICAgICAgcGFja2FnZUpzb25bJ3NjcmlwdHMnXVsnc2V0dXA6aW50ZWdyYXRpb24nXSA9PT0gYHRzeCAke3NjcmlwdH1gXG4gICAgICApIHtcbiAgICAgICAgYXdhaXQgcnVuVHVyYm9UYXNrc0ZvclNpbmdsZVBhY2thZ2Uoe1xuICAgICAgICAgIHRhc2tzOiBbJ3NldHVwOmludGVncmF0aW9uJ10sXG4gICAgICAgICAgc3Bhd25PcHRzOiB7XG4gICAgICAgICAgICBleGl0Q29kZXM6IFswXSxcbiAgICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICAgICAgTE9HX0xFVkVMOiBsb2dnZXIubG9nTGV2ZWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbCgndHN4JywgW2xvY2F0aW9uXSwge1xuICAgICAgICAgIGV4aXRDb2RlczogWzBdLFxuICAgICAgICAgIGVudjoge1xuICAgICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgICBMT0dfTEVWRUw6IGxvZ2dlci5sb2dMZXZlbCxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZEFuZFJ1bkdsb2JhbEhvb2soXG4gIHNjcmlwdDogc3RyaW5nLFxuICBnbG9iYWxDb25maWc6IENvbmZpZy5HbG9iYWxDb25maWcsXG4gIHByb2plY3RDb25maWc6IENvbmZpZy5Qcm9qZWN0Q29uZmlnLFxuICB0aXA/OiBzdHJpbmdcbikge1xuICBjb25zdCBbc3RhbmRhcmQsIGN1c3RvbV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgbG9hZFN0YW5kYXJkR2xvYmFsSG9vayhgJHtzY3JpcHR9Lm1qc2AsIGdsb2JhbENvbmZpZywgcHJvamVjdENvbmZpZyksXG4gICAgbG9hZEN1c3RvbUdsb2JhbEhvb2soYCR7c2NyaXB0fS50c2ApLFxuICBdKTtcbiAgaWYgKCFjdXN0b20uaGFzSG9vayAmJiB0aXApIHtcbiAgICBsb2dnZXIudGlwKHRpcCk7XG4gIH1cbiAgYXdhaXQgc3RhbmRhcmQuZXhlY3V0ZSgpO1xuICBhd2FpdCBjdXN0b20uZXhlY3V0ZSgpO1xufVxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgZmluZERldkRlcGVuZGVuY3kgfSBmcm9tICcuLi91dGlscy9maW5kRGV2RGVwZW5kZW5jeSc7XG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICcuLi91dGlscy9vbmNlQXN5bmMnO1xuXG5leHBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmV4cG9ydCB7IGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbiB9IGZyb20gJy4uL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbic7XG5leHBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuLi91dGlscy9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuZXhwb3J0IHsgbG9hZEFuZFJ1bkdsb2JhbEhvb2sgfSBmcm9tICcuL2xvYWRBbmRSdW5HbG9iYWxIb29rJztcblxuZXhwb3J0IGNvbnN0IGplc3RQbHVnaW5Sb290ID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmluZERldkRlcGVuZGVuY3koe1xuICAgIGxvb2t1cFBhY2thZ2VOYW1lOiAnZXNidWlsZC1qZXN0JyxcbiAgfSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgbG9nZ2VyLndhcm4oXG4gICAgICAnSmVzdCBwbHVnaW5zIHJvb3QgY2Fubm90IGJlIGRldGVybWluZWQuIERvIHlvdSBoYXZlIFwiQHJlcGthLWtpdC90c1wiIGluIGRldkRlcGVuZGVuY2llcyBhdCB0aGUgbW9ub3JlcG8gcm9vdCBvciBhdCB0aGUgbG9jYWwgcGFja2FnZT8nXG4gICAgKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAobG9nZ2VyLmxvZ0xldmVsID09PSAnZGVidWcnKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ0ZvdW5kIGplc3QgcGx1Z2lucyByb290IGF0JywgZGlybmFtZShyZXN1bHQpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdCA/IGRpcm5hbWUocmVzdWx0KSA6ICcuJztcbn0pO1xuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFPLFNBQUEsSUFBQSxDQUFpQixFQUFzQixFQUFBO0FBQzVDLEVBQUksSUFBQSxLQUFBLENBQUE7QUFDSixFQUFBLElBQUksVUFBYSxHQUFBLEtBQUEsQ0FBQTtBQUNqQixFQUFBLE9BQU8sTUFBUztBQUNkLElBQUEsSUFBSSxVQUFZLEVBQUE7QUFDZCxNQUFPLE9BQUEsS0FBQSxDQUFBO0FBQUEsS0FDVDtBQUNBLElBQUEsS0FBQSxHQUFRLEVBQUcsRUFB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
