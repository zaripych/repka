// This file is bundled up from './src/*' and needs to be committed
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import 'node:console';
import { ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
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

var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
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
const verbosityOpt = (args = process.argv) => {
  const index = args.findIndex((value) => value === "--verbosity");
  if (index === -1) {
    return "info";
  }
  const level = args[index + 1];
  if (level === "silent" || level === "off") {
    return "off";
  }
  if (!isLevel(level)) {
    return "info";
  }
  return level;
};
const enabledLevels = once(() => enabledLevelsAfter(verbosityOpt()));
const noop = (..._args) => {
  return;
};
const log = (...args) => {
  console.log(...args);
};
const error = (...args) => {
  console.error(...args);
};
const createLogger = (enabled = enabledLevels()) => {
  return levels.reduce((acc, lvl) => {
    return __spreadProps(__spreadValues({}, acc), {
      [lvl]: enabled.includes(lvl) ? ["fatal", "error"].includes(lvl) ? error : log : noop
    });
  }, {
    log: enabled.includes("info") ? log : noop
  });
};
const logger = Object.freeze(createLogger());

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
  const exitCodes = (opts == null ? void 0 : opts.exitCodes) || "inherit";
  const cwd = (opts == null ? void 0 : opts.cwd) ? opts.cwd.toString() : void 0;
  const cmd = () => [command, ...args ? args : []].join(" ");
  logger.log([">", cmd()].join(" "), ...cwd ? [`in ${cwd}`] : []);
  await new Promise((res, rej) => child.on("close", (code, signal) => {
    if (typeof code === "number") {
      if (exitCodes !== "inherit" && !exitCodes.includes(code)) {
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

async function readPackageJson(path) {
  return await readFile(path, "utf-8").then((result) => JSON.parse(result));
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
async function runTurboTasks(opts) {
  const rootDir = opts.packageDir ?? process.cwd();
  const root = await monorepoRootPath();
  await spawnToPromise(turboPath(), [
    "run",
    ...opts.tasks,
    "--filter=" + rootDir.replace(root, "."),
    "--output-logs=new-only"
  ], {
    stdio: "inherit",
    cwd: root
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
        logger.log(`\u26A0\uFE0F No default export found in "${script}"`);
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
      if (script.endsWith("setup.ts") && typeof packageJson["scripts"] === "object" && packageJson["scripts"] !== null && packageJson["scripts"]["setup:integration"] === `tsx ${script}`) {
        await runTurboTasks({
          tasks: ["setup:integration"]
        });
      } else {
        await spawnToPromise("tsx", [location], {
          stdio: "inherit",
          exitCodes: [0]
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
    logger.log(tip);
  }
  await standard.execute();
  await custom.execute();
}

export { loadAndRunGlobalHook };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9hZEFuZFJ1bkdsb2JhbEhvb2suZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWxzL29uY2UudHMiLCIuLi8uLi9zcmMvbG9nZ2VyL2xvZ2dlci50cyIsIi4uLy4uL3NyYy91dGlscy9zdGFja1RyYWNlLnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25Ub1Byb21pc2UudHMiLCIuLi8uLi9zcmMvdXRpbHMvb25jZUFzeW5jLnRzIiwiLi4vLi4vc3JjL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24udHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeS50cyIsIi4uLy4uL3NyYy91dGlscy9tb2R1bGVzQmluUGF0aC50cyIsIi4uLy4uL3NyYy91dGlscy9pc1RydXRoeS50cyIsIi4uLy4uL3NyYy91dGlscy9tb25vcmVwb1Jvb3RQYXRoLnRzIiwiLi4vLi4vc3JjL3J1blR1cmJvVGFza3MudHMiLCIuLi8uLi9zcmMvamVzdC9sb2FkQW5kUnVuR2xvYmFsSG9vay50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZnVuY3Rpb24gb25jZTxUPihmbjogKCkgPT4gVCk6ICgpID0+IFQge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiAoKTogVCA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdmFsdWUgPSBmbigpO1xuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImltcG9ydCB7IG9uY2UgfSBmcm9tICcuLi91dGlscy9vbmNlJztcblxuY29uc3QgbGV2ZWxzID0gWydkZWJ1ZycsICdpbmZvJywgJ3dhcm4nLCAnZXJyb3InLCAnZmF0YWwnXSBhcyBjb25zdDtcblxudHlwZSBMb2dMZXZlbCA9IHR5cGVvZiBsZXZlbHNbbnVtYmVyXTtcblxudHlwZSBQYXJhbXMgPSBQYXJhbWV0ZXJzPHR5cGVvZiBjb25zb2xlLmxvZz47XG5cbnR5cGUgTG9nZ2VyID0ge1xuICBkZWJ1ZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGluZm8oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgZXJyb3IoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBmYXRhbCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG59O1xuXG5jb25zdCBlbmFibGVkTGV2ZWxzQWZ0ZXIgPSAobGV2ZWw6IExvZ0xldmVsIHwgJ29mZicpID0+IHtcbiAgaWYgKGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuICBjb25zdCBpbmRleCA9IGxldmVscy5maW5kSW5kZXgoKGl0ZW0pID0+IGl0ZW0gPT09IGxldmVsKTtcbiAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBsZXZlbCcpO1xuICB9XG4gIHJldHVybiBsZXZlbHMuc2xpY2UoaW5kZXgpO1xufTtcblxuY29uc3QgaXNMZXZlbCA9IChsZXZlbD86IHN0cmluZyk6IGxldmVsIGlzIExvZ0xldmVsID0+IHtcbiAgcmV0dXJuIGxldmVscy5pbmNsdWRlcyhsZXZlbCBhcyBMb2dMZXZlbCk7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlPcHQgPSAoYXJncyA9IHByb2Nlc3MuYXJndik6IExvZ0xldmVsIHwgJ29mZicgPT4ge1xuICBjb25zdCBpbmRleCA9IGFyZ3MuZmluZEluZGV4KCh2YWx1ZSkgPT4gdmFsdWUgPT09ICctLXZlcmJvc2l0eScpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgcmV0dXJuICdpbmZvJztcbiAgfVxuICBjb25zdCBsZXZlbCA9IGFyZ3NbaW5kZXggKyAxXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiAnaW5mbyc7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgZW5hYmxlZExldmVscyA9IG9uY2UoKCkgPT4gZW5hYmxlZExldmVsc0FmdGVyKHZlcmJvc2l0eU9wdCgpKSk7XG5cbmNvbnN0IG5vb3AgPSAoLi4uX2FyZ3M6IFBhcmFtcykgPT4ge1xuICByZXR1cm47XG59O1xuXG5jb25zdCBsb2cgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XG4gIGNvbnNvbGUubG9nKC4uLmFyZ3MpO1xufTtcblxuY29uc3QgZXJyb3IgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XG4gIGNvbnNvbGUuZXJyb3IoLi4uYXJncyk7XG59O1xuXG5jb25zdCBjcmVhdGVMb2dnZXIgPSAoZW5hYmxlZCA9IGVuYWJsZWRMZXZlbHMoKSkgPT4ge1xuICByZXR1cm4gbGV2ZWxzLnJlZHVjZShcbiAgICAoYWNjLCBsdmwpID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmFjYyxcbiAgICAgICAgW2x2bF06IGVuYWJsZWQuaW5jbHVkZXMobHZsKVxuICAgICAgICAgID8gWydmYXRhbCcsICdlcnJvciddLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICAgID8gZXJyb3JcbiAgICAgICAgICAgIDogbG9nXG4gICAgICAgICAgOiBub29wLFxuICAgICAgfTtcbiAgICB9LFxuICAgIHtcbiAgICAgIGxvZzogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpID8gbG9nIDogbm9vcCxcbiAgICB9IGFzIExvZ2dlclxuICApO1xufTtcblxuZXhwb3J0IGNvbnN0IGxvZ2dlcjogTG9nZ2VyID0gT2JqZWN0LmZyZWV6ZShjcmVhdGVMb2dnZXIoKSk7XG4iLCIvKipcbiAqIENhcHR1cmUgdGhlIHN0YWNrIHRyYWNlIGFuZCBhbGxvdyB0byBlbnJpY2ggZXhjZXB0aW9ucyB0aHJvd24gaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrc1xuICogd2l0aCBhZGRpdGlvbmFsIHN0YWNrIGluZm9ybWF0aW9uIGNhcHR1cmVkIGF0IHRoZSBtb21lbnQgb2YgdGhlIGNhbGwgb2YgdGhpcyBmdW5jdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZVN0YWNrVHJhY2UocmVtb3ZlID0gMCkge1xuICBjb25zdCBzdGFja0NvbnRhaW5lciA9IHtcbiAgICBzdGFjazogJycsXG4gIH07XG4gIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHN0YWNrQ29udGFpbmVyKTtcbiAgY29uc3Qgc3RhY2tUcmFjZSA9IHN0YWNrQ29udGFpbmVyLnN0YWNrXG4gICAgLnNwbGl0KCdcXG4nKVxuICAgIC5zbGljZSg2ICsgcmVtb3ZlKVxuICAgIC5qb2luKCdcXG4nKTtcbiAgcmV0dXJuIHtcbiAgICAvKipcbiAgICAgKiBDYXB0dXJlZCBzdGFjayB0cmFjZSBpbmZvcm1hdGlvblxuICAgICAqL1xuICAgIHN0YWNrVHJhY2UsXG4gICAgLyoqXG4gICAgICogQ2FuIGJlIGNhbGxlZCBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2sgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgd2l0aCBhZGRpdGlvbmFsIGluZm9ybWF0aW9uXG4gICAgICogQHBhcmFtIGVyciBFeGNlcHRpb24gdG8gZW5yaWNoIC0gaXQgaXMgZ29pbmcgdG8gaGF2ZSBpdHMgYC5zdGFja2AgcHJvcCBtdXRhdGVkXG4gICAgICogQHJldHVybnMgU2FtZSBleGNlcHRpb25cbiAgICAgKi9cbiAgICBwcmVwYXJlRm9yUmV0aHJvdzogKGVycjogRXJyb3IpID0+IHtcbiAgICAgIGNvbnN0IG9sZFN0YWNrVHJhY2UgPSBlcnIuc3RhY2sgPz8gJycuc3BsaXQoJ1xcbicpLnNsaWNlKDEpLmpvaW4oJ1xcbicpO1xuICAgICAgZXJyLnN0YWNrID0gYCR7ZXJyLm5hbWUgfHwgJ0Vycm9yJ306ICR7XG4gICAgICAgIGVyci5tZXNzYWdlXG4gICAgICB9XFxuJHtvbGRTdGFja1RyYWNlfVxcbiR7c3RhY2tUcmFjZX1gO1xuICAgICAgcmV0dXJuIGVycjtcbiAgICB9LFxuICB9O1xufVxuIiwiaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IENoaWxkUHJvY2VzcyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB0eXBlIHsgQXNzaWduIH0gZnJvbSAndXRpbGl0eS10eXBlcyc7XG5cbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgY2FwdHVyZVN0YWNrVHJhY2UgfSBmcm9tICcuLi91dGlscy9zdGFja1RyYWNlJztcblxuZXhwb3J0IHR5cGUgU3Bhd25Ub1Byb21pc2VFeHRyYSA9IHtcbiAgZXhpdENvZGVzPzogbnVtYmVyW10gfCAnaW5oZXJpdCc7XG59O1xuXG50eXBlIFNoYXJlZE9wdHMgPSBQaWNrPFNwYXduT3B0aW9ucywgJ2N3ZCc+O1xuXG50eXBlIFNwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PiA9IFtcbiAgY29tbWFuZDogc3RyaW5nLFxuICBhcmdzPzogUmVhZG9ubHlBcnJheTxzdHJpbmc+LFxuICBvcHRpb25zPzogQXNzaWduPFNwYXduT3B0aW9ucywgRT5cbl07XG5cbmV4cG9ydCB0eXBlIFNwYXduUGFyYW1ldGVyTWl4PEUgZXh0ZW5kcyBvYmplY3QgPSBTcGF3blRvUHJvbWlzZUV4dHJhPiA9XG4gIHwgW2NwOiBDaGlsZFByb2Nlc3MsIGV4dHJhT3B0cz86IEFzc2lnbjxFLCBTaGFyZWRPcHRzPl1cbiAgfCBTcGF3bkFyZ3M8RT47XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgYXJnczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbik6IGFyZ3MgaXMgU3Bhd25BcmdzPEU+IHtcbiAgcmV0dXJuICEoYXJnc1swXSBpbnN0YW5jZW9mIENoaWxkUHJvY2VzcykgJiYgdHlwZW9mIGFyZ3NbMF0gPT09ICdzdHJpbmcnO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzPEUgZXh0ZW5kcyBvYmplY3Q+KFxuICBwYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxFPlxuKSB7XG4gIGNvbnN0IFtjaGlsZCwgW2NvbW1hbmQsIGFyZ3MsIG9wdHNdXSA9IGlzU3Bhd25BcmdzKHBhcmFtZXRlcnMpXG4gICAgPyBbXG4gICAgICAgIHNwYXduKC4uLihwYXJhbWV0ZXJzIGFzIHVua25vd24gYXMgUGFyYW1ldGVyczx0eXBlb2Ygc3Bhd24+KSksXG4gICAgICAgIHBhcmFtZXRlcnMsXG4gICAgICBdXG4gICAgOiBbXG4gICAgICAgIHBhcmFtZXRlcnNbMF0sXG4gICAgICAgIFtcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduZmlsZSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduYXJncy5zbGljZSgxKSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzFdIGFzIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+LFxuICAgICAgICBdLFxuICAgICAgXTtcbiAgcmV0dXJuIHtcbiAgICBjaGlsZCxcbiAgICBjb21tYW5kLFxuICAgIGFyZ3MsXG4gICAgb3B0cyxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduVG9Qcm9taXNlKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHsgY2hpbGQsIGNvbW1hbmQsIGFyZ3MsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgeyBwcmVwYXJlRm9yUmV0aHJvdyB9ID0gY2FwdHVyZVN0YWNrVHJhY2UoKTtcblxuICAvLyBieSBkZWZhdWx0IHdlIGRvIG5vdCB0aHJvdyBpZiBleGl0IGNvZGUgaXMgbm9uLXplcm9cbiAgLy8gYW5kIGluc3RlYWQganVzdCBpbmhlcml0IHRoZSBleGl0IGNvZGUgaW50byB0aGUgbWFpblxuICAvLyBwcm9jZXNzXG4gIGNvbnN0IGV4aXRDb2RlcyA9IG9wdHM/LmV4aXRDb2RlcyB8fCAnaW5oZXJpdCc7XG5cbiAgY29uc3QgY3dkID0gb3B0cz8uY3dkID8gb3B0cy5jd2QudG9TdHJpbmcoKSA6IHVuZGVmaW5lZDtcblxuICBjb25zdCBjbWQgPSAoKSA9PiBbY29tbWFuZCwgLi4uKGFyZ3MgPyBhcmdzIDogW10pXS5qb2luKCcgJyk7XG5cbiAgbG9nZ2VyLmxvZyhbJz4nLCBjbWQoKV0uam9pbignICcpLCAuLi4oY3dkID8gW2BpbiAke2N3ZH1gXSA6IFtdKSk7XG5cbiAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlcywgcmVqKSA9PlxuICAgIGNoaWxkXG4gICAgICAub24oJ2Nsb3NlJywgKGNvZGUsIHNpZ25hbCkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIGNvZGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgaWYgKGV4aXRDb2RlcyAhPT0gJ2luaGVyaXQnICYmICFleGl0Q29kZXMuaW5jbHVkZXMoY29kZSkpIHtcbiAgICAgICAgICAgIHJlaihcbiAgICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3coXG4gICAgICAgICAgICAgICAgbmV3IEVycm9yKGBDb21tYW5kIFwiJHtjbWQoKX1cIiBoYXMgZmFpbGVkIHdpdGggY29kZSAke2NvZGV9YClcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHNpZ25hbCkge1xuICAgICAgICAgIHJlaihcbiAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICBuZXcgRXJyb3IoYEZhaWxlZCB0byBleGVjdXRlIGNvbW1hbmQgXCIke2NtZCgpfVwiIC0gJHtzaWduYWx9YClcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IHByZXBhcmVGb3JSZXRocm93KG5ldyBFcnJvcignRXhwZWN0ZWQgc2lnbmFsIG9yIGVycm9yIGNvZGUnKSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAub24oJ2Vycm9yJywgcmVqKVxuICApO1xuICAvLyBpbmhlcml0IGV4aXQgY29kZVxuICBpZiAoZXhpdENvZGVzID09PSAnaW5oZXJpdCcpIHtcbiAgICBpZiAoXG4gICAgICB0eXBlb2YgY2hpbGQuZXhpdENvZGUgPT09ICdudW1iZXInICYmXG4gICAgICAodHlwZW9mIHByb2Nlc3MuZXhpdENvZGUgIT09ICdudW1iZXInIHx8IHByb2Nlc3MuZXhpdENvZGUgPT09IDApXG4gICAgKSB7XG4gICAgICBwcm9jZXNzLmV4aXRDb2RlID0gY2hpbGQuZXhpdENvZGU7XG4gICAgfVxuICB9XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZUFzeW5jPFQ+KGZuOiAoKSA9PiBUIHwgUHJvbWlzZTxUPik6ICgpID0+IFByb21pc2U8VD4ge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBpbkZsaWdodDogUHJvbWlzZTxUPiB8IG51bGw7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiBhc3luYyAoKTogUHJvbWlzZTxUPiA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKGluRmxpZ2h0KSB7XG4gICAgICByZXR1cm4gaW5GbGlnaHQ7XG4gICAgfVxuICAgIGluRmxpZ2h0ID0gUHJvbWlzZS5yZXNvbHZlKGZuKCkpO1xuICAgIHZhbHVlID0gYXdhaXQgaW5GbGlnaHQ7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgaW5GbGlnaHQgPSBudWxsO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnLi4vdXRpbHMvb25jZUFzeW5jJztcbmltcG9ydCB0eXBlIHsgUGFja2FnZUpzb24gfSBmcm9tICcuL3BhY2thZ2VKc29uJztcblxuY29uc3QgY3dkUGFja2FnZUpzb25QYXRoID0gKCkgPT4gam9pbihwcm9jZXNzLmN3ZCgpLCAnLi9wYWNrYWdlLmpzb24nKTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbihwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIHJldHVybiBhd2FpdCByZWFkRmlsZShwYXRoLCAndXRmLTgnKS50aGVuKFxuICAgIChyZXN1bHQpID0+IEpTT04ucGFyc2UocmVzdWx0KSBhcyBQYWNrYWdlSnNvblxuICApO1xufVxuXG5leHBvcnQgY29uc3QgcmVhZEN3ZFBhY2thZ2VKc29uID0gb25jZUFzeW5jKCgpID0+XG4gIHJlYWRQYWNrYWdlSnNvbihjd2RQYWNrYWdlSnNvblBhdGgoKSlcbik7XG4iLCJpbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmltcG9ydCB7IG9uY2UgfSBmcm9tICcuL29uY2UnO1xuXG5leHBvcnQgY29uc3QgZ2V0TW9kdWxlUm9vdERpcmVjdG9yeUZvckltcG9ydE1ldGFVcmwgPSAob3B0czoge1xuICBpbXBvcnRNZXRhVXJsOiBzdHJpbmc7XG59KSA9PiB7XG4gIC8vIHRoaXMgaXMgaGlnaGx5IGRlcGVuZGVudCBvbiB0aGUgb3V0cHV0IGRpcmVjdG9yeSBzdHJ1Y3R1cmVcbiAgLy8gYW5kIHRoZSBjb250ZXh0IGluIHdoaWNoIHRoaXMgZnVuY3Rpb24gaXMgcnVuIChidW5kbGVkIGNvZGUgdnMgdHN4IC4vc3JjL3RzZmlsZS50cylcbiAgY29uc3QgX19maWxlTmFtZSA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChvcHRzLmltcG9ydE1ldGFVcmwpKTtcbiAgY29uc3QgcGFyZW50ID0gZGlybmFtZShfX2ZpbGVOYW1lKTtcbiAgY29uc3Qgc3VwZXJQYXJlbnQgPSBkaXJuYW1lKHBhcmVudCk7XG5cbiAgY29uc3QgaXNCdW5kbGVkSW5EaXN0ID0gKCkgPT4gcGFyZW50LmVuZHNXaXRoKCcvZGlzdCcpO1xuICBjb25zdCBpc0J1bmRsZWRJbkJpbiA9ICgpID0+XG4gICAgcGFyZW50LmVuZHNXaXRoKCcvYmluJykgJiYgIXN1cGVyUGFyZW50LmVuZHNXaXRoKCcvc3JjJyk7XG5cbiAgaWYgKGlzQnVuZGxlZEluRGlzdCgpIHx8IGlzQnVuZGxlZEluQmluKCkpIHtcbiAgICByZXR1cm4gZmlsZVVSTFRvUGF0aChuZXcgVVJMKGAuLi9gLCBvcHRzLmltcG9ydE1ldGFVcmwpKTtcbiAgfVxuXG4gIC8vIHJ1biB2aWEgdHN4IHRvIGJ1aWxkIHRoZSBAYnVpbGQtdG9vbHMvdHMgaXRzZWxmXG4gIHJldHVybiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uLy4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpO1xufTtcblxuZXhwb3J0IGNvbnN0IG1vZHVsZVJvb3REaXJlY3RvcnkgPSBvbmNlKCgpID0+XG4gIGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsKHsgaW1wb3J0TWV0YVVybDogaW1wb3J0Lm1ldGEudXJsIH0pXG4pO1xuIiwiaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuL21vZHVsZVJvb3REaXJlY3RvcnknO1xuXG5leHBvcnQgZnVuY3Rpb24gbW9kdWxlc0JpblBhdGgoYmluOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGpvaW4obW9kdWxlUm9vdERpcmVjdG9yeSgpLCBgLi9ub2RlX21vZHVsZXMvLmJpbi8ke2Jpbn1gKTtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBpc1RydXRoeTxUPihcbiAgdmFsdWU6IE5vbk51bGxhYmxlPFQ+IHwgZmFsc2UgfCBudWxsIHwgdW5kZWZpbmVkIHwgJycgfCAwXG4pOiB2YWx1ZSBpcyBOb25OdWxsYWJsZTxUPiB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlKTtcbn1cbiIsImltcG9ydCBhc3NlcnQgZnJvbSAnYXNzZXJ0JztcbmltcG9ydCBmZyBmcm9tICdmYXN0LWdsb2InO1xuaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgeyBpc1RydXRoeSB9IGZyb20gJy4vaXNUcnV0aHknO1xuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnLi9vbmNlQXN5bmMnO1xuXG5jb25zdCBnZXRNb25vcmVwb1Jvb3RTY2FuQ2FuZGlkYXRlcyA9IChjdXJyZW50RGlyZWN0b3J5OiBzdHJpbmcpID0+IHtcbiAgLy8gaGF2aW5nICdwYWNrYWdlcy8qJyBpbiB0aGUgcm9vdCBvZiBhIG1vbm9yZXBvIGlzIHN1cGVyIGNvbW1vblxuICBjb25zdCByZXN1bHQgPSAvKC4qKD89XFwvcGFja2FnZXNcXC8pKXwoLiooPz1cXC9ub2RlX21vZHVsZXNcXC8pKXwoLiopLy5leGVjKFxuICAgIGN1cnJlbnREaXJlY3RvcnlcbiAgKTtcbiAgYXNzZXJ0KCEhcmVzdWx0KTtcbiAgY29uc3QgWywgcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdID0gcmVzdWx0O1xuICByZXR1cm4gW3BhY2thZ2VzUm9vdCwgbm9kZU1vZHVsZXNSb290XS5maWx0ZXIoaXNUcnV0aHkpO1xufTtcblxuLy8gcmV0dXJucyB0aGUgZmlyc3QgZGlyZWN0b3J5IHdoaWNoIGhhcyBtb25vcmVwbyBtYXJrZXJzLCBtdWx0aXBsZVxuLy8gZGlyZWN0b3JpZXMgY2FuIGhhdmUgdGhlbSAtIHdoaWNoZXZlciByZWFkIGZpcnN0IHdpbGwgYmUgcmV0dXJuZWRcbi8vIHNvIGlmIG9yZGVyIGlzIGltcG9ydGFudCAtIHNjYW5uaW5nIHNob3VsZCBiZSBzZXBhcmF0ZWQgdG8gbXVsdGlwbGUgam9ic1xuLy8gdmlhIHByaW9yaXRpemVkSGFzTW9ub3JlcG9NYXJrZXJzXG5jb25zdCBoYXNNb25vcmVwb01hcmtlcnMgPSBhc3luYyAoY2FuZGlkYXRlczogc3RyaW5nW10pID0+IHtcbiAgY29uc3QgbWFya2VycyA9IFtcbiAgICAnLmdpdCcsXG4gICAgJ3lhcm4ubG9jaycsXG4gICAgJ3BucG0tbG9jay55YW1sJyxcbiAgICAncGFja2FnZS1sb2NrLmpzb24nLFxuICAgICdwbnBtLXdvcmtzcGFjZS55YW1sJyxcbiAgXTtcbiAgY29uc3QgbWFya2Vyc1N0cmVhbSA9IGZnLnN0cmVhbShcbiAgICBjYW5kaWRhdGVzLmZsYXRNYXAoKGRpcikgPT4gbWFya2Vycy5tYXAoKG1hcmtlcikgPT4gam9pbihkaXIsIG1hcmtlcikpKSxcbiAgICB7XG4gICAgICBtYXJrRGlyZWN0b3JpZXM6IHRydWUsXG4gICAgICBvbmx5RmlsZXM6IGZhbHNlLFxuICAgIH1cbiAgKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4oKHJlcykgPT4ge1xuICAgIG1hcmtlcnNTdHJlYW0ub24oJ2RhdGEnLCAoZW50cnk6IHN0cmluZykgPT4ge1xuICAgICAgcmVzKGRpcm5hbWUoZW50cnkpKTtcbiAgICAgIGlmICgnZGVzdHJveScgaW4gbWFya2Vyc1N0cmVhbSkge1xuICAgICAgICAobWFya2Vyc1N0cmVhbSBhcyB1bmtub3duIGFzIHsgZGVzdHJveTogKCkgPT4gdm9pZCB9KS5kZXN0cm95KCk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgbWFya2Vyc1N0cmVhbS5vbignZW5kJywgKCkgPT4ge1xuICAgICAgcmVzKHVuZGVmaW5lZCk7XG4gICAgfSk7XG4gIH0pO1xufTtcblxuY29uc3QgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnMgPSAoam9iczogc3RyaW5nW11bXSkgPT4ge1xuICBpZiAoam9icy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gIH1cbiAgcmV0dXJuIG5ldyBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4oKHJlcykgPT4ge1xuICAgIGNvbnN0IHJlc3VsdHMgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nIHwgdW5kZWZpbmVkPigpO1xuXG4gICAgY29uc3QgY2hlY2tTaG91bGRDb21wbGV0ZSA9IChpbmRleDogbnVtYmVyLCByZXN1bHQ6IHN0cmluZyB8IHVuZGVmaW5lZCkgPT4ge1xuICAgICAgcmVzdWx0cy5zZXQoaW5kZXgsIHJlc3VsdCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGpvYnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3QgaGFzUmVzdWx0ID0gcmVzdWx0cy5oYXMoaSk7XG4gICAgICAgIGlmICghaGFzUmVzdWx0KSB7XG4gICAgICAgICAgLy8gaWYgYSBqb2Igd2l0aCBoaWdoZXN0IHByaW9yaXR5IGhhc24ndCBmaW5pc2hlZCB5ZXRcbiAgICAgICAgICAvLyB0aGVuIHdhaXQgZm9yIGl0XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzdWx0cy5nZXQoaSk7XG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAvLyBqb2IgZmluaXNoZWQgYW5kIHdlIGZvdW5kIG1hcmtlcnMsIGFsc28gYWxsIGpvYnNcbiAgICAgICAgICAvLyB3aXRoIGhpZ2hlciBwcmlvcml0eSBmaW5pc2hlZCBhbmQgdGhleSBkb24ndCBoYXZlXG4gICAgICAgICAgLy8gYW55IG1hcmtlcnMgLSB3ZSBhcmUgZG9uZVxuICAgICAgICAgIHJlcyhyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0cy5zaXplID09PSBqb2JzLmxlbmd0aCkge1xuICAgICAgICAvLyBhbGwgam9icyBmaW5pc2hlZCAtIG5vIG1hcmtlcnMgZm91bmRcbiAgICAgICAgcmVzKHVuZGVmaW5lZCk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGpvYnMuZm9yRWFjaCgoZGlyZWN0b3JpZXMsIGluZGV4KSA9PiB7XG4gICAgICBoYXNNb25vcmVwb01hcmtlcnMoZGlyZWN0b3JpZXMpXG4gICAgICAgIC50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgICBjaGVja1Nob3VsZENvbXBsZXRlKGluZGV4LCByZXN1bHQpO1xuICAgICAgICB9KVxuICAgICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgIC8vIGlnbm9yZVxuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufTtcblxuZXhwb3J0IGNvbnN0IGdldE1vbm9yZXBvUm9vdFZpYURpcmVjdG9yeVNjYW4gPSBhc3luYyAoXG4gIGxvb2t1cERpcmVjdG9yeTogc3RyaW5nXG4pID0+IHtcbiAgY29uc3QgdW5pcXVlRGlybmFtZSA9IChwYXRoPzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKCFwYXRoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGRpcm5hbWUocGF0aCk7XG4gICAgaWYgKHJlc3VsdCA9PT0gcGF0aCkge1xuICAgICAgLy8gZS5nLiB0aGUgcGF0aCB3YXMgYWxyZWFkeSBhIHJvb3QgXCIvXCJcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICBjb25zdCBwYXJlbnQgPSB1bmlxdWVEaXJuYW1lKGxvb2t1cERpcmVjdG9yeSk7XG4gIGNvbnN0IHN1cGVyUGFyZW50ID0gdW5pcXVlRGlybmFtZShwYXJlbnQpO1xuXG4gIHJldHVybiAoXG4gICAgKGF3YWl0IHByaW9yaXRpemVkSGFzTW9ub3JlcG9NYXJrZXJzKFxuICAgICAgLy8gc2NhbiBpbiBtb3N0IGxpa2VseSBsb2NhdGlvbnMgZmlyc3Qgd2l0aCBjdXJyZW50IGxvb2t1cCBkaXJlY3RvcnkgdGFraW5nIHByaW9yaXR5XG4gICAgICBbXG4gICAgICAgIFtsb29rdXBEaXJlY3RvcnldLFxuICAgICAgICBnZXRNb25vcmVwb1Jvb3RTY2FuQ2FuZGlkYXRlcyhsb29rdXBEaXJlY3RvcnkpLFxuICAgICAgICAvLyBzY2FuIDIgZGlyZWN0b3JpZXMgdXB3YXJkc1xuICAgICAgICBbcGFyZW50XSxcbiAgICAgICAgW3N1cGVyUGFyZW50XSxcbiAgICAgIF1cbiAgICAgICAgLm1hcCgoZGlycykgPT4gZGlycy5maWx0ZXIoaXNUcnV0aHkpKVxuICAgICAgICAuZmlsdGVyKChqb2IpID0+IGpvYi5sZW5ndGggPiAwKVxuICAgICkpIHx8IGxvb2t1cERpcmVjdG9yeSAvKiBmYWxsYmFjayB0byBjdXJyZW50IGRpcmVjdG9yeSBpbiB3b3JzZSBzY2VuYXJpbyAqL1xuICApO1xufTtcblxuLyoqXG4gKiBEZXRlcm1pbmUgbW9ub3JlcG8gcm9vdCBwYXRoIGJ5IGRvaW5nIHNvbWUgaGFja3kgY3VycmVudCBhbmRcbiAqIHNvbWUgcGFyZW50IGRpcmVjdG9yaWVzIHNjYW5uaW5nIGFuZCBsb29raW5nIGZvciBtYXJrZXIgZmlsZXMvZGlyc1xuICogbGlrZTpcbiAqXG4gKiAtIC5naXRcbiAqIC0gcGFja2FnZS1sb2NrLmpzb25cbiAqIC0geWFybi5sb2NrXG4gKiAtIHBucG0tbG9jay55YW1sXG4gKiAtIHBucG0td29ya3NwYWNlLnlhbWxcbiAqL1xuZXhwb3J0IGNvbnN0IG1vbm9yZXBvUm9vdFBhdGggPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290UGF0aCA9IGF3YWl0IGdldE1vbm9yZXBvUm9vdFZpYURpcmVjdG9yeVNjYW4ocHJvY2Vzcy5jd2QoKSk7XG4gIHJldHVybiByb290UGF0aDtcbn0pO1xuIiwiaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3Mvc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgbW9kdWxlc0JpblBhdGggfSBmcm9tICcuL3V0aWxzL21vZHVsZXNCaW5QYXRoJztcbmltcG9ydCB7IG1vbm9yZXBvUm9vdFBhdGggfSBmcm9tICcuL3V0aWxzL21vbm9yZXBvUm9vdFBhdGgnO1xuXG5leHBvcnQgdHlwZSBUYXNrVHlwZXMgPVxuICB8ICdsaW50J1xuICB8ICdidWlsZCdcbiAgfCAndGVzdCdcbiAgfCAnZGVjbGFyYXRpb25zJ1xuICB8ICdpbnRlZ3JhdGlvbidcbiAgfCAnc2V0dXA6aW50ZWdyYXRpb24nXG4gIHwgKHN0cmluZyAmIHtcbiAgICAgIF9hbGxvd1N0cmluZ3M/OiB1bmRlZmluZWQ7XG4gICAgfSk7XG5cbmNvbnN0IHR1cmJvUGF0aCA9ICgpID0+IG1vZHVsZXNCaW5QYXRoKCd0dXJibycpO1xuXG4vKipcbiAqIFJ1biBvbmUgb2YgdGhlIGRldiBwaXBlbGluZSB0YXNrcyB1c2luZyBUdXJib1xuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVHVyYm9UYXNrcyhvcHRzOiB7XG4gIHRhc2tzOiBbVGFza1R5cGVzLCAuLi5UYXNrVHlwZXNbXV07XG4gIHBhY2thZ2VEaXI/OiBzdHJpbmc7XG59KSB7XG4gIGNvbnN0IHJvb3REaXIgPSBvcHRzLnBhY2thZ2VEaXIgPz8gcHJvY2Vzcy5jd2QoKTtcbiAgY29uc3Qgcm9vdCA9IGF3YWl0IG1vbm9yZXBvUm9vdFBhdGgoKTtcbiAgYXdhaXQgc3Bhd25Ub1Byb21pc2UoXG4gICAgdHVyYm9QYXRoKCksXG4gICAgW1xuICAgICAgJ3J1bicsXG4gICAgICAuLi5vcHRzLnRhc2tzLFxuICAgICAgJy0tZmlsdGVyPScgKyByb290RGlyLnJlcGxhY2Uocm9vdCwgJy4nKSxcbiAgICAgICctLW91dHB1dC1sb2dzPW5ldy1vbmx5JyxcbiAgICBdLFxuICAgIHtcbiAgICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgICBjd2Q6IHJvb3QsXG4gICAgfVxuICApO1xufVxuIiwiaW1wb3J0IHR5cGUgeyBDb25maWcgfSBmcm9tICdAamVzdC90eXBlcyc7XG5pbXBvcnQgeyBzdGF0IH0gZnJvbSAnZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgeyBzcGF3blRvUHJvbWlzZSB9IGZyb20gJy4uL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmltcG9ydCB7IHJ1blR1cmJvVGFza3MgfSBmcm9tICcuLi9ydW5UdXJib1Rhc2tzJztcblxuYXN5bmMgZnVuY3Rpb24gbG9hZFN0YW5kYXJkR2xvYmFsSG9vayhcbiAgc2NyaXB0OiBzdHJpbmcsXG4gIGdsb2JhbENvbmZpZzogQ29uZmlnLkdsb2JhbENvbmZpZyxcbiAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWdcbikge1xuICBjb25zdCBoYXNIb29rID0gYXdhaXQgc3RhdChzY3JpcHQpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gcmVzdWx0LmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG4gIHJldHVybiB7XG4gICAgaGFzSG9vayxcbiAgICBleGVjdXRlOiBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIWhhc0hvb2spIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgbG9jYXRpb24gPSBqb2luKHByb2Nlc3MuY3dkKCksIHNjcmlwdCk7XG4gICAgICBjb25zdCByZXN1bHQgPSAoYXdhaXQgaW1wb3J0KGxvY2F0aW9uKSkgYXNcbiAgICAgICAgfCB7XG4gICAgICAgICAgICBkZWZhdWx0PzogKFxuICAgICAgICAgICAgICBnbG9iYWxDb25maWc6IENvbmZpZy5HbG9iYWxDb25maWcsXG4gICAgICAgICAgICAgIHByb2plY3RDb25maWc6IENvbmZpZy5Qcm9qZWN0Q29uZmlnXG4gICAgICAgICAgICApID0+IFByb21pc2U8dm9pZD47XG4gICAgICAgICAgfVxuICAgICAgICB8IHVuZGVmaW5lZDtcbiAgICAgIGlmICghcmVzdWx0IHx8ICFyZXN1bHQuZGVmYXVsdCkge1xuICAgICAgICBsb2dnZXIubG9nKGDimqDvuI8gTm8gZGVmYXVsdCBleHBvcnQgZm91bmQgaW4gXCIke3NjcmlwdH1cImApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBhd2FpdCBQcm9taXNlLnJlc29sdmUocmVzdWx0LmRlZmF1bHQoZ2xvYmFsQ29uZmlnLCBwcm9qZWN0Q29uZmlnKSk7XG4gICAgfSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEN1c3RvbUdsb2JhbEhvb2soc2NyaXB0OiBzdHJpbmcpIHtcbiAgY29uc3QgaGFzSG9vayA9IGF3YWl0IHN0YXQoc2NyaXB0KVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuICByZXR1cm4ge1xuICAgIGhhc0hvb2ssXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFoYXNIb29rKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxvY2F0aW9uID0gam9pbihwcm9jZXNzLmN3ZCgpLCBzY3JpcHQpO1xuICAgICAgY29uc3QgcGFja2FnZUpzb24gPSBhd2FpdCByZWFkUGFja2FnZUpzb24oXG4gICAgICAgIGpvaW4ocHJvY2Vzcy5jd2QoKSwgJ3BhY2thZ2UuanNvbicpXG4gICAgICApO1xuICAgICAgaWYgKFxuICAgICAgICBzY3JpcHQuZW5kc1dpdGgoJ3NldHVwLnRzJykgJiZcbiAgICAgICAgdHlwZW9mIHBhY2thZ2VKc29uWydzY3JpcHRzJ10gPT09ICdvYmplY3QnICYmXG4gICAgICAgIHBhY2thZ2VKc29uWydzY3JpcHRzJ10gIT09IG51bGwgJiZcbiAgICAgICAgcGFja2FnZUpzb25bJ3NjcmlwdHMnXVsnc2V0dXA6aW50ZWdyYXRpb24nXSA9PT0gYHRzeCAke3NjcmlwdH1gXG4gICAgICApIHtcbiAgICAgICAgYXdhaXQgcnVuVHVyYm9UYXNrcyh7XG4gICAgICAgICAgdGFza3M6IFsnc2V0dXA6aW50ZWdyYXRpb24nXSxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBzcGF3blRvUHJvbWlzZSgndHN4JywgW2xvY2F0aW9uXSwge1xuICAgICAgICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgICAgICAgZXhpdENvZGVzOiBbMF0sXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkQW5kUnVuR2xvYmFsSG9vayhcbiAgc2NyaXB0OiBzdHJpbmcsXG4gIGdsb2JhbENvbmZpZzogQ29uZmlnLkdsb2JhbENvbmZpZyxcbiAgcHJvamVjdENvbmZpZzogQ29uZmlnLlByb2plY3RDb25maWcsXG4gIHRpcD86IHN0cmluZ1xuKSB7XG4gIGNvbnN0IFtzdGFuZGFyZCwgY3VzdG9tXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICBsb2FkU3RhbmRhcmRHbG9iYWxIb29rKGAke3NjcmlwdH0ubWpzYCwgZ2xvYmFsQ29uZmlnLCBwcm9qZWN0Q29uZmlnKSxcbiAgICBsb2FkQ3VzdG9tR2xvYmFsSG9vayhgJHtzY3JpcHR9LnRzYCksXG4gIF0pO1xuICBpZiAoIWN1c3RvbS5oYXNIb29rICYmIHRpcCkge1xuICAgIGxvZ2dlci5sb2codGlwKTtcbiAgfVxuICBhd2FpdCBzdGFuZGFyZC5leGVjdXRlKCk7XG4gIGF3YWl0IGN1c3RvbS5leGVjdXRlKCk7XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQU8sU0FBQSxJQUFBLENBQWlCLEVBQXNCLEVBQUE7QUFDNUMsRUFBSSxJQUFBLEtBQUEsQ0FBQTtBQUNKLEVBQUEsSUFBSSxVQUFhLEdBQUEsS0FBQSxDQUFBO0FBQ2pCLEVBQUEsT0FBTyxNQUFTO0FBQ2QsSUFBQSxJQUFJLFVBQVksRUFBQTtBQUNkLE1B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
