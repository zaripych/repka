// This file is bundled up from './src/*' and needs to be committed
import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import assert from 'node:assert';
import { ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';

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

function modulesBinPath(bin) {
  return join(moduleRootDirectory(), `./node_modules/.bin/${bin}`);
}

function isTruthy(value) {
  return Boolean(value);
}

const getMonorepoRootScanCandidates = (currentDirectory) => {
  const result = /(.*(?=\/packages\/))|(.*(?=\/node_modules\/))|(.*)/.exec(currentDirectory);
  assert(!!result);
  const [, packagesRoot, nodeModulesRoot] = result;
  return [packagesRoot, nodeModulesRoot].filter(isTruthy);
};
const hasMonorepoMarkers = async (candidates) => {
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
const prioritizedHasMonorepoMarkers = (jobs) => {
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
      hasMonorepoMarkers(directories).then((result) => {
        checkShouldComplete(index, result);
      }).catch(() => {
        return Promise.resolve(void 0);
      });
    });
  });
};
const getMonorepoRootViaDirectoryScan = async (lookupDirectory) => {
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
  return await prioritizedHasMonorepoMarkers([
    [lookupDirectory],
    getMonorepoRootScanCandidates(lookupDirectory),
    [parent],
    [superParent]
  ].map((dirs) => dirs.filter(isTruthy)).filter((job) => job.length > 0)) || lookupDirectory;
};
const monorepoRootPath = onceAsync(async () => {
  const rootPath = await getMonorepoRootViaDirectoryScan(process.cwd());
  return rootPath;
});

