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

async function spawnWithOutputWhenFailed(...parameters) {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const result = await spawnResult(child, opts);
  if (result.error) {
    logger.error(result.output.join(""));
    return Promise.reject(result.error);
  } else if (opts.outputWhenExitCodesNotIn && typeof result.status === "number" && !opts.outputWhenExitCodesNotIn.includes(result.status)) {
    logger.error(result.output.join(""));
    return Promise.resolve(result);
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
  await spawnWithOutputWhenFailed(turboPath(), [
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
        await spawnWithOutputWhenFailed("tsx", [location], {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9hZEFuZFJ1bkdsb2JhbEhvb2suZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWxzL29uY2UudHMiLCIuLi8uLi9zcmMvbG9nZ2VyL2xvZ2dlci50cyIsIi4uLy4uL3NyYy91dGlscy9zdGFja1RyYWNlLnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25Ub1Byb21pc2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdC50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduT3V0cHV0LnRzIiwiLi4vLi4vc3JjL3V0aWxzL29uY2VBc3luYy50cyIsIi4uLy4uL3NyYy9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uLnRzIiwiLi4vLi4vc3JjL3V0aWxzL21vZHVsZVJvb3REaXJlY3RvcnkudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9kdWxlc0JpblBhdGgudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNUcnV0aHkudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9ub3JlcG9Sb290UGF0aC50cyIsIi4uLy4uL3NyYy90dXJiby50cyIsIi4uLy4uL3NyYy9qZXN0L2xvYWRBbmRSdW5HbG9iYWxIb29rLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBvbmNlPFQ+KGZuOiAoKSA9PiBUKTogKCkgPT4gVCB7XG4gIGxldCB2YWx1ZTogVDtcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcbiAgcmV0dXJuICgpOiBUID0+IHtcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICB2YWx1ZSA9IGZuKCk7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xufVxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJy4uL3V0aWxzL29uY2UnO1xuXG5jb25zdCBsZXZlbHMgPSBbJ2RlYnVnJywgJ2luZm8nLCAnd2FybicsICdlcnJvcicsICdmYXRhbCddIGFzIGNvbnN0O1xuXG50eXBlIExvZ0xldmVsID0gdHlwZW9mIGxldmVsc1tudW1iZXJdO1xuXG50eXBlIFBhcmFtcyA9IFBhcmFtZXRlcnM8dHlwZW9mIGNvbnNvbGUubG9nPjtcblxudHlwZSBMb2dnZXIgPSB7XG4gIGxvZ0xldmVsOiBMb2dMZXZlbDtcbiAgZGVidWcoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgLy8gYWxpYXMgZm9yIGluZm9cbiAgbG9nKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgLy8gc3BlY2lhbCB0cmVhdG1lbnQsIGRpc2FibGVkIG9uIENJL1RUWVxuICB0aXAoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgZXJyb3IoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBmYXRhbCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG59O1xuXG5jb25zdCBlbmFibGVkTGV2ZWxzQWZ0ZXIgPSAobGV2ZWw6IExvZ0xldmVsIHwgJ29mZicpID0+IHtcbiAgaWYgKGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuICBjb25zdCBpbmRleCA9IGxldmVscy5maW5kSW5kZXgoKGl0ZW0pID0+IGl0ZW0gPT09IGxldmVsKTtcbiAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBsZXZlbCcpO1xuICB9XG4gIHJldHVybiBsZXZlbHMuc2xpY2UoaW5kZXgpO1xufTtcblxuY29uc3QgaXNMZXZlbCA9IChsZXZlbD86IHN0cmluZyk6IGxldmVsIGlzIExvZ0xldmVsID0+IHtcbiAgcmV0dXJuIGxldmVscy5pbmNsdWRlcyhsZXZlbCBhcyBMb2dMZXZlbCk7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlGcm9tUHJvY2Vzc0FyZ3MgPSAoXG4gIGFyZ3MgPSBwcm9jZXNzLmFyZ3Zcbik6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xuICBjb25zdCBpbmRleCA9IGFyZ3MuZmluZEluZGV4KCh2YWx1ZSkgPT4gdmFsdWUgPT09ICctLWxvZy1sZXZlbCcpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBjb25zdCBsZXZlbCA9IGFyZ3NbaW5kZXggKyAxXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgdmVyYm9zaXR5RnJvbUVudiA9ICgpOiBMb2dMZXZlbCB8ICdvZmYnIHwgdW5kZWZpbmVkID0+IHtcbiAgY29uc3QgbGV2ZWwgPSBwcm9jZXNzLmVudlsnTE9HX0xFVkVMJ107XG4gIGlmIChsZXZlbCA9PT0gJ3NpbGVudCcgfHwgbGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuICdvZmYnO1xuICB9XG4gIGlmICghaXNMZXZlbChsZXZlbCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBsZXZlbDtcbn07XG5cbmNvbnN0IGdldFZlcmJvc2l0eUNvbmZpZyA9ICgpID0+IHtcbiAgY29uc3QgYXJnc0xldmVsID0gdmVyYm9zaXR5RnJvbVByb2Nlc3NBcmdzKCk7XG4gIGNvbnN0IGVudkxldmVsID0gdmVyYm9zaXR5RnJvbUVudigpO1xuICByZXR1cm4gYXJnc0xldmVsID8/IGVudkxldmVsID8/ICdpbmZvJztcbn07XG5cbmNvbnN0IG5vb3AgPSAoLi4uX2FyZ3M6IFBhcmFtcykgPT4ge1xuICByZXR1cm47XG59O1xuXG5jb25zdCBsb2cgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XG4gIGNvbnNvbGUubG9nKC4uLmFyZ3MpO1xufTtcblxuY29uc3QgZXJyb3IgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XG4gIGNvbnNvbGUuZXJyb3IoLi4uYXJncyk7XG59O1xuXG5jb25zdCBzaG91bGRFbmFibGVUaXAgPSAoKSA9PiAhcHJvY2Vzcy5lbnZbJ0NJJ10gJiYgIXByb2Nlc3Muc3Rkb3V0LmlzVFRZO1xuXG5leHBvcnQgY29uc3QgY3JlYXRlTG9nZ2VyID0gKFxuICBkZXBzID0geyBnZXRWZXJib3NpdHlDb25maWcsIGxvZywgZXJyb3IsIHNob3VsZEVuYWJsZVRpcCB9XG4pID0+IHtcbiAgY29uc3QgbG9nTGV2ZWwgPSBkZXBzLmdldFZlcmJvc2l0eUNvbmZpZygpO1xuICBjb25zdCBlbmFibGVkID0gZW5hYmxlZExldmVsc0FmdGVyKGxvZ0xldmVsKTtcbiAgcmV0dXJuIGxldmVscy5yZWR1Y2UoXG4gICAgKGFjYywgbHZsKSA9PiB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5hY2MsXG4gICAgICAgIFtsdmxdOiBlbmFibGVkLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICA/IFsnZmF0YWwnLCAnZXJyb3InXS5pbmNsdWRlcyhsdmwpXG4gICAgICAgICAgICA/IGRlcHMuZXJyb3JcbiAgICAgICAgICAgIDogZGVwcy5sb2dcbiAgICAgICAgICA6IG5vb3AsXG4gICAgICB9O1xuICAgIH0sXG4gICAge1xuICAgICAgbG9nTGV2ZWwsXG4gICAgICBsb2c6IGVuYWJsZWQuaW5jbHVkZXMoJ2luZm8nKSA/IGRlcHMubG9nIDogbm9vcCxcbiAgICAgIHRpcDogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpICYmIGRlcHMuc2hvdWxkRW5hYmxlVGlwKCkgPyBkZXBzLmxvZyA6IG5vb3AsXG4gICAgfSBhcyBMb2dnZXJcbiAgKTtcbn07XG5cbmNvbnN0IGNyZWF0ZURlbGVnYXRpbmdMb2dnZXIgPSAob3B0czogeyBwYXJlbnQ6IExvZ2dlciB9KTogTG9nZ2VyID0+XG4gIE9iamVjdC5mcmVlemUoe1xuICAgIGdldCBsb2dMZXZlbCgpIHtcbiAgICAgIHJldHVybiBvcHRzLnBhcmVudC5sb2dMZXZlbDtcbiAgICB9LFxuICAgIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5kZWJ1ZyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgaW5mbyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuaW5mbyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgbG9nKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5sb2coLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQudGlwKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC53YXJuKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuZXJyb3IoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5mYXRhbCguLi5wYXJhbXMpO1xuICAgIH0sXG4gIH0pO1xuXG5sZXQgZGVmYXVsdExvZ2dlckZhY3Rvcnk6ICgoKSA9PiBMb2dnZXIpIHwgbnVsbDtcblxuZXhwb3J0IGNvbnN0IGNvbmZpZ3VyZURlZmF1bHRMb2dnZXIgPSAoZmFjdG9yeTogKCkgPT4gTG9nZ2VyKSA9PiB7XG4gIGlmIChkZWZhdWx0TG9nZ2VyRmFjdG9yeSkge1xuICAgIGNvbnN0IGVycm9yID0ge1xuICAgICAgc3RhY2s6ICcnLFxuICAgIH07XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UoZXJyb3IpO1xuICAgIGxvZ2dlci5kZWJ1ZygnQ2Fubm90IG92ZXJyaWRlIGRlZmF1bHQgbG9nZ2VyIG11bHRpcGxlIHRpbWVzJywgZXJyb3Iuc3RhY2spO1xuICAgIHJldHVybjtcbiAgfVxuICBkZWZhdWx0TG9nZ2VyRmFjdG9yeSA9IGZhY3Rvcnk7XG59O1xuXG5jb25zdCBkZWZhdWx0TG9nZ2VyID0gb25jZSgoKSA9PiB7XG4gIGxldCBmYWN0b3J5ID0gZGVmYXVsdExvZ2dlckZhY3Rvcnk7XG4gIGlmICghZmFjdG9yeSkge1xuICAgIGZhY3RvcnkgPSAoKSA9PiBjcmVhdGVMb2dnZXIoKTtcbiAgfVxuICByZXR1cm4gZmFjdG9yeSgpO1xufSk7XG5cbi8qKlxuICogRGVmYXVsdCBsb2dnZXIgaW5zdGFuY2UgY2FuIGJlIGNvbmZpZ3VyZWQgb25jZSBhdCBzdGFydHVwXG4gKi9cbmV4cG9ydCBjb25zdCBsb2dnZXI6IExvZ2dlciA9IGNyZWF0ZURlbGVnYXRpbmdMb2dnZXIoe1xuICBnZXQgcGFyZW50KCkge1xuICAgIHJldHVybiBkZWZhdWx0TG9nZ2VyKCk7XG4gIH0sXG59KTtcbiIsIi8qKlxuICogQ2FwdHVyZSB0aGUgc3RhY2sgdHJhY2UgYW5kIGFsbG93IHRvIGVucmljaCBleGNlcHRpb25zIHRocm93biBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2tzXG4gKiB3aXRoIGFkZGl0aW9uYWwgc3RhY2sgaW5mb3JtYXRpb24gY2FwdHVyZWQgYXQgdGhlIG1vbWVudCBvZiB0aGUgY2FsbCBvZiB0aGlzIGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYXB0dXJlU3RhY2tUcmFjZShyZW1vdmUgPSAwKSB7XG4gIGNvbnN0IHN0YWNrQ29udGFpbmVyID0ge1xuICAgIHN0YWNrOiAnJyxcbiAgfTtcbiAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2Uoc3RhY2tDb250YWluZXIpO1xuICBjb25zdCBzdGFja1RyYWNlID0gc3RhY2tDb250YWluZXIuc3RhY2tcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLnNsaWNlKDYgKyByZW1vdmUpXG4gICAgLmpvaW4oJ1xcbicpO1xuICByZXR1cm4ge1xuICAgIC8qKlxuICAgICAqIENhcHR1cmVkIHN0YWNrIHRyYWNlIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgc3RhY2tUcmFjZSxcbiAgICAvKipcbiAgICAgKiBDYW4gYmUgY2FsbGVkIGluIGFzeW5jaHJvbm91cyBjYWxsYmFjayB0byBlbnJpY2ggZXhjZXB0aW9ucyB3aXRoIGFkZGl0aW9uYWwgaW5mb3JtYXRpb25cbiAgICAgKiBAcGFyYW0gZXJyIEV4Y2VwdGlvbiB0byBlbnJpY2ggLSBpdCBpcyBnb2luZyB0byBoYXZlIGl0cyBgLnN0YWNrYCBwcm9wIG11dGF0ZWRcbiAgICAgKiBAcmV0dXJucyBTYW1lIGV4Y2VwdGlvblxuICAgICAqL1xuICAgIHByZXBhcmVGb3JSZXRocm93OiAoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgY29uc3Qgb2xkU3RhY2tUcmFjZSA9IGVyci5zdGFjayA/PyAnJy5zcGxpdCgnXFxuJykuc2xpY2UoMSkuam9pbignXFxuJyk7XG4gICAgICBlcnIuc3RhY2sgPSBgJHtlcnIubmFtZSB8fCAnRXJyb3InfTogJHtcbiAgICAgICAgZXJyLm1lc3NhZ2VcbiAgICAgIH1cXG4ke29sZFN0YWNrVHJhY2V9XFxuJHtzdGFja1RyYWNlfWA7XG4gICAgICByZXR1cm4gZXJyO1xuICAgIH0sXG4gIH07XG59XG4iLCJpbXBvcnQgdHlwZSB7IFNwYXduT3B0aW9ucyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgQ2hpbGRQcm9jZXNzIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHR5cGUgeyBBc3NpZ24gfSBmcm9tICd1dGlsaXR5LXR5cGVzJztcblxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBjYXB0dXJlU3RhY2tUcmFjZSB9IGZyb20gJy4uL3V0aWxzL3N0YWNrVHJhY2UnO1xuXG5leHBvcnQgdHlwZSBTcGF3blRvUHJvbWlzZU9wdHMgPSB7XG4gIC8qKlxuICAgKiBTcGVjaWZ5IGV4aXQgY29kZXMgd2hpY2ggc2hvdWxkIG5vdCByZXN1bHQgaW4gdGhyb3dpbmcgYW4gZXJyb3Igd2hlblxuICAgKiB0aGUgcHJvY2VzcyBoYXMgZmluaXNoZWQsIGUuZy4gc3BlY2lmeWluZyBgWzBdYCBtZWFucyBpZiBwcm9jZXNzIGZpbmlzaGVkXG4gICAqIHdpdGggemVybyBleGl0IGNvZGUgdGhlbiB0aGUgcHJvbWlzZSB3aWxsIHJlc29sdmUgaW5zdGVhZCBvZiByZWplY3RpbmcuXG4gICAqXG4gICAqIEFsdGVybmF0aXZlbHksIHNwZWNpZnkgYGluaGVyaXRgIHRvIHNhdmUgc3RhdHVzIGNvZGUgdG8gdGhlIGN1cnJlbnQgYHByb2Nlc3MuZXhpdENvZGVgXG4gICAqXG4gICAqIEFsdGVybmF0aXZlbHksIGNvbXBsZXRlbHkgaWdub3JlIHRoZSBleGl0IGNvZGUgKGUuZy4geW91IGZvbGxvdyB1cCBhbmQgaW50ZXJyb2dhdGVcbiAgICogdGhlIHByb2Nlc3MgY29kZSBtYW51YWxseSBhZnRlcndhcmRzKVxuICAgKi9cbiAgZXhpdENvZGVzOiBudW1iZXJbXSB8ICdpbmhlcml0JyB8ICdhbnknO1xufTtcblxudHlwZSBTaGFyZWRPcHRzID0gUGljazxTcGF3bk9wdGlvbnMsICdjd2QnPjtcblxudHlwZSBTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4gPSBbXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgYXJnczogUmVhZG9ubHlBcnJheTxzdHJpbmc+LFxuICBvcHRpb25zOiBBc3NpZ248U3Bhd25PcHRpb25zLCBFPlxuXTtcblxuZXhwb3J0IHR5cGUgU3Bhd25PcHRpb25zV2l0aEV4dHJhPEUgZXh0ZW5kcyBvYmplY3QgPSBTcGF3blRvUHJvbWlzZU9wdHM+ID1cbiAgQXNzaWduPFNwYXduT3B0aW9ucywgRT47XG5cbmV4cG9ydCB0eXBlIFNwYXduUGFyYW1ldGVyTWl4PEUgZXh0ZW5kcyBvYmplY3QgPSBTcGF3blRvUHJvbWlzZU9wdHM+ID1cbiAgfCBbY3A6IENoaWxkUHJvY2VzcywgZXh0cmFPcHRzOiBBc3NpZ248RSwgU2hhcmVkT3B0cz5dXG4gIHwgU3Bhd25BcmdzPEU+O1xuXG5leHBvcnQgZnVuY3Rpb24gaXNTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4oXG4gIGFyZ3M6IFNwYXduUGFyYW1ldGVyTWl4PEU+XG4pOiBhcmdzIGlzIFNwYXduQXJnczxFPiB7XG4gIHJldHVybiAhKGFyZ3NbMF0gaW5zdGFuY2VvZiBDaGlsZFByb2Nlc3MpICYmIHR5cGVvZiBhcmdzWzBdID09PSAnc3RyaW5nJztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNwYXduV2l0aFNwYXduUGFyYW1ldGVyczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgcGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbikge1xuICBjb25zdCBbY2hpbGQsIFtjb21tYW5kLCBhcmdzLCBvcHRzXV0gPSBpc1NwYXduQXJncyhwYXJhbWV0ZXJzKVxuICAgID8gW1xuICAgICAgICBzcGF3biguLi4ocGFyYW1ldGVycyBhcyB1bmtub3duIGFzIFBhcmFtZXRlcnM8dHlwZW9mIHNwYXduPikpLFxuICAgICAgICBwYXJhbWV0ZXJzLFxuICAgICAgXVxuICAgIDogW1xuICAgICAgICBwYXJhbWV0ZXJzWzBdLFxuICAgICAgICBbXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmZpbGUsXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmFyZ3Muc2xpY2UoMSksXG4gICAgICAgICAgcGFyYW1ldGVyc1sxXSBhcyBBc3NpZ248U3Bhd25PcHRpb25zLCBFPixcbiAgICAgICAgXSxcbiAgICAgIF07XG4gIHJldHVybiB7XG4gICAgY2hpbGQsXG4gICAgY29tbWFuZCxcbiAgICBhcmdzLFxuICAgIG9wdHMsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blRvUHJvbWlzZShcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXhcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB7IGNoaWxkLCBjb21tYW5kLCBhcmdzLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHsgcHJlcGFyZUZvclJldGhyb3cgfSA9IGNhcHR1cmVTdGFja1RyYWNlKCk7XG5cbiAgY29uc3QgZXhpdENvZGVzID0gb3B0cy5leGl0Q29kZXM7XG5cbiAgY29uc3QgY3dkID0gb3B0cy5jd2QgPyBvcHRzLmN3ZC50b1N0cmluZygpIDogdW5kZWZpbmVkO1xuXG4gIGNvbnN0IGNtZCA9ICgpID0+IFtjb21tYW5kLCAuLi5hcmdzXS5qb2luKCcgJyk7XG5cbiAgbG9nZ2VyLmRlYnVnKFsnPicsIGNtZCgpXS5qb2luKCcgJyksIC4uLihjd2QgPyBbYGluICR7Y3dkfWBdIDogW10pKTtcblxuICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzLCByZWopID0+XG4gICAgY2hpbGRcbiAgICAgIC5vbignY2xvc2UnLCAoY29kZSwgc2lnbmFsKSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgY29kZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdpbmhlcml0JyAmJlxuICAgICAgICAgICAgZXhpdENvZGVzICE9PSAnYW55JyAmJlxuICAgICAgICAgICAgIWV4aXRDb2Rlcy5pbmNsdWRlcyhjb2RlKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgcmVqKFxuICAgICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgICBuZXcgRXJyb3IoYENvbW1hbmQgXCIke2NtZCgpfVwiIGhhcyBmYWlsZWQgd2l0aCBjb2RlICR7Y29kZX1gKVxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoc2lnbmFsKSB7XG4gICAgICAgICAgcmVqKFxuICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3coXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihgRmFpbGVkIHRvIGV4ZWN1dGUgY29tbWFuZCBcIiR7Y21kKCl9XCIgLSAke3NpZ25hbH1gKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgcHJlcGFyZUZvclJldGhyb3cobmV3IEVycm9yKCdFeHBlY3RlZCBzaWduYWwgb3IgZXJyb3IgY29kZScpKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5vbignZXJyb3InLCByZWopXG4gICk7XG4gIC8vIGluaGVyaXQgZXhpdCBjb2RlXG4gIGlmIChleGl0Q29kZXMgPT09ICdpbmhlcml0Jykge1xuICAgIGlmIChcbiAgICAgIHR5cGVvZiBjaGlsZC5leGl0Q29kZSA9PT0gJ251bWJlcicgJiZcbiAgICAgICh0eXBlb2YgcHJvY2Vzcy5leGl0Q29kZSAhPT0gJ251bWJlcicgfHwgcHJvY2Vzcy5leGl0Q29kZSA9PT0gMClcbiAgICApIHtcbiAgICAgIHByb2Nlc3MuZXhpdENvZGUgPSBjaGlsZC5leGl0Q29kZTtcbiAgICB9XG4gIH1cbn1cbiIsImltcG9ydCBhc3NlcnQgZnJvbSAnYXNzZXJ0JztcblxuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCwgU3Bhd25Ub1Byb21pc2VPcHRzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5pbXBvcnQgeyBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduVG9Qcm9taXNlIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0T3B0cyA9IHtcbiAgb3V0cHV0PzogWydzdGRvdXQnIHwgJ3N0ZGVycicsIC4uLkFycmF5PCdzdGRvdXQnIHwgJ3N0ZGVycic+XTtcbn0gJiBTcGF3blRvUHJvbWlzZU9wdHM7XG5cbnR5cGUgU3Bhd25SZXN1bHRSZXR1cm4gPSB7XG4gIHBpZD86IG51bWJlcjtcbiAgb3V0cHV0OiBzdHJpbmdbXTtcbiAgc3Rkb3V0OiBzdHJpbmc7XG4gIHN0ZGVycjogc3RyaW5nO1xuICBzdGF0dXM6IG51bWJlciB8IG51bGw7XG4gIHNpZ25hbDogTm9kZUpTLlNpZ25hbHMgfCBudWxsO1xuICBlcnJvcj86IEVycm9yIHwgdW5kZWZpbmVkO1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduUmVzdWx0KFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxTcGF3blJlc3VsdE9wdHM+XG4pOiBQcm9taXNlPFNwYXduUmVzdWx0UmV0dXJuPiB7XG4gIGNvbnN0IHsgY2hpbGQsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgY29tYmluZWREYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGRvdXREYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBvdXRwdXQgPSBvcHRzLm91dHB1dCA/PyBbJ3N0ZG91dCcsICdzdGRlcnInXTtcbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3Rkb3V0JykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZG91dCxcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRvdXRcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRvdXREYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3RkZXJyJykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZGVycixcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRlcnJcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3NwYXduVG9Qcm9taXNlKGNoaWxkLCBvcHRzKV0pO1xuICByZXR1cm4ge1xuICAgIHBpZDogY2hpbGQucGlkLFxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcbiAgICBzdGF0dXM6IGNoaWxkLmV4aXRDb2RlLFxuICAgIGdldCBvdXRwdXQoKSB7XG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xuICAgIH0sXG4gICAgZ2V0IHN0ZGVycigpIHtcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IHN0ZG91dCgpIHtcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IGVycm9yKCkge1xuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcbiAgICAgICAgPyAocmVzdWx0LnJlYXNvbiBhcyBFcnJvcilcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMgfSBmcm9tICcuL3NwYXduUmVzdWx0JztcbmltcG9ydCB7IHNwYXduUmVzdWx0IH0gZnJvbSAnLi9zcGF3blJlc3VsdCc7XG5pbXBvcnQgdHlwZSB7IFNwYXduUGFyYW1ldGVyTWl4IH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5pbXBvcnQgeyBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduT3V0cHV0KFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxTcGF3blJlc3VsdE9wdHM+XG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcbiAgcmV0dXJuIHJlc3VsdC5vdXRwdXQuam9pbignJyk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bldpdGhPdXRwdXRXaGVuRmFpbGVkKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxcbiAgICBTcGF3blJlc3VsdE9wdHMgJiB7XG4gICAgICBvdXRwdXRXaGVuRXhpdENvZGVzTm90SW4/OiBudW1iZXJbXTtcbiAgICB9XG4gID5cbikge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcbiAgaWYgKHJlc3VsdC5lcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcihyZXN1bHQub3V0cHV0LmpvaW4oJycpKTtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcbiAgfSBlbHNlIGlmIChcbiAgICBvcHRzLm91dHB1dFdoZW5FeGl0Q29kZXNOb3RJbiAmJlxuICAgIHR5cGVvZiByZXN1bHQuc3RhdHVzID09PSAnbnVtYmVyJyAmJlxuICAgICFvcHRzLm91dHB1dFdoZW5FeGl0Q29kZXNOb3RJbi5pbmNsdWRlcyhyZXN1bHQuc3RhdHVzKVxuICApIHtcbiAgICBsb2dnZXIuZXJyb3IocmVzdWx0Lm91dHB1dC5qb2luKCcnKSk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXN1bHQpO1xuICB9XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzdWx0KTtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBvbmNlQXN5bmM8VD4oZm46ICgpID0+IFQgfCBQcm9taXNlPFQ+KTogKCkgPT4gUHJvbWlzZTxUPiB7XG4gIGxldCB2YWx1ZTogVDtcbiAgbGV0IGluRmxpZ2h0OiBQcm9taXNlPFQ+IHwgbnVsbDtcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcbiAgcmV0dXJuIGFzeW5jICgpOiBQcm9taXNlPFQ+ID0+IHtcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICBpZiAoaW5GbGlnaHQpIHtcbiAgICAgIHJldHVybiBpbkZsaWdodDtcbiAgICB9XG4gICAgaW5GbGlnaHQgPSBQcm9taXNlLnJlc29sdmUoZm4oKSk7XG4gICAgdmFsdWUgPSBhd2FpdCBpbkZsaWdodDtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICBpbkZsaWdodCA9IG51bGw7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xufVxuIiwiaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICcuLi91dGlscy9vbmNlQXN5bmMnO1xuaW1wb3J0IHR5cGUgeyBQYWNrYWdlSnNvbiB9IGZyb20gJy4vcGFja2FnZUpzb24nO1xuXG5jb25zdCBjd2RQYWNrYWdlSnNvblBhdGggPSAoKSA9PiBqb2luKHByb2Nlc3MuY3dkKCksICcuL3BhY2thZ2UuanNvbicpO1xuXG5hc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb25BdChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIHJldHVybiBhd2FpdCByZWFkRmlsZShwYXRoLCAndXRmLTgnKS50aGVuKFxuICAgIChyZXN1bHQpID0+IEpTT04ucGFyc2UocmVzdWx0KSBhcyBQYWNrYWdlSnNvblxuICApO1xufVxuXG5leHBvcnQgY29uc3QgcmVhZEN3ZFBhY2thZ2VKc29uID0gb25jZUFzeW5jKCgpID0+XG4gIHJlYWRQYWNrYWdlSnNvbkF0KGN3ZFBhY2thZ2VKc29uUGF0aCgpKVxuKTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbihwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIC8vIGFzc3VtaW5nIGN1cnJlbnQgZGlyZWN0b3J5IGRvZXNuJ3QgY2hhbmdlIHdoaWxlIGFwcCBpcyBydW5uaW5nXG4gIHJldHVybiBwcm9jZXNzLmN3ZCgpID09PSBjd2RQYWNrYWdlSnNvblBhdGgoKVxuICAgID8gYXdhaXQgcmVhZEN3ZFBhY2thZ2VKc29uKClcbiAgICA6IGF3YWl0IHJlYWRQYWNrYWdlSnNvbkF0KHBhdGgpO1xufVxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSAnbm9kZTp1cmwnO1xuXG5pbXBvcnQgeyBvbmNlIH0gZnJvbSAnLi9vbmNlJztcblxuZXhwb3J0IGNvbnN0IGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsID0gKG9wdHM6IHtcbiAgaW1wb3J0TWV0YVVybDogc3RyaW5nO1xufSkgPT4ge1xuICAvLyB0aGlzIGlzIGhpZ2hseSBkZXBlbmRlbnQgb24gdGhlIG91dHB1dCBkaXJlY3Rvcnkgc3RydWN0dXJlXG4gIC8vIGFuZCB0aGUgY29udGV4dCBpbiB3aGljaCB0aGlzIGZ1bmN0aW9uIGlzIHJ1biAoYnVuZGxlZCBjb2RlIHZzIHRzeCAuL3NyYy90c2ZpbGUudHMpXG4gIGNvbnN0IF9fZmlsZU5hbWUgPSBmaWxlVVJMVG9QYXRoKG5ldyBVUkwob3B0cy5pbXBvcnRNZXRhVXJsKSk7XG4gIGNvbnN0IHBhcmVudCA9IGRpcm5hbWUoX19maWxlTmFtZSk7XG4gIGNvbnN0IHN1cGVyUGFyZW50ID0gZGlybmFtZShwYXJlbnQpO1xuXG4gIGNvbnN0IGlzQnVuZGxlZEluRGlzdCA9ICgpID0+IHBhcmVudC5lbmRzV2l0aCgnL2Rpc3QnKTtcbiAgY29uc3QgaXNCdW5kbGVkSW5CaW4gPSAoKSA9PlxuICAgIHBhcmVudC5lbmRzV2l0aCgnL2JpbicpICYmICFzdXBlclBhcmVudC5lbmRzV2l0aCgnL3NyYycpO1xuXG4gIGlmIChpc0J1bmRsZWRJbkRpc3QoKSB8fCBpc0J1bmRsZWRJbkJpbigpKSB7XG4gICAgcmV0dXJuIGZpbGVVUkxUb1BhdGgobmV3IFVSTChgLi4vYCwgb3B0cy5pbXBvcnRNZXRhVXJsKSk7XG4gIH1cblxuICAvLyBydW4gdmlhIHRzeCB0byBidWlsZCB0aGUgQHJlcGthLWtpdC90cyBpdHNlbGZcbiAgcmV0dXJuIGZpbGVVUkxUb1BhdGgobmV3IFVSTChgLi4vLi4vYCwgb3B0cy5pbXBvcnRNZXRhVXJsKSk7XG59O1xuXG5leHBvcnQgY29uc3QgbW9kdWxlUm9vdERpcmVjdG9yeSA9IG9uY2UoKCkgPT5cbiAgZ2V0TW9kdWxlUm9vdERpcmVjdG9yeUZvckltcG9ydE1ldGFVcmwoeyBpbXBvcnRNZXRhVXJsOiBpbXBvcnQubWV0YS51cmwgfSlcbik7XG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4vbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5cbmV4cG9ydCBmdW5jdGlvbiBtb2R1bGVzQmluUGF0aChiaW46IHN0cmluZykge1xuICByZXR1cm4gam9pbihtb2R1bGVSb290RGlyZWN0b3J5KCksIGAuL25vZGVfbW9kdWxlcy8uYmluLyR7YmlufWApO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIGlzVHJ1dGh5PFQ+KFxuICB2YWx1ZTogTm9uTnVsbGFibGU8VD4gfCBmYWxzZSB8IG51bGwgfCB1bmRlZmluZWQgfCAnJyB8IDBcbik6IHZhbHVlIGlzIE5vbk51bGxhYmxlPFQ+IHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUpO1xufVxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5pbXBvcnQgeyBkaXJuYW1lLCBqb2luIH0gZnJvbSAncGF0aCc7XG5cbmltcG9ydCB7IGlzVHJ1dGh5IH0gZnJvbSAnLi9pc1RydXRoeSc7XG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICcuL29uY2VBc3luYyc7XG5cbmNvbnN0IGdldE1vbm9yZXBvUm9vdFNjYW5DYW5kaWRhdGVzID0gKGN1cnJlbnREaXJlY3Rvcnk6IHN0cmluZykgPT4ge1xuICAvLyBoYXZpbmcgJ3BhY2thZ2VzLyonIGluIHRoZSByb290IG9mIGEgbW9ub3JlcG8gaXMgc3VwZXIgY29tbW9uXG4gIGNvbnN0IHJlc3VsdCA9IC8oLiooPz1cXC9wYWNrYWdlc1xcLykpfCguKig/PVxcL25vZGVfbW9kdWxlc1xcLykpfCguKikvLmV4ZWMoXG4gICAgY3VycmVudERpcmVjdG9yeVxuICApO1xuICBhc3NlcnQoISFyZXN1bHQpO1xuICBjb25zdCBbLCBwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdF0gPSByZXN1bHQ7XG4gIHJldHVybiBbcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdLmZpbHRlcihpc1RydXRoeSk7XG59O1xuXG4vLyByZXR1cm5zIHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2hpY2ggaGFzIG1vbm9yZXBvIG1hcmtlcnMsIG11bHRpcGxlXG4vLyBkaXJlY3RvcmllcyBjYW4gaGF2ZSB0aGVtIC0gd2hpY2hldmVyIHJlYWQgZmlyc3Qgd2lsbCBiZSByZXR1cm5lZFxuLy8gc28gaWYgb3JkZXIgaXMgaW1wb3J0YW50IC0gc2Nhbm5pbmcgc2hvdWxkIGJlIHNlcGFyYXRlZCB0byBtdWx0aXBsZSBqb2JzXG4vLyB2aWEgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnNcbmNvbnN0IGhhc01vbm9yZXBvTWFya2VycyA9IGFzeW5jIChjYW5kaWRhdGVzOiBzdHJpbmdbXSkgPT4ge1xuICBjb25zdCBtYXJrZXJzID0gW1xuICAgICcuZ2l0JyxcbiAgICAneWFybi5sb2NrJyxcbiAgICAncG5wbS1sb2NrLnlhbWwnLFxuICAgICdwYWNrYWdlLWxvY2suanNvbicsXG4gICAgJ3BucG0td29ya3NwYWNlLnlhbWwnLFxuICBdO1xuICBjb25zdCBtYXJrZXJzU3RyZWFtID0gZmcuc3RyZWFtKFxuICAgIGNhbmRpZGF0ZXMuZmxhdE1hcCgoZGlyKSA9PiBtYXJrZXJzLm1hcCgobWFya2VyKSA9PiBqb2luKGRpciwgbWFya2VyKSkpLFxuICAgIHtcbiAgICAgIG1hcmtEaXJlY3RvcmllczogdHJ1ZSxcbiAgICAgIG9ubHlGaWxlczogZmFsc2UsXG4gICAgfVxuICApO1xuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPigocmVzKSA9PiB7XG4gICAgbWFya2Vyc1N0cmVhbS5vbignZGF0YScsIChlbnRyeTogc3RyaW5nKSA9PiB7XG4gICAgICByZXMoZGlybmFtZShlbnRyeSkpO1xuICAgICAgaWYgKCdkZXN0cm95JyBpbiBtYXJrZXJzU3RyZWFtKSB7XG4gICAgICAgIChtYXJrZXJzU3RyZWFtIGFzIHVua25vd24gYXMgeyBkZXN0cm95OiAoKSA9PiB2b2lkIH0pLmRlc3Ryb3koKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBtYXJrZXJzU3RyZWFtLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICByZXModW5kZWZpbmVkKTtcbiAgICB9KTtcbiAgfSk7XG59O1xuXG5jb25zdCBwcmlvcml0aXplZEhhc01vbm9yZXBvTWFya2VycyA9IChqb2JzOiBzdHJpbmdbXVtdKSA9PiB7XG4gIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgfVxuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPigocmVzKSA9PiB7XG4gICAgY29uc3QgcmVzdWx0cyA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmcgfCB1bmRlZmluZWQ+KCk7XG5cbiAgICBjb25zdCBjaGVja1Nob3VsZENvbXBsZXRlID0gKGluZGV4OiBudW1iZXIsIHJlc3VsdDogc3RyaW5nIHwgdW5kZWZpbmVkKSA9PiB7XG4gICAgICByZXN1bHRzLnNldChpbmRleCwgcmVzdWx0KTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgam9icy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBoYXNSZXN1bHQgPSByZXN1bHRzLmhhcyhpKTtcbiAgICAgICAgaWYgKCFoYXNSZXN1bHQpIHtcbiAgICAgICAgICAvLyBpZiBhIGpvYiB3aXRoIGhpZ2hlc3QgcHJpb3JpdHkgaGFzbid0IGZpbmlzaGVkIHlldFxuICAgICAgICAgIC8vIHRoZW4gd2FpdCBmb3IgaXRcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXN1bHQgPSByZXN1bHRzLmdldChpKTtcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIC8vIGpvYiBmaW5pc2hlZCBhbmQgd2UgZm91bmQgbWFya2VycywgYWxzbyBhbGwgam9ic1xuICAgICAgICAgIC8vIHdpdGggaGlnaGVyIHByaW9yaXR5IGZpbmlzaGVkIGFuZCB0aGV5IGRvbid0IGhhdmVcbiAgICAgICAgICAvLyBhbnkgbWFya2VycyAtIHdlIGFyZSBkb25lXG4gICAgICAgICAgcmVzKHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHRzLnNpemUgPT09IGpvYnMubGVuZ3RoKSB7XG4gICAgICAgIC8vIGFsbCBqb2JzIGZpbmlzaGVkIC0gbm8gbWFya2VycyBmb3VuZFxuICAgICAgICByZXModW5kZWZpbmVkKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgam9icy5mb3JFYWNoKChkaXJlY3RvcmllcywgaW5kZXgpID0+IHtcbiAgICAgIGhhc01vbm9yZXBvTWFya2VycyhkaXJlY3RvcmllcylcbiAgICAgICAgLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGNoZWNrU2hvdWxkQ29tcGxldGUoaW5kZXgsIHJlc3VsdCk7XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gaWdub3JlXG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59O1xuXG5leHBvcnQgY29uc3QgZ2V0TW9ub3JlcG9Sb290VmlhRGlyZWN0b3J5U2NhbiA9IGFzeW5jIChcbiAgbG9va3VwRGlyZWN0b3J5OiBzdHJpbmdcbikgPT4ge1xuICBjb25zdCB1bmlxdWVEaXJuYW1lID0gKHBhdGg/OiBzdHJpbmcpID0+IHtcbiAgICBpZiAoIXBhdGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gZGlybmFtZShwYXRoKTtcbiAgICBpZiAocmVzdWx0ID09PSBwYXRoKSB7XG4gICAgICAvLyBlLmcuIHRoZSBwYXRoIHdhcyBhbHJlYWR5IGEgcm9vdCBcIi9cIlxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIGNvbnN0IHBhcmVudCA9IHVuaXF1ZURpcm5hbWUobG9va3VwRGlyZWN0b3J5KTtcbiAgY29uc3Qgc3VwZXJQYXJlbnQgPSB1bmlxdWVEaXJuYW1lKHBhcmVudCk7XG5cbiAgcmV0dXJuIChcbiAgICAoYXdhaXQgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnMoXG4gICAgICAvLyBzY2FuIGluIG1vc3QgbGlrZWx5IGxvY2F0aW9ucyBmaXJzdCB3aXRoIGN1cnJlbnQgbG9va3VwIGRpcmVjdG9yeSB0YWtpbmcgcHJpb3JpdHlcbiAgICAgIFtcbiAgICAgICAgW2xvb2t1cERpcmVjdG9yeV0sXG4gICAgICAgIGdldE1vbm9yZXBvUm9vdFNjYW5DYW5kaWRhdGVzKGxvb2t1cERpcmVjdG9yeSksXG4gICAgICAgIC8vIHNjYW4gMiBkaXJlY3RvcmllcyB1cHdhcmRzXG4gICAgICAgIFtwYXJlbnRdLFxuICAgICAgICBbc3VwZXJQYXJlbnRdLFxuICAgICAgXVxuICAgICAgICAubWFwKChkaXJzKSA9PiBkaXJzLmZpbHRlcihpc1RydXRoeSkpXG4gICAgICAgIC5maWx0ZXIoKGpvYikgPT4gam9iLmxlbmd0aCA+IDApXG4gICAgKSkgfHwgbG9va3VwRGlyZWN0b3J5IC8qIGZhbGxiYWNrIHRvIGN1cnJlbnQgZGlyZWN0b3J5IGluIHdvcnNlIHNjZW5hcmlvICovXG4gICk7XG59O1xuXG4vKipcbiAqIERldGVybWluZSBtb25vcmVwbyByb290IHBhdGggYnkgZG9pbmcgc29tZSBoYWNreSBjdXJyZW50IGFuZFxuICogc29tZSBwYXJlbnQgZGlyZWN0b3JpZXMgc2Nhbm5pbmcgYW5kIGxvb2tpbmcgZm9yIG1hcmtlciBmaWxlcy9kaXJzXG4gKiBsaWtlOlxuICpcbiAqIC0gLmdpdFxuICogLSBwYWNrYWdlLWxvY2suanNvblxuICogLSB5YXJuLmxvY2tcbiAqIC0gcG5wbS1sb2NrLnlhbWxcbiAqIC0gcG5wbS13b3Jrc3BhY2UueWFtbFxuICovXG5leHBvcnQgY29uc3QgbW9ub3JlcG9Sb290UGF0aCA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHJvb3RQYXRoID0gYXdhaXQgZ2V0TW9ub3JlcG9Sb290VmlhRGlyZWN0b3J5U2Nhbihwcm9jZXNzLmN3ZCgpKTtcbiAgcmV0dXJuIHJvb3RQYXRoO1xufSk7XG4iLCJpbXBvcnQgeyBzdGF0IH0gZnJvbSAnZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgdHlwZSB7IFNwYXduT3B0aW9uc1dpdGhFeHRyYSB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgeyBzcGF3bldpdGhPdXRwdXRXaGVuRmFpbGVkIH0gZnJvbSAnLi9jaGlsZC1wcm9jZXNzJztcbmltcG9ydCB0eXBlIHsgU3Bhd25SZXN1bHRPcHRzIH0gZnJvbSAnLi9jaGlsZC1wcm9jZXNzL3NwYXduUmVzdWx0JztcbmltcG9ydCB7IG1vZHVsZXNCaW5QYXRoIH0gZnJvbSAnLi91dGlscy9tb2R1bGVzQmluUGF0aCc7XG5pbXBvcnQgeyBtb25vcmVwb1Jvb3RQYXRoIH0gZnJvbSAnLi91dGlscy9tb25vcmVwb1Jvb3RQYXRoJztcblxuZXhwb3J0IHR5cGUgVGFza1R5cGVzID1cbiAgfCAnbGludCdcbiAgfCAnYnVpbGQnXG4gIHwgJ3Rlc3QnXG4gIHwgJ2RlY2xhcmF0aW9ucydcbiAgfCAnaW50ZWdyYXRpb24nXG4gIHwgJ3NldHVwOmludGVncmF0aW9uJ1xuICB8IChzdHJpbmcgJiB7XG4gICAgICBfYWxsb3dTdHJpbmdzPzogdW5kZWZpbmVkO1xuICAgIH0pO1xuXG5jb25zdCB0dXJib1BhdGggPSAoKSA9PiBtb2R1bGVzQmluUGF0aCgndHVyYm8nKTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhc1R1cmJvSnNvbigpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgY29uc3QgY3dkID0gYXdhaXQgbW9ub3JlcG9Sb290UGF0aCgpO1xuICByZXR1cm4gYXdhaXQgc3RhdChqb2luKGN3ZCwgJ3R1cmJvLmpzb24nKSlcbiAgICAudGhlbigocmVzKSA9PiByZXMuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbn1cblxuLyoqXG4gKiBSdW4gb25lIG9mIHRoZSBkZXYgcGlwZWxpbmUgdGFza3MgdXNpbmcgVHVyYm8gZm9yIGEgc2luZ2xlIHBhY2thZ2VcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlKG9wdHM6IHtcbiAgdGFza3M6IFtUYXNrVHlwZXMsIC4uLlRhc2tUeXBlc1tdXTtcbiAgcGFja2FnZURpcj86IHN0cmluZztcbiAgc3Bhd25PcHRzOiBPbWl0PFNwYXduT3B0aW9uc1dpdGhFeHRyYTxTcGF3blJlc3VsdE9wdHM+LCAnY3dkJz47XG59KSB7XG4gIGNvbnN0IHJvb3REaXIgPSBvcHRzLnBhY2thZ2VEaXIgPz8gcHJvY2Vzcy5jd2QoKTtcbiAgY29uc3QgY3dkID0gYXdhaXQgbW9ub3JlcG9Sb290UGF0aCgpO1xuICBhd2FpdCBzcGF3bldpdGhPdXRwdXRXaGVuRmFpbGVkKFxuICAgIHR1cmJvUGF0aCgpLFxuICAgIFtcbiAgICAgICdydW4nLFxuICAgICAgLi4ub3B0cy50YXNrcyxcbiAgICAgICctLWZpbHRlcj0nICsgcm9vdERpci5yZXBsYWNlKGN3ZCwgJy4nKSxcbiAgICAgICctLW91dHB1dC1sb2dzPW5ldy1vbmx5JyxcbiAgICBdLFxuICAgIHtcbiAgICAgIC4uLm9wdHMuc3Bhd25PcHRzLFxuICAgICAgY3dkLFxuICAgIH1cbiAgKTtcbn1cbiIsImltcG9ydCB0eXBlIHsgQ29uZmlnIH0gZnJvbSAnQGplc3QvdHlwZXMnO1xuaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHsgc3Bhd25XaXRoT3V0cHV0V2hlbkZhaWxlZCB9IGZyb20gJy4uL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmltcG9ydCB7IHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlIH0gZnJvbSAnLi4vdHVyYm8nO1xuXG5hc3luYyBmdW5jdGlvbiBsb2FkU3RhbmRhcmRHbG9iYWxIb29rKFxuICBzY3JpcHQ6IHN0cmluZyxcbiAgZ2xvYmFsQ29uZmlnOiBDb25maWcuR2xvYmFsQ29uZmlnLFxuICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZ1xuKSB7XG4gIGNvbnN0IGhhc0hvb2sgPSBhd2FpdCBzdGF0KHNjcmlwdClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbiAgcmV0dXJuIHtcbiAgICBoYXNIb29rLFxuICAgIGV4ZWN1dGU6IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghaGFzSG9vaykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBsb2NhdGlvbiA9IGpvaW4ocHJvY2Vzcy5jd2QoKSwgc2NyaXB0KTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IChhd2FpdCBpbXBvcnQobG9jYXRpb24pKSBhc1xuICAgICAgICB8IHtcbiAgICAgICAgICAgIGRlZmF1bHQ/OiAoXG4gICAgICAgICAgICAgIGdsb2JhbENvbmZpZzogQ29uZmlnLkdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgICAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWdcbiAgICAgICAgICAgICkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgICAgICAgICB9XG4gICAgICAgIHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKCFyZXN1bHQgfHwgIXJlc3VsdC5kZWZhdWx0KSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGDimqDvuI8gTm8gZGVmYXVsdCBleHBvcnQgZm91bmQgaW4gXCIke3NjcmlwdH1cImApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBhd2FpdCBQcm9taXNlLnJlc29sdmUocmVzdWx0LmRlZmF1bHQoZ2xvYmFsQ29uZmlnLCBwcm9qZWN0Q29uZmlnKSk7XG4gICAgfSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEN1c3RvbUdsb2JhbEhvb2soc2NyaXB0OiBzdHJpbmcpIHtcbiAgY29uc3QgaGFzSG9vayA9IGF3YWl0IHN0YXQoc2NyaXB0KVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuICByZXR1cm4ge1xuICAgIGhhc0hvb2ssXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFoYXNIb29rKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxvY2F0aW9uID0gam9pbihwcm9jZXNzLmN3ZCgpLCBzY3JpcHQpO1xuICAgICAgY29uc3QgcGFja2FnZUpzb24gPSBhd2FpdCByZWFkUGFja2FnZUpzb24oXG4gICAgICAgIGpvaW4ocHJvY2Vzcy5jd2QoKSwgJ3BhY2thZ2UuanNvbicpXG4gICAgICApO1xuICAgICAgaWYgKFxuICAgICAgICBzY3JpcHQuZW5kc1dpdGgoJ3NldHVwLnRzJykgJiZcbiAgICAgICAgdHlwZW9mIHBhY2thZ2VKc29uWydzY3JpcHRzJ10gPT09ICdvYmplY3QnICYmXG4gICAgICAgIHBhY2thZ2VKc29uWydzY3JpcHRzJ11bJ3NldHVwOmludGVncmF0aW9uJ10gPT09IGB0c3ggJHtzY3JpcHR9YFxuICAgICAgKSB7XG4gICAgICAgIGF3YWl0IHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlKHtcbiAgICAgICAgICB0YXNrczogWydzZXR1cDppbnRlZ3JhdGlvbiddLFxuICAgICAgICAgIHNwYXduT3B0czoge1xuICAgICAgICAgICAgZXhpdENvZGVzOiBbMF0sXG4gICAgICAgICAgICBlbnY6IHtcbiAgICAgICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgICAgIExPR19MRVZFTDogbG9nZ2VyLmxvZ0xldmVsLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHNwYXduV2l0aE91dHB1dFdoZW5GYWlsZWQoJ3RzeCcsIFtsb2NhdGlvbl0sIHtcbiAgICAgICAgICBleGl0Q29kZXM6IFswXSxcbiAgICAgICAgICBlbnY6IHtcbiAgICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgICAgTE9HX0xFVkVMOiBsb2dnZXIubG9nTGV2ZWwsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRBbmRSdW5HbG9iYWxIb29rKFxuICBzY3JpcHQ6IHN0cmluZyxcbiAgZ2xvYmFsQ29uZmlnOiBDb25maWcuR2xvYmFsQ29uZmlnLFxuICBwcm9qZWN0Q29uZmlnOiBDb25maWcuUHJvamVjdENvbmZpZyxcbiAgdGlwPzogc3RyaW5nXG4pIHtcbiAgY29uc3QgW3N0YW5kYXJkLCBjdXN0b21dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIGxvYWRTdGFuZGFyZEdsb2JhbEhvb2soYCR7c2NyaXB0fS5tanNgLCBnbG9iYWxDb25maWcsIHByb2plY3RDb25maWcpLFxuICAgIGxvYWRDdXN0b21HbG9iYWxIb29rKGAke3NjcmlwdH0udHNgKSxcbiAgXSk7XG4gIGlmICghY3VzdG9tLmhhc0hvb2sgJiYgdGlwKSB7XG4gICAgbG9nZ2VyLnRpcCh0aXApO1xuICB9XG4gIGF3YWl0IHN0YW5kYXJkLmV4ZWN1dGUoKTtcbiAgYXdhaXQgY3VzdG9tLmV4ZWN1dGUoKTtcbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUFPLFNBQUEsSUFBQSxDQUFpQixFQUFzQixFQUFBO0FBQzVDLEVBQUksSUFBQSxLQUFBLENBQUE7QUFDSixFQUFBLElBQUksVUFBYSxHQUFBLEtBQUEsQ0FBQTtBQUNqQixFQUFBLE9BQU8sTUFBUztBQUNkLElBQUEsSUFBSSxV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