const turboPath = () => modulesBinPath("turbo");
async function runTurboTasksForSinglePackage(opts) {
  const rootDir = opts.packageDir ?? process.cwd();
  const cwd = await monorepoRootPath();
  return await spawnOutputConditional(turboPath(), [
    "run",
    ...opts.tasks,
    "--filter=" + rootDir.replace(cwd, "."),
    "--output-logs=new-only"
  ], {
    ...opts.spawnOpts,
    cwd
  });
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

export { loadAndRunGlobalHook };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9hZEFuZFJ1bkdsb2JhbEhvb2suZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWxzL29uY2UudHMiLCIuLi8uLi9zcmMvbG9nZ2VyL2xvZ2dlci50cyIsIi4uLy4uL3NyYy91dGlscy9zdGFja1RyYWNlLnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25Ub1Byb21pc2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdC50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduT3V0cHV0LnRzIiwiLi4vLi4vc3JjL3V0aWxzL29uY2VBc3luYy50cyIsIi4uLy4uL3NyYy9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uLnRzIiwiLi4vLi4vc3JjL3V0aWxzL21vZHVsZVJvb3REaXJlY3RvcnkudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9kdWxlc0JpblBhdGgudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNUcnV0aHkudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9ub3JlcG9Sb290UGF0aC50cyIsIi4uLy4uL3NyYy90dXJiby50cyIsIi4uLy4uL3NyYy9qZXN0L2xvYWRBbmRSdW5HbG9iYWxIb29rLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBvbmNlPFQ+KGZuOiAoKSA9PiBUKTogKCkgPT4gVCB7XG4gIGxldCB2YWx1ZTogVDtcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcbiAgcmV0dXJuICgpOiBUID0+IHtcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICB2YWx1ZSA9IGZuKCk7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xufVxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJy4uL3V0aWxzL29uY2UnO1xuXG5jb25zdCBsZXZlbHMgPSBbJ2RlYnVnJywgJ2luZm8nLCAnd2FybicsICdlcnJvcicsICdmYXRhbCddIGFzIGNvbnN0O1xuXG50eXBlIExvZ0xldmVsID0gdHlwZW9mIGxldmVsc1tudW1iZXJdO1xuXG50eXBlIFBhcmFtcyA9IFBhcmFtZXRlcnM8dHlwZW9mIGNvbnNvbGUubG9nPjtcblxudHlwZSBMb2dnZXIgPSB7XG4gIGxvZ0xldmVsOiBMb2dMZXZlbDtcbiAgZGVidWcoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgLy8gYWxpYXMgZm9yIGluZm9cbiAgbG9nKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgLy8gc3BlY2lhbCB0cmVhdG1lbnQsIGRpc2FibGVkIG9uIENJL1RUWVxuICB0aXAoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgZXJyb3IoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBmYXRhbCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG59O1xuXG5jb25zdCBlbmFibGVkTGV2ZWxzQWZ0ZXIgPSAobGV2ZWw6IExvZ0xldmVsIHwgJ29mZicpID0+IHtcbiAgaWYgKGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuICBjb25zdCBpbmRleCA9IGxldmVscy5maW5kSW5kZXgoKGl0ZW0pID0+IGl0ZW0gPT09IGxldmVsKTtcbiAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBsZXZlbCcpO1xuICB9XG4gIHJldHVybiBsZXZlbHMuc2xpY2UoaW5kZXgpO1xufTtcblxuY29uc3QgaXNMZXZlbCA9IChsZXZlbD86IHN0cmluZyk6IGxldmVsIGlzIExvZ0xldmVsID0+IHtcbiAgcmV0dXJuIGxldmVscy5pbmNsdWRlcyhsZXZlbCBhcyBMb2dMZXZlbCk7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlGcm9tUHJvY2Vzc0FyZ3MgPSAoXG4gIGFyZ3MgPSBwcm9jZXNzLmFyZ3Zcbik6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xuICBjb25zdCBpbmRleCA9IGFyZ3MuZmluZEluZGV4KCh2YWx1ZSkgPT4gdmFsdWUgPT09ICctLWxvZy1sZXZlbCcpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBjb25zdCBsZXZlbCA9IGFyZ3NbaW5kZXggKyAxXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgdmVyYm9zaXR5RnJvbUVudiA9ICgpOiBMb2dMZXZlbCB8ICdvZmYnIHwgdW5kZWZpbmVkID0+IHtcbiAgY29uc3QgbGV2ZWwgPSBwcm9jZXNzLmVudlsnTE9HX0xFVkVMJ107XG4gIGlmIChsZXZlbCA9PT0gJ3NpbGVudCcgfHwgbGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuICdvZmYnO1xuICB9XG4gIGlmICghaXNMZXZlbChsZXZlbCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBsZXZlbDtcbn07XG5cbmNvbnN0IGdldFZlcmJvc2l0eUNvbmZpZyA9ICgpID0+IHtcbiAgY29uc3QgYXJnc0xldmVsID0gdmVyYm9zaXR5RnJvbVByb2Nlc3NBcmdzKCk7XG4gIGNvbnN0IGVudkxldmVsID0gdmVyYm9zaXR5RnJvbUVudigpO1xuICByZXR1cm4gYXJnc0xldmVsID8/IGVudkxldmVsID8/ICdpbmZvJztcbn07XG5cbmNvbnN0IG5vb3AgPSAoLi4uX2FyZ3M6IFBhcmFtcykgPT4ge1xuICByZXR1cm47XG59O1xuXG5jb25zdCBsb2cgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XG4gIGNvbnNvbGUubG9nKC4uLmFyZ3MpO1xufTtcblxuY29uc3QgZXJyb3IgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XG4gIGNvbnNvbGUuZXJyb3IoLi4uYXJncyk7XG59O1xuXG5jb25zdCBzaG91bGRFbmFibGVUaXAgPSAoKSA9PiAhcHJvY2Vzcy5lbnZbJ0NJJ10gJiYgIXByb2Nlc3Muc3Rkb3V0LmlzVFRZO1xuXG5leHBvcnQgY29uc3QgY3JlYXRlTG9nZ2VyID0gKFxuICBkZXBzID0geyBnZXRWZXJib3NpdHlDb25maWcsIGxvZywgZXJyb3IsIHNob3VsZEVuYWJsZVRpcCB9XG4pID0+IHtcbiAgY29uc3QgbG9nTGV2ZWwgPSBkZXBzLmdldFZlcmJvc2l0eUNvbmZpZygpO1xuICBjb25zdCBlbmFibGVkID0gZW5hYmxlZExldmVsc0FmdGVyKGxvZ0xldmVsKTtcbiAgcmV0dXJuIGxldmVscy5yZWR1Y2UoXG4gICAgKGFjYywgbHZsKSA9PiB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5hY2MsXG4gICAgICAgIFtsdmxdOiBlbmFibGVkLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICA/IFsnZmF0YWwnLCAnZXJyb3InXS5pbmNsdWRlcyhsdmwpXG4gICAgICAgICAgICA/IGRlcHMuZXJyb3JcbiAgICAgICAgICAgIDogZGVwcy5sb2dcbiAgICAgICAgICA6IG5vb3AsXG4gICAgICB9O1xuICAgIH0sXG4gICAge1xuICAgICAgbG9nTGV2ZWwsXG4gICAgICBsb2c6IGVuYWJsZWQuaW5jbHVkZXMoJ2luZm8nKSA/IGRlcHMubG9nIDogbm9vcCxcbiAgICAgIHRpcDogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpICYmIGRlcHMuc2hvdWxkRW5hYmxlVGlwKCkgPyBkZXBzLmxvZyA6IG5vb3AsXG4gICAgfSBhcyBMb2dnZXJcbiAgKTtcbn07XG5cbmNvbnN0IGNyZWF0ZURlbGVnYXRpbmdMb2dnZXIgPSAob3B0czogeyBwYXJlbnQ6IExvZ2dlciB9KTogTG9nZ2VyID0+XG4gIE9iamVjdC5mcmVlemUoe1xuICAgIGdldCBsb2dMZXZlbCgpIHtcbiAgICAgIHJldHVybiBvcHRzLnBhcmVudC5sb2dMZXZlbDtcbiAgICB9LFxuICAgIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5kZWJ1ZyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgaW5mbyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuaW5mbyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgbG9nKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5sb2coLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQudGlwKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC53YXJuKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuZXJyb3IoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5mYXRhbCguLi5wYXJhbXMpO1xuICAgIH0sXG4gIH0pO1xuXG5sZXQgZGVmYXVsdExvZ2dlckZhY3Rvcnk6ICgoKSA9PiBMb2dnZXIpIHwgbnVsbDtcblxuZXhwb3J0IGNvbnN0IGNvbmZpZ3VyZURlZmF1bHRMb2dnZXIgPSAoZmFjdG9yeTogKCkgPT4gTG9nZ2VyKSA9PiB7XG4gIGlmIChkZWZhdWx0TG9nZ2VyRmFjdG9yeSkge1xuICAgIGNvbnN0IGVycm9yID0ge1xuICAgICAgc3RhY2s6ICcnLFxuICAgIH07XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UoZXJyb3IpO1xuICAgIGxvZ2dlci5kZWJ1ZygnQ2Fubm90IG92ZXJyaWRlIGRlZmF1bHQgbG9nZ2VyIG11bHRpcGxlIHRpbWVzJywgZXJyb3Iuc3RhY2spO1xuICAgIHJldHVybjtcbiAgfVxuICBkZWZhdWx0TG9nZ2VyRmFjdG9yeSA9IGZhY3Rvcnk7XG59O1xuXG5jb25zdCBkZWZhdWx0TG9nZ2VyID0gb25jZSgoKSA9PiB7XG4gIGxldCBmYWN0b3J5ID0gZGVmYXVsdExvZ2dlckZhY3Rvcnk7XG4gIGlmICghZmFjdG9yeSkge1xuICAgIGZhY3RvcnkgPSAoKSA9PiBjcmVhdGVMb2dnZXIoKTtcbiAgfVxuICByZXR1cm4gZmFjdG9yeSgpO1xufSk7XG5cbi8qKlxuICogRGVmYXVsdCBsb2dnZXIgaW5zdGFuY2UgY2FuIGJlIGNvbmZpZ3VyZWQgb25jZSBhdCBzdGFydHVwXG4gKi9cbmV4cG9ydCBjb25zdCBsb2dnZXI6IExvZ2dlciA9IGNyZWF0ZURlbGVnYXRpbmdMb2dnZXIoe1xuICBnZXQgcGFyZW50KCkge1xuICAgIHJldHVybiBkZWZhdWx0TG9nZ2VyKCk7XG4gIH0sXG59KTtcbiIsIi8qKlxuICogQ2FwdHVyZSB0aGUgc3RhY2sgdHJhY2UgYW5kIGFsbG93IHRvIGVucmljaCBleGNlcHRpb25zIHRocm93biBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2tzXG4gKiB3aXRoIGFkZGl0aW9uYWwgc3RhY2sgaW5mb3JtYXRpb24gY2FwdHVyZWQgYXQgdGhlIG1vbWVudCBvZiB0aGUgY2FsbCBvZiB0aGlzIGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYXB0dXJlU3RhY2tUcmFjZShyZW1vdmUgPSAwKSB7XG4gIGNvbnN0IHN0YWNrQ29udGFpbmVyID0ge1xuICAgIHN0YWNrOiAnJyxcbiAgfTtcbiAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2Uoc3RhY2tDb250YWluZXIpO1xuICBjb25zdCBzdGFja1RyYWNlID0gc3RhY2tDb250YWluZXIuc3RhY2tcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLnNsaWNlKDYgKyByZW1vdmUpXG4gICAgLmpvaW4oJ1xcbicpO1xuICByZXR1cm4ge1xuICAgIC8qKlxuICAgICAqIENhcHR1cmVkIHN0YWNrIHRyYWNlIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgc3RhY2tUcmFjZSxcbiAgICAvKipcbiAgICAgKiBDYW4gYmUgY2FsbGVkIGluIGFzeW5jaHJvbm91cyBjYWxsYmFjayB0byBlbnJpY2ggZXhjZXB0aW9ucyB3aXRoIGFkZGl0aW9uYWwgaW5mb3JtYXRpb25cbiAgICAgKiBAcGFyYW0gZXJyIEV4Y2VwdGlvbiB0byBlbnJpY2ggLSBpdCBpcyBnb2luZyB0byBoYXZlIGl0cyBgLnN0YWNrYCBwcm9wIG11dGF0ZWRcbiAgICAgKiBAcmV0dXJucyBTYW1lIGV4Y2VwdGlvblxuICAgICAqL1xuICAgIHByZXBhcmVGb3JSZXRocm93OiAoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgY29uc3Qgb2xkU3RhY2tUcmFjZSA9IGVyci5zdGFjayA/PyAnJy5zcGxpdCgnXFxuJykuc2xpY2UoMSkuam9pbignXFxuJyk7XG4gICAgICBlcnIuc3RhY2sgPSBgJHtlcnIubmFtZSB8fCAnRXJyb3InfTogJHtcbiAgICAgICAgZXJyLm1lc3NhZ2VcbiAgICAgIH1cXG4ke29sZFN0YWNrVHJhY2V9XFxuJHtzdGFja1RyYWNlfWA7XG4gICAgICByZXR1cm4gZXJyO1xuICAgIH0sXG4gIH07XG59XG4iLCJpbXBvcnQgdHlwZSB7IFNwYXduT3B0aW9ucyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgQ2hpbGRQcm9jZXNzIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHR5cGUgeyBBc3NpZ24gfSBmcm9tICd1dGlsaXR5LXR5cGVzJztcblxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBjYXB0dXJlU3RhY2tUcmFjZSB9IGZyb20gJy4uL3V0aWxzL3N0YWNrVHJhY2UnO1xuXG5leHBvcnQgdHlwZSBTcGF3blRvUHJvbWlzZU9wdHMgPSB7XG4gIC8qKlxuICAgKiBTcGVjaWZ5IGV4aXQgY29kZXMgd2hpY2ggc2hvdWxkIG5vdCByZXN1bHQgaW4gdGhyb3dpbmcgYW4gZXJyb3Igd2hlblxuICAgKiB0aGUgcHJvY2VzcyBoYXMgZmluaXNoZWQsIGUuZy4gc3BlY2lmeWluZyBgWzBdYCBtZWFucyBpZiBwcm9jZXNzIGZpbmlzaGVkXG4gICAqIHdpdGggemVybyBleGl0IGNvZGUgdGhlbiB0aGUgcHJvbWlzZSB3aWxsIHJlc29sdmUgaW5zdGVhZCBvZiByZWplY3RpbmcuXG4gICAqXG4gICAqIEFsdGVybmF0aXZlbHksIHNwZWNpZnkgYGluaGVyaXRgIHRvIHNhdmUgc3RhdHVzIGNvZGUgdG8gdGhlIGN1cnJlbnQgYHByb2Nlc3MuZXhpdENvZGVgXG4gICAqXG4gICAqIEFsdGVybmF0aXZlbHksIGNvbXBsZXRlbHkgaWdub3JlIHRoZSBleGl0IGNvZGUgKGUuZy4geW91IGZvbGxvdyB1cCBhbmQgaW50ZXJyb2dhdGVcbiAgICogdGhlIHByb2Nlc3MgY29kZSBtYW51YWxseSBhZnRlcndhcmRzKVxuICAgKi9cbiAgZXhpdENvZGVzOiBudW1iZXJbXSB8ICdpbmhlcml0JyB8ICdhbnknO1xufTtcblxudHlwZSBTaGFyZWRPcHRzID0gUGljazxTcGF3bk9wdGlvbnMsICdjd2QnPjtcblxudHlwZSBTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4gPSBbXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgYXJnczogUmVhZG9ubHlBcnJheTxzdHJpbmc+LFxuICBvcHRpb25zOiBBc3NpZ248U3Bhd25PcHRpb25zLCBFPlxuXTtcblxuZXhwb3J0IHR5cGUgU3Bhd25PcHRpb25zV2l0aEV4dHJhPEUgZXh0ZW5kcyBvYmplY3QgPSBTcGF3blRvUHJvbWlzZU9wdHM+ID1cbiAgQXNzaWduPFNwYXduT3B0aW9ucywgRT47XG5cbmV4cG9ydCB0eXBlIFNwYXduUGFyYW1ldGVyTWl4PEUgZXh0ZW5kcyBvYmplY3QgPSBTcGF3blRvUHJvbWlzZU9wdHM+ID1cbiAgfCBbY3A6IENoaWxkUHJvY2VzcywgZXh0cmFPcHRzOiBBc3NpZ248RSwgU2hhcmVkT3B0cz5dXG4gIHwgU3Bhd25BcmdzPEU+O1xuXG5leHBvcnQgZnVuY3Rpb24gaXNTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4oXG4gIGFyZ3M6IFNwYXduUGFyYW1ldGVyTWl4PEU+XG4pOiBhcmdzIGlzIFNwYXduQXJnczxFPiB7XG4gIHJldHVybiAhKGFyZ3NbMF0gaW5zdGFuY2VvZiBDaGlsZFByb2Nlc3MpICYmIHR5cGVvZiBhcmdzWzBdID09PSAnc3RyaW5nJztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNwYXduV2l0aFNwYXduUGFyYW1ldGVyczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgcGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbikge1xuICBjb25zdCBbY2hpbGQsIFtjb21tYW5kLCBhcmdzLCBvcHRzXV0gPSBpc1NwYXduQXJncyhwYXJhbWV0ZXJzKVxuICAgID8gW1xuICAgICAgICBzcGF3biguLi4ocGFyYW1ldGVycyBhcyB1bmtub3duIGFzIFBhcmFtZXRlcnM8dHlwZW9mIHNwYXduPikpLFxuICAgICAgICBwYXJhbWV0ZXJzLFxuICAgICAgXVxuICAgIDogW1xuICAgICAgICBwYXJhbWV0ZXJzWzBdLFxuICAgICAgICBbXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmZpbGUsXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmFyZ3Muc2xpY2UoMSksXG4gICAgICAgICAgcGFyYW1ldGVyc1sxXSBhcyBBc3NpZ248U3Bhd25PcHRpb25zLCBFPixcbiAgICAgICAgXSxcbiAgICAgIF07XG4gIHJldHVybiB7XG4gICAgY2hpbGQsXG4gICAgY29tbWFuZCxcbiAgICBhcmdzLFxuICAgIG9wdHMsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blRvUHJvbWlzZShcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXhcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB7IGNoaWxkLCBjb21tYW5kLCBhcmdzLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHsgcHJlcGFyZUZvclJldGhyb3cgfSA9IGNhcHR1cmVTdGFja1RyYWNlKCk7XG5cbiAgY29uc3QgZXhpdENvZGVzID0gb3B0cy5leGl0Q29kZXM7XG5cbiAgY29uc3QgY3dkID0gb3B0cy5jd2QgPyBvcHRzLmN3ZC50b1N0cmluZygpIDogdW5kZWZpbmVkO1xuXG4gIGNvbnN0IGNtZCA9ICgpID0+IFtjb21tYW5kLCAuLi5hcmdzXS5qb2luKCcgJyk7XG5cbiAgbG9nZ2VyLmRlYnVnKFsnPicsIGNtZCgpXS5qb2luKCcgJyksIC4uLihjd2QgPyBbYGluICR7Y3dkfWBdIDogW10pKTtcblxuICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzLCByZWopID0+XG4gICAgY2hpbGRcbiAgICAgIC5vbignY2xvc2UnLCAoY29kZSwgc2lnbmFsKSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgY29kZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdpbmhlcml0JyAmJlxuICAgICAgICAgICAgZXhpdENvZGVzICE9PSAnYW55JyAmJlxuICAgICAgICAgICAgIWV4aXRDb2Rlcy5pbmNsdWRlcyhjb2RlKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgcmVqKFxuICAgICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgICBuZXcgRXJyb3IoYENvbW1hbmQgXCIke2NtZCgpfVwiIGhhcyBmYWlsZWQgd2l0aCBjb2RlICR7Y29kZX1gKVxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoc2lnbmFsKSB7XG4gICAgICAgICAgcmVqKFxuICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3coXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihgRmFpbGVkIHRvIGV4ZWN1dGUgY29tbWFuZCBcIiR7Y21kKCl9XCIgLSAke3NpZ25hbH1gKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgcHJlcGFyZUZvclJldGhyb3cobmV3IEVycm9yKCdFeHBlY3RlZCBzaWduYWwgb3IgZXJyb3IgY29kZScpKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5vbignZXJyb3InLCByZWopXG4gICk7XG4gIC8vIGluaGVyaXQgZXhpdCBjb2RlXG4gIGlmIChleGl0Q29kZXMgPT09ICdpbmhlcml0Jykge1xuICAgIGlmIChcbiAgICAgIHR5cGVvZiBjaGlsZC5leGl0Q29kZSA9PT0gJ251bWJlcicgJiZcbiAgICAgICh0eXBlb2YgcHJvY2Vzcy5leGl0Q29kZSAhPT0gJ251bWJlcicgfHwgcHJvY2Vzcy5leGl0Q29kZSA9PT0gMClcbiAgICApIHtcbiAgICAgIHByb2Nlc3MuZXhpdENvZGUgPSBjaGlsZC5leGl0Q29kZTtcbiAgICB9XG4gIH1cbn1cbiIsImltcG9ydCBhc3NlcnQgZnJvbSAnYXNzZXJ0JztcblxuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCwgU3Bhd25Ub1Byb21pc2VPcHRzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5pbXBvcnQgeyBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduVG9Qcm9taXNlIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0T3B0cyA9IHtcbiAgb3V0cHV0PzogWydzdGRvdXQnIHwgJ3N0ZGVycicsIC4uLkFycmF5PCdzdGRvdXQnIHwgJ3N0ZGVycic+XTtcbn0gJiBTcGF3blRvUHJvbWlzZU9wdHM7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0UmV0dXJuID0ge1xuICBwaWQ/OiBudW1iZXI7XG4gIG91dHB1dDogc3RyaW5nW107XG4gIHN0ZG91dDogc3RyaW5nO1xuICBzdGRlcnI6IHN0cmluZztcbiAgc3RhdHVzOiBudW1iZXIgfCBudWxsO1xuICBzaWduYWw6IE5vZGVKUy5TaWduYWxzIHwgbnVsbDtcbiAgZXJyb3I/OiBFcnJvciB8IHVuZGVmaW5lZDtcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blJlc3VsdChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxTcGF3blJlc3VsdFJldHVybj4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IGNvbWJpbmVkRGF0YTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc3Rkb3V0RGF0YTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc3RkZXJyRGF0YTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgb3V0cHV0ID0gb3B0cy5vdXRwdXQgPz8gWydzdGRvdXQnLCAnc3RkZXJyJ107XG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZG91dCcpKSB7XG4gICAgYXNzZXJ0KFxuICAgICAgISFjaGlsZC5zdGRvdXQsXG4gICAgICAnRXhwZWN0ZWQgXCIuc3Rkb3V0XCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xuICAgICk7XG4gICAgY2hpbGQuc3Rkb3V0LnNldEVuY29kaW5nKCd1dGYtOCcpO1xuICAgIGNoaWxkLnN0ZG91dC5vbignZGF0YScsIChkYXRhOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbWJpbmVkRGF0YS5wdXNoKGRhdGEpO1xuICAgICAgc3Rkb3V0RGF0YS5wdXNoKGRhdGEpO1xuICAgIH0pO1xuICB9XG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZGVycicpKSB7XG4gICAgYXNzZXJ0KFxuICAgICAgISFjaGlsZC5zdGRlcnIsXG4gICAgICAnRXhwZWN0ZWQgXCIuc3RkZXJyXCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xuICAgICk7XG4gICAgY2hpbGQuc3RkZXJyLnNldEVuY29kaW5nKCd1dGYtOCcpO1xuICAgIGNoaWxkLnN0ZGVyci5vbignZGF0YScsIChkYXRhOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbWJpbmVkRGF0YS5wdXNoKGRhdGEpO1xuICAgICAgc3RkZXJyRGF0YS5wdXNoKGRhdGEpO1xuICAgIH0pO1xuICB9XG4gIGNvbnN0IFtyZXN1bHRdID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFtzcGF3blRvUHJvbWlzZShjaGlsZCwgb3B0cyldKTtcbiAgcmV0dXJuIHtcbiAgICBwaWQ6IGNoaWxkLnBpZCxcbiAgICBzaWduYWw6IGNoaWxkLnNpZ25hbENvZGUsXG4gICAgc3RhdHVzOiBjaGlsZC5leGl0Q29kZSxcbiAgICBnZXQgb3V0cHV0KCkge1xuICAgICAgcmV0dXJuIGNvbWJpbmVkRGF0YTtcbiAgICB9LFxuICAgIGdldCBzdGRlcnIoKSB7XG4gICAgICByZXR1cm4gc3RkZXJyRGF0YS5qb2luKCcnKTtcbiAgICB9LFxuICAgIGdldCBzdGRvdXQoKSB7XG4gICAgICByZXR1cm4gc3Rkb3V0RGF0YS5qb2luKCcnKTtcbiAgICB9LFxuICAgIGdldCBlcnJvcigpIHtcbiAgICAgIHJldHVybiByZXN1bHQuc3RhdHVzID09PSAncmVqZWN0ZWQnXG4gICAgICAgID8gKHJlc3VsdC5yZWFzb24gYXMgRXJyb3IpXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIH0sXG4gIH07XG59XG4iLCJpbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB0eXBlIHsgU3Bhd25SZXN1bHRPcHRzLCBTcGF3blJlc3VsdFJldHVybiB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHsgc3Bhd25SZXN1bHQgfSBmcm9tICcuL3NwYXduUmVzdWx0JztcbmltcG9ydCB0eXBlIHsgU3Bhd25QYXJhbWV0ZXJNaXggfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25PdXRwdXQoXG4gIC4uLnBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4PFNwYXduUmVzdWx0T3B0cz5cbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHsgY2hpbGQsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc3Bhd25SZXN1bHQoY2hpbGQsIG9wdHMpO1xuICByZXR1cm4gcmVzdWx0Lm91dHB1dC5qb2luKCcnKTtcbn1cblxuY29uc3QgZGVmYXVsdFNob3VsZE91dHB1dCA9IChyZXN1bHQ6IFNwYXduUmVzdWx0UmV0dXJuKSA9PiB7XG4gIHJldHVybiByZXN1bHQuZXJyb3IgfHwgcmVzdWx0LnN0YXR1cyAhPT0gMCB8fCBsb2dnZXIubG9nTGV2ZWwgPT09ICdkZWJ1Zyc7XG59O1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25PdXRwdXRDb25kaXRpb25hbChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8XG4gICAgU3Bhd25SZXN1bHRPcHRzICYge1xuICAgICAgLyoqXG4gICAgICAgKiBCeSBkZWZhdWx0IHdpbGwgb3V0cHV0IHRvIGBzdGRlcnJgIHdoZW4gc3Bhd24gcmVzdWx0IGZhaWxlZCB3aXRoIGFuIGVycm9yLCB3aGVuXG4gICAgICAgKiBzdGF0dXMgY29kZSBpcyBub3QgemVybyBvciB3aGVuIGBMb2dnZXIubG9nTGV2ZWxgIGlzIGBkZWJ1Z2BcbiAgICAgICAqL1xuICAgICAgc2hvdWxkT3V0cHV0PzogKHJlc3VsdDogU3Bhd25SZXN1bHRSZXR1cm4pID0+IGJvb2xlYW47XG4gICAgfVxuICA+XG4pIHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwgb3B0cyk7XG4gIGNvbnN0IHNob3VsZE91dHB1dCA9IG9wdHMuc2hvdWxkT3V0cHV0ID8/IGRlZmF1bHRTaG91bGRPdXRwdXQ7XG4gIGlmIChzaG91bGRPdXRwdXQocmVzdWx0KSkge1xuICAgIGxvZ2dlci5lcnJvcihyZXN1bHQub3V0cHV0LmpvaW4oJycpKTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZUFzeW5jPFQ+KGZuOiAoKSA9PiBUIHwgUHJvbWlzZTxUPik6ICgpID0+IFByb21pc2U8VD4ge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBpbkZsaWdodDogUHJvbWlzZTxUPiB8IG51bGw7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiBhc3luYyAoKTogUHJvbWlzZTxUPiA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKGluRmxpZ2h0KSB7XG4gICAgICByZXR1cm4gaW5GbGlnaHQ7XG4gICAgfVxuICAgIGluRmxpZ2h0ID0gUHJvbWlzZS5yZXNvbHZlKGZuKCkpO1xuICAgIHZhbHVlID0gYXdhaXQgaW5GbGlnaHQ7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgaW5GbGlnaHQgPSBudWxsO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnLi4vdXRpbHMvb25jZUFzeW5jJztcbmltcG9ydCB0eXBlIHsgUGFja2FnZUpzb24gfSBmcm9tICcuL3BhY2thZ2VKc29uJztcblxuY29uc3QgY3dkUGFja2FnZUpzb25QYXRoID0gKCkgPT4gam9pbihwcm9jZXNzLmN3ZCgpLCAnLi9wYWNrYWdlLmpzb24nKTtcblxuYXN5bmMgZnVuY3Rpb24gcmVhZFBhY2thZ2VKc29uQXQocGF0aDogc3RyaW5nKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xuICByZXR1cm4gYXdhaXQgcmVhZEZpbGUocGF0aCwgJ3V0Zi04JykudGhlbihcbiAgICAocmVzdWx0KSA9PiBKU09OLnBhcnNlKHJlc3VsdCkgYXMgUGFja2FnZUpzb25cbiAgKTtcbn1cblxuZXhwb3J0IGNvbnN0IHJlYWRDd2RQYWNrYWdlSnNvbiA9IG9uY2VBc3luYygoKSA9PlxuICByZWFkUGFja2FnZUpzb25BdChjd2RQYWNrYWdlSnNvblBhdGgoKSlcbik7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb24ocGF0aDogc3RyaW5nKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xuICAvLyBhc3N1bWluZyBjdXJyZW50IGRpcmVjdG9yeSBkb2Vzbid0IGNoYW5nZSB3aGlsZSBhcHAgaXMgcnVubmluZ1xuICByZXR1cm4gcHJvY2Vzcy5jd2QoKSA9PT0gY3dkUGFja2FnZUpzb25QYXRoKClcbiAgICA/IGF3YWl0IHJlYWRDd2RQYWNrYWdlSnNvbigpXG4gICAgOiBhd2FpdCByZWFkUGFja2FnZUpzb25BdChwYXRoKTtcbn1cbiIsImltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcblxuaW1wb3J0IHsgb25jZSB9IGZyb20gJy4vb25jZSc7XG5cbmV4cG9ydCBjb25zdCBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCA9IChvcHRzOiB7XG4gIGltcG9ydE1ldGFVcmw6IHN0cmluZztcbn0pID0+IHtcbiAgLy8gdGhpcyBpcyBoaWdobHkgZGVwZW5kZW50IG9uIHRoZSBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZVxuICAvLyBhbmQgdGhlIGNvbnRleHQgaW4gd2hpY2ggdGhpcyBmdW5jdGlvbiBpcyBydW4gKGJ1bmRsZWQgY29kZSB2cyB0c3ggLi9zcmMvdHNmaWxlLnRzKVxuICBjb25zdCBfX2ZpbGVOYW1lID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICBjb25zdCBwYXJlbnQgPSBkaXJuYW1lKF9fZmlsZU5hbWUpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IGRpcm5hbWUocGFyZW50KTtcblxuICBjb25zdCBpc0J1bmRsZWRJbkRpc3QgPSAoKSA9PiBwYXJlbnQuZW5kc1dpdGgoJy9kaXN0Jyk7XG4gIGNvbnN0IGlzQnVuZGxlZEluQmluID0gKCkgPT5cbiAgICBwYXJlbnQuZW5kc1dpdGgoJy9iaW4nKSAmJiAhc3VwZXJQYXJlbnQuZW5kc1dpdGgoJy9zcmMnKTtcblxuICBpZiAoaXNCdW5kbGVkSW5EaXN0KCkgfHwgaXNCdW5kbGVkSW5CaW4oKSkge1xuICAgIHJldHVybiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICB9XG5cbiAgLy8gcnVuIHZpYSB0c3ggdG8gYnVpbGQgdGhlIEByZXBrYS1raXQvdHMgaXRzZWxmXG4gIHJldHVybiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uLy4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpO1xufTtcblxuZXhwb3J0IGNvbnN0IG1vZHVsZVJvb3REaXJlY3RvcnkgPSBvbmNlKCgpID0+XG4gIGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsKHsgaW1wb3J0TWV0YVVybDogaW1wb3J0Lm1ldGEudXJsIH0pXG4pO1xuIiwiaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuL21vZHVsZVJvb3REaXJlY3RvcnknO1xuXG5leHBvcnQgZnVuY3Rpb24gbW9kdWxlc0JpblBhdGgoYmluOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGpvaW4obW9kdWxlUm9vdERpcmVjdG9yeSgpLCBgLi9ub2RlX21vZHVsZXMvLmJpbi8ke2Jpbn1gKTtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBpc1RydXRoeTxUPihcbiAgdmFsdWU6IE5vbk51bGxhYmxlPFQ+IHwgZmFsc2UgfCBudWxsIHwgdW5kZWZpbmVkIHwgJycgfCAwXG4pOiB2YWx1ZSBpcyBOb25OdWxsYWJsZTxUPiB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlKTtcbn1cbiIsImltcG9ydCBhc3NlcnQgZnJvbSAnYXNzZXJ0JztcbmltcG9ydCBmZyBmcm9tICdmYXN0LWdsb2InO1xuaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgeyBpc1RydXRoeSB9IGZyb20gJy4vaXNUcnV0aHknO1xuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnLi9vbmNlQXN5bmMnO1xuXG5jb25zdCBnZXRNb25vcmVwb1Jvb3RTY2FuQ2FuZGlkYXRlcyA9IChjdXJyZW50RGlyZWN0b3J5OiBzdHJpbmcpID0+IHtcbiAgLy8gaGF2aW5nICdwYWNrYWdlcy8qJyBpbiB0aGUgcm9vdCBvZiBhIG1vbm9yZXBvIGlzIHN1cGVyIGNvbW1vblxuICBjb25zdCByZXN1bHQgPSAvKC4qKD89XFwvcGFja2FnZXNcXC8pKXwoLiooPz1cXC9ub2RlX21vZHVsZXNcXC8pKXwoLiopLy5leGVjKFxuICAgIGN1cnJlbnREaXJlY3RvcnlcbiAgKTtcbiAgYXNzZXJ0KCEhcmVzdWx0KTtcbiAgY29uc3QgWywgcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdID0gcmVzdWx0O1xuICByZXR1cm4gW3BhY2thZ2VzUm9vdCwgbm9kZU1vZHVsZXNSb290XS5maWx0ZXIoaXNUcnV0aHkpO1xufTtcblxuLy8gcmV0dXJucyB0aGUgZmlyc3QgZGlyZWN0b3J5IHdoaWNoIGhhcyBtb25vcmVwbyBtYXJrZXJzLCBtdWx0aXBsZVxuLy8gZGlyZWN0b3JpZXMgY2FuIGhhdmUgdGhlbSAtIHdoaWNoZXZlciByZWFkIGZpcnN0IHdpbGwgYmUgcmV0dXJuZWRcbi8vIHNvIGlmIG9yZGVyIGlzIGltcG9ydGFudCAtIHNjYW5uaW5nIHNob3VsZCBiZSBzZXBhcmF0ZWQgdG8gbXVsdGlwbGUgam9ic1xuLy8gdmlhIHByaW9yaXRpemVkSGFzTW9ub3JlcG9NYXJrZXJzXG5jb25zdCBoYXNNb25vcmVwb01hcmtlcnMgPSBhc3luYyAoY2FuZGlkYXRlczogc3RyaW5nW10pID0+IHtcbiAgY29uc3QgbWFya2VycyA9IFtcbiAgICAnLmdpdCcsXG4gICAgJ3lhcm4ubG9jaycsXG4gICAgJ3BucG0tbG9jay55YW1sJyxcbiAgICAncGFja2FnZS1sb2NrLmpzb24nLFxuICAgICdwbnBtLXdvcmtzcGFjZS55YW1sJyxcbiAgXTtcbiAgY29uc3QgbWFya2Vyc1N0cmVhbSA9IGZnLnN0cmVhbShcbiAgICBjYW5kaWRhdGVzLmZsYXRNYXAoKGRpcikgPT4gbWFya2Vycy5tYXAoKG1hcmtlcikgPT4gam9pbihkaXIsIG1hcmtlcikpKSxcbiAgICB7XG4gICAgICBtYXJrRGlyZWN0b3JpZXM6IHRydWUsXG4gICAgICBvbmx5RmlsZXM6IGZhbHNlLFxuICAgIH1cbiAgKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4oKHJlcykgPT4ge1xuICAgIG1hcmtlcnNTdHJlYW0ub24oJ2RhdGEnLCAoZW50cnk6IHN0cmluZykgPT4ge1xuICAgICAgcmVzKGRpcm5hbWUoZW50cnkpKTtcbiAgICAgIGlmICgnZGVzdHJveScgaW4gbWFya2Vyc1N0cmVhbSkge1xuICAgICAgICAobWFya2Vyc1N0cmVhbSBhcyB1bmtub3duIGFzIHsgZGVzdHJveTogKCkgPT4gdm9pZCB9KS5kZXN0cm95KCk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgbWFya2Vyc1N0cmVhbS5vbignZW5kJywgKCkgPT4ge1xuICAgICAgcmVzKHVuZGVmaW5lZCk7XG4gICAgfSk7XG4gIH0pO1xufTtcblxuY29uc3QgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnMgPSAoam9iczogc3RyaW5nW11bXSkgPT4ge1xuICBpZiAoam9icy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gIH1cbiAgcmV0dXJuIG5ldyBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4oKHJlcykgPT4ge1xuICAgIGNvbnN0IHJlc3VsdHMgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nIHwgdW5kZWZpbmVkPigpO1xuXG4gICAgY29uc3QgY2hlY2tTaG91bGRDb21wbGV0ZSA9IChpbmRleDogbnVtYmVyLCByZXN1bHQ6IHN0cmluZyB8IHVuZGVmaW5lZCkgPT4ge1xuICAgICAgcmVzdWx0cy5zZXQoaW5kZXgsIHJlc3VsdCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGpvYnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3QgaGFzUmVzdWx0ID0gcmVzdWx0cy5oYXMoaSk7XG4gICAgICAgIGlmICghaGFzUmVzdWx0KSB7XG4gICAgICAgICAgLy8gaWYgYSBqb2Igd2l0aCBoaWdoZXN0IHByaW9yaXR5IGhhc24ndCBmaW5pc2hlZCB5ZXRcbiAgICAgICAgICAvLyB0aGVuIHdhaXQgZm9yIGl0XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzdWx0cy5nZXQoaSk7XG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAvLyBqb2IgZmluaXNoZWQgYW5kIHdlIGZvdW5kIG1hcmtlcnMsIGFsc28gYWxsIGpvYnNcbiAgICAgICAgICAvLyB3aXRoIGhpZ2hlciBwcmlvcml0eSBmaW5pc2hlZCBhbmQgdGhleSBkb24ndCBoYXZlXG4gICAgICAgICAgLy8gYW55IG1hcmtlcnMgLSB3ZSBhcmUgZG9uZVxuICAgICAgICAgIHJlcyhyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0cy5zaXplID09PSBqb2JzLmxlbmd0aCkge1xuICAgICAgICAvLyBhbGwgam9icyBmaW5pc2hlZCAtIG5vIG1hcmtlcnMgZm91bmRcbiAgICAgICAgcmVzKHVuZGVmaW5lZCk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGpvYnMuZm9yRWFjaCgoZGlyZWN0b3JpZXMsIGluZGV4KSA9PiB7XG4gICAgICBoYXNNb25vcmVwb01hcmtlcnMoZGlyZWN0b3JpZXMpXG4gICAgICAgIC50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgICBjaGVja1Nob3VsZENvbXBsZXRlKGluZGV4LCByZXN1bHQpO1xuICAgICAgICB9KVxuICAgICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgIC8vIGlnbm9yZVxuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufTtcblxuZXhwb3J0IGNvbnN0IGdldE1vbm9yZXBvUm9vdFZpYURpcmVjdG9yeVNjYW4gPSBhc3luYyAoXG4gIGxvb2t1cERpcmVjdG9yeTogc3RyaW5nXG4pID0+IHtcbiAgY29uc3QgdW5pcXVlRGlybmFtZSA9IChwYXRoPzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKCFwYXRoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGRpcm5hbWUocGF0aCk7XG4gICAgaWYgKHJlc3VsdCA9PT0gcGF0aCkge1xuICAgICAgLy8gZS5nLiB0aGUgcGF0aCB3YXMgYWxyZWFkeSBhIHJvb3QgXCIvXCJcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICBjb25zdCBwYXJlbnQgPSB1bmlxdWVEaXJuYW1lKGxvb2t1cERpcmVjdG9yeSk7XG4gIGNvbnN0IHN1cGVyUGFyZW50ID0gdW5pcXVlRGlybmFtZShwYXJlbnQpO1xuXG4gIHJldHVybiAoXG4gICAgKGF3YWl0IHByaW9yaXRpemVkSGFzTW9ub3JlcG9NYXJrZXJzKFxuICAgICAgLy8gc2NhbiBpbiBtb3N0IGxpa2VseSBsb2NhdGlvbnMgZmlyc3Qgd2l0aCBjdXJyZW50IGxvb2t1cCBkaXJlY3RvcnkgdGFraW5nIHByaW9yaXR5XG4gICAgICBbXG4gICAgICAgIFtsb29rdXBEaXJlY3RvcnldLFxuICAgICAgICBnZXRNb25vcmVwb1Jvb3RTY2FuQ2FuZGlkYXRlcyhsb29rdXBEaXJlY3RvcnkpLFxuICAgICAgICAvLyBzY2FuIDIgZGlyZWN0b3JpZXMgdXB3YXJkc1xuICAgICAgICBbcGFyZW50XSxcbiAgICAgICAgW3N1cGVyUGFyZW50XSxcbiAgICAgIF1cbiAgICAgICAgLm1hcCgoZGlycykgPT4gZGlycy5maWx0ZXIoaXNUcnV0aHkpKVxuICAgICAgICAuZmlsdGVyKChqb2IpID0+IGpvYi5sZW5ndGggPiAwKVxuICAgICkpIHx8IGxvb2t1cERpcmVjdG9yeSAvKiBmYWxsYmFjayB0byBjdXJyZW50IGRpcmVjdG9yeSBpbiB3b3JzZSBzY2VuYXJpbyAqL1xuICApO1xufTtcblxuLyoqXG4gKiBEZXRlcm1pbmUgbW9ub3JlcG8gcm9vdCBwYXRoIGJ5IGRvaW5nIHNvbWUgaGFja3kgY3VycmVudCBhbmRcbiAqIHNvbWUgcGFyZW50IGRpcmVjdG9yaWVzIHNjYW5uaW5nIGFuZCBsb29raW5nIGZvciBtYXJrZXIgZmlsZXMvZGlyc1xuICogbGlrZTpcbiAqXG4gKiAtIC5naXRcbiAqIC0gcGFja2FnZS1sb2NrLmpzb25cbiAqIC0geWFybi5sb2NrXG4gKiAtIHBucG0tbG9jay55YW1sXG4gKiAtIHBucG0td29ya3NwYWNlLnlhbWxcbiAqL1xuZXhwb3J0IGNvbnN0IG1vbm9yZXBvUm9vdFBhdGggPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290UGF0aCA9IGF3YWl0IGdldE1vbm9yZXBvUm9vdFZpYURpcmVjdG9yeVNjYW4ocHJvY2Vzcy5jd2QoKSk7XG4gIHJldHVybiByb290UGF0aDtcbn0pO1xuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnNXaXRoRXh0cmEgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IFNwYXduUmVzdWx0T3B0cyB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBtb2R1bGVzQmluUGF0aCB9IGZyb20gJy4vdXRpbHMvbW9kdWxlc0JpblBhdGgnO1xuaW1wb3J0IHsgbW9ub3JlcG9Sb290UGF0aCB9IGZyb20gJy4vdXRpbHMvbW9ub3JlcG9Sb290UGF0aCc7XG5cbmV4cG9ydCB0eXBlIFRhc2tUeXBlcyA9XG4gIHwgJ2xpbnQnXG4gIHwgJ2J1aWxkJ1xuICB8ICd0ZXN0J1xuICB8ICdkZWNsYXJhdGlvbnMnXG4gIHwgJ2ludGVncmF0aW9uJ1xuICB8ICdzZXR1cDppbnRlZ3JhdGlvbidcbiAgfCAoc3RyaW5nICYge1xuICAgICAgX2FsbG93U3RyaW5ncz86IHVuZGVmaW5lZDtcbiAgICB9KTtcblxuY29uc3QgdHVyYm9QYXRoID0gKCkgPT4gbW9kdWxlc0JpblBhdGgoJ3R1cmJvJyk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYXNUdXJib0pzb24oKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IG1vbm9yZXBvUm9vdFBhdGgoKTtcbiAgcmV0dXJuIGF3YWl0IHN0YXQoam9pbihjd2QsICd0dXJiby5qc29uJykpXG4gICAgLnRoZW4oKHJlcykgPT4gcmVzLmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG59XG5cbi8qKlxuICogUnVuIG9uZSBvZiB0aGUgZGV2IHBpcGVsaW5lIHRhc2tzIHVzaW5nIFR1cmJvIGZvciBhIHNpbmdsZSBwYWNrYWdlXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5UdXJib1Rhc2tzRm9yU2luZ2xlUGFja2FnZShvcHRzOiB7XG4gIHRhc2tzOiBbVGFza1R5cGVzLCAuLi5UYXNrVHlwZXNbXV07XG4gIHBhY2thZ2VEaXI/OiBzdHJpbmc7XG4gIHNwYXduT3B0czogT21pdDxTcGF3bk9wdGlvbnNXaXRoRXh0cmE8U3Bhd25SZXN1bHRPcHRzPiwgJ2N3ZCc+O1xufSkge1xuICBjb25zdCByb290RGlyID0gb3B0cy5wYWNrYWdlRGlyID8/IHByb2Nlc3MuY3dkKCk7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IG1vbm9yZXBvUm9vdFBhdGgoKTtcbiAgcmV0dXJuIGF3YWl0IHNwYXduT3V0cHV0Q29uZGl0aW9uYWwoXG4gICAgdHVyYm9QYXRoKCksXG4gICAgW1xuICAgICAgJ3J1bicsXG4gICAgICAuLi5vcHRzLnRhc2tzLFxuICAgICAgJy0tZmlsdGVyPScgKyByb290RGlyLnJlcGxhY2UoY3dkLCAnLicpLFxuICAgICAgJy0tb3V0cHV0LWxvZ3M9bmV3LW9ubHknLFxuICAgIF0sXG4gICAge1xuICAgICAgLi4ub3B0cy5zcGF3bk9wdHMsXG4gICAgICBjd2QsXG4gICAgfVxuICApO1xufVxuIiwiaW1wb3J0IHR5cGUgeyBDb25maWcgfSBmcm9tICdAamVzdC90eXBlcyc7XG5pbXBvcnQgeyBzdGF0IH0gZnJvbSAnZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgeyBzcGF3bk91dHB1dENvbmRpdGlvbmFsIH0gZnJvbSAnLi4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IHJlYWRQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuaW1wb3J0IHsgcnVuVHVyYm9UYXNrc0ZvclNpbmdsZVBhY2thZ2UgfSBmcm9tICcuLi90dXJibyc7XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRTdGFuZGFyZEdsb2JhbEhvb2soXG4gIHNjcmlwdDogc3RyaW5nLFxuICBnbG9iYWxDb25maWc6IENvbmZpZy5HbG9iYWxDb25maWcsXG4gIHByb2plY3RDb25maWc6IENvbmZpZy5Qcm9qZWN0Q29uZmlnXG4pIHtcbiAgY29uc3QgaGFzSG9vayA9IGF3YWl0IHN0YXQoc2NyaXB0KVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuICByZXR1cm4ge1xuICAgIGhhc0hvb2ssXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFoYXNIb29rKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxvY2F0aW9uID0gam9pbihwcm9jZXNzLmN3ZCgpLCBzY3JpcHQpO1xuICAgICAgY29uc3QgcmVzdWx0ID0gKGF3YWl0IGltcG9ydChsb2NhdGlvbikpIGFzXG4gICAgICAgIHwge1xuICAgICAgICAgICAgZGVmYXVsdD86IChcbiAgICAgICAgICAgICAgZ2xvYmFsQ29uZmlnOiBDb25maWcuR2xvYmFsQ29uZmlnLFxuICAgICAgICAgICAgICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZ1xuICAgICAgICAgICAgKSA9PiBQcm9taXNlPHZvaWQ+O1xuICAgICAgICAgIH1cbiAgICAgICAgfCB1bmRlZmluZWQ7XG4gICAgICBpZiAoIXJlc3VsdCB8fCAhcmVzdWx0LmRlZmF1bHQpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oYOKaoO+4jyBObyBkZWZhdWx0IGV4cG9ydCBmb3VuZCBpbiBcIiR7c2NyaXB0fVwiYCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGF3YWl0IFByb21pc2UucmVzb2x2ZShyZXN1bHQuZGVmYXVsdChnbG9iYWxDb25maWcsIHByb2plY3RDb25maWcpKTtcbiAgICB9LFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBsb2FkQ3VzdG9tR2xvYmFsSG9vayhzY3JpcHQ6IHN0cmluZykge1xuICBjb25zdCBoYXNIb29rID0gYXdhaXQgc3RhdChzY3JpcHQpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gcmVzdWx0LmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG4gIHJldHVybiB7XG4gICAgaGFzSG9vayxcbiAgICBleGVjdXRlOiBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIWhhc0hvb2spIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgbG9jYXRpb24gPSBqb2luKHByb2Nlc3MuY3dkKCksIHNjcmlwdCk7XG4gICAgICBjb25zdCBwYWNrYWdlSnNvbiA9IGF3YWl0IHJlYWRQYWNrYWdlSnNvbihcbiAgICAgICAgam9pbihwcm9jZXNzLmN3ZCgpLCAncGFja2FnZS5qc29uJylcbiAgICAgICk7XG5cbiAgICAgIGlmIChcbiAgICAgICAgc2NyaXB0LmVuZHNXaXRoKCdzZXR1cC50cycpICYmXG4gICAgICAgIHR5cGVvZiBwYWNrYWdlSnNvblsnc2NyaXB0cyddID09PSAnb2JqZWN0JyAmJlxuICAgICAgICBwYWNrYWdlSnNvblsnc2NyaXB0cyddWydzZXR1cDppbnRlZ3JhdGlvbiddID09PSBgdHN4ICR7c2NyaXB0fWBcbiAgICAgICkge1xuICAgICAgICBhd2FpdCBydW5UdXJib1Rhc2tzRm9yU2luZ2xlUGFja2FnZSh7XG4gICAgICAgICAgdGFza3M6IFsnc2V0dXA6aW50ZWdyYXRpb24nXSxcbiAgICAgICAgICBzcGF3bk9wdHM6IHtcbiAgICAgICAgICAgIGV4aXRDb2RlczogWzBdLFxuICAgICAgICAgICAgZW52OiB7XG4gICAgICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgICAgICBMT0dfTEVWRUw6IGxvZ2dlci5sb2dMZXZlbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBzcGF3bk91dHB1dENvbmRpdGlvbmFsKCd0c3gnLCBbbG9jYXRpb25dLCB7XG4gICAgICAgICAgZXhpdENvZGVzOiBbMF0sXG4gICAgICAgICAgZW52OiB7XG4gICAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICAgIExPR19MRVZFTDogbG9nZ2VyLmxvZ0xldmVsLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkQW5kUnVuR2xvYmFsSG9vayhcbiAgc2NyaXB0OiBzdHJpbmcsXG4gIGdsb2JhbENvbmZpZzogQ29uZmlnLkdsb2JhbENvbmZpZyxcbiAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWcsXG4gIHRpcD86IHN0cmluZ1xuKSB7XG4gIGNvbnN0IFtzdGFuZGFyZCwgY3VzdG9tXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICBsb2FkU3RhbmRhcmRHbG9iYWxIb29rKGAke3NjcmlwdH0ubWpzYCwgZ2xvYmFsQ29uZmlnLCBwcm9qZWN0Q29uZmlnKSxcbiAgICBsb2FkQ3VzdG9tR2xvYmFsSG9vayhgJHtzY3JpcHR9LnRzYCksXG4gIF0pO1xuICBpZiAoIWN1c3RvbS5oYXNIb29rICYmIHRpcCkge1xuICAgIGxvZ2dlci50aXAodGlwKTtcbiAgfVxuICBhd2FpdCBzdGFuZGFyZC5leGVjdXRlKCk7XG4gIGF3YWl0IGN1c3RvbS5leGVjdXRlKCk7XG59XG4iXSwibmFt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
