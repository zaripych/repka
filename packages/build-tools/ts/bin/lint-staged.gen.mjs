#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed
import { assert } from 'node:console';
import { ChildProcess, spawn } from 'node:child_process';

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
  const exitCodes = (opts == null ? void 0 : opts.exitCodes) || "inherit";
  const cwd = (opts == null ? void 0 : opts.cwd) ? opts.cwd.toString() : void 0;
  const cmd = () => [command, ...args ? args : []].join(" ");
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
  var _a, _b, _c, _d;
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const combinedData = [];
  const stdoutData = [];
  const stderrData = [];
  const output = (opts == null ? void 0 : opts.output) ?? ["stdout", "stderr"];
  if (output.includes("stdout")) {
    assert(!!child.stdout, 'Expected ".stdout" to be defined, which will only be defined if child process is spawned with correct parameters');
    (_a = child.stdout) == null ? void 0 : _a.setEncoding("utf-8");
    (_b = child.stdout) == null ? void 0 : _b.on("data", (data) => {
      combinedData.push(data);
      stdoutData.push(data);
    });
  }
  if (output.includes("stderr")) {
    assert(!!child.stderr, 'Expected ".stderr" to be defined, which will only be defined if child process is spawned with correct parameters');
    (_c = child.stderr) == null ? void 0 : _c.setEncoding("utf-8");
    (_d = child.stderr) == null ? void 0 : _d.on("data", (data) => {
      combinedData.push(data);
      stderrData.push(data);
    });
  }
  const [result] = await Promise.allSettled([
    spawnToPromise(child, {
      exitCodes: (opts == null ? void 0 : opts.exitCodes) ?? "any",
      cwd: opts == null ? void 0 : opts.cwd
    })
  ]);
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

async function spawnOutput(...parameters) {
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const result = await spawnResult(child, {
    ...opts,
    exitCodes: (opts == null ? void 0 : opts.exitCodes) ?? [0]
  });
  return result.output.join("");
}
async function spawnWithOutputWhenFailed(...parameters) {
  const result = await spawnResult(...parameters);
  if (result.error) {
    logger.error(result.output.join(""));
    return Promise.reject(result.error);
  }
  return Promise.resolve(result);
}

function removeArgsFrom(target, args, opts) {
  const result = [...target];
  for (const arg of args) {
    const index = target.findIndex((value) => typeof arg === "string" ? value === arg : arg.test(value));
    if (index !== -1) {
      result.splice(index, (opts == null ? void 0 : opts.numValues) ? opts.numValues + 1 : 1);
    }
  }
  return result;
}
function removeInputArgs(args, opts) {
  return (value) => {
    return {
      ...value,
      inputArgs: removeArgsFrom(value.inputArgs, args, opts)
    };
  };
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

function taskArgsPipe(transforms, inputArgs = process.argv.slice(2)) {
  return cliArgsPipe([
    removeInputArgs(["--log-level"], { numValues: 1 }),
    ...transforms
  ], inputArgs);
}

const binPath = (bin) => new URL(`../node_modules/.bin/${bin}`, import.meta.url).pathname;
async function runBin(bin, args = taskArgsPipe([])) {
  await spawnToPromise(binPath(bin), args, {
    stdio: "inherit"
  });
}

const lintStaged = async () => {
  await runBin("lint-staged");
};
const stashIncludeUntrackedKeepIndex = async () => {
  const split = (out) => out.split("\n").filter(Boolean);
  const [staged, modified, untracked] = await Promise.all([
    spawnOutput("git", "diff --name-only --cached".split(" ")).then(split),
    spawnOutput("git", "diff --name-only".split(" ")).then(split),
    spawnOutput("git", "ls-files --others --exclude-standard --full-name".split(" ")).then(split)
  ]);
  const shouldStash = staged.length > 0 && (modified.length > 0 || untracked.length > 0);
  if (shouldStash) {
    await spawnWithOutputWhenFailed("git", 'commit --no-verify -m "lint-staged-temporary"'.split(" "), {
      exitCodes: [0]
    });
    try {
      await spawnWithOutputWhenFailed("git", "stash push -u --message lint-staged-temporary".split(" "), {
        exitCodes: [0]
      });
    } finally {
      await spawnWithOutputWhenFailed("git", "reset --soft HEAD~1".split(" "), {
        exitCodes: [0]
      });
    }
  }
  return { staged, modified, untracked, didStash: shouldStash };
};
const applyStashed = async () => spawnResult("git", "stash pop".split(" "));
const run = async () => {
  const { didStash, staged } = await stashIncludeUntrackedKeepIndex();
  try {
    await lintStaged();
  } finally {
    if (didStash) {
      await applyStashed().then((result) => {
        if (result.error) {
          console.error(result.error);
        }
        if (result.status !== 0) {
          console.error(result.output.join(""));
          console.log("\nTo at least restore list of staged files after resolution, try this: \n\n", `git reset && git add ${staged.map((file) => `'${file}'`).join(" ")} 

`);
        }
        return Promise.resolve();
      });
    }
  }
};
await run();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGludC1zdGFnZWQuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vc3JjL3V0aWxzL29uY2UudHMiLCIuLi9zcmMvbG9nZ2VyL2xvZ2dlci50cyIsIi4uL3NyYy91dGlscy9zdGFja1RyYWNlLnRzIiwiLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25Ub1Byb21pc2UudHMiLCIuLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdC50cyIsIi4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduT3V0cHV0LnRzIiwiLi4vc3JjL3V0aWxzL2NsaUFyZ3NQaXBlLnRzIiwiLi4vc3JjL3V0aWxzL3Rhc2tBcmdzUGlwZS50cyIsIi4uL3NyYy9iaW4vcnVuQmluLnRzIiwiLi4vc3JjL2Jpbi9saW50LXN0YWdlZC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZnVuY3Rpb24gb25jZTxUPihmbjogKCkgPT4gVCk6ICgpID0+IFQge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiAoKTogVCA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdmFsdWUgPSBmbigpO1xuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImltcG9ydCB7IG9uY2UgfSBmcm9tICcuLi91dGlscy9vbmNlJztcblxuY29uc3QgbGV2ZWxzID0gWydkZWJ1ZycsICdpbmZvJywgJ3dhcm4nLCAnZXJyb3InLCAnZmF0YWwnXSBhcyBjb25zdDtcblxudHlwZSBMb2dMZXZlbCA9IHR5cGVvZiBsZXZlbHNbbnVtYmVyXTtcblxudHlwZSBQYXJhbXMgPSBQYXJhbWV0ZXJzPHR5cGVvZiBjb25zb2xlLmxvZz47XG5cbnR5cGUgTG9nZ2VyID0ge1xuICBsb2dMZXZlbDogTG9nTGV2ZWw7XG4gIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgaW5mbyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIC8vIGFsaWFzIGZvciBpbmZvXG4gIGxvZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIC8vIHNwZWNpYWwgdHJlYXRtZW50LCBkaXNhYmxlZCBvbiBDSS9UVFlcbiAgdGlwKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgd2FybiguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGVycm9yKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgZmF0YWwoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xufTtcblxuY29uc3QgZW5hYmxlZExldmVsc0FmdGVyID0gKGxldmVsOiBMb2dMZXZlbCB8ICdvZmYnKSA9PiB7XG4gIGlmIChsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgY29uc3QgaW5kZXggPSBsZXZlbHMuZmluZEluZGV4KChpdGVtKSA9PiBpdGVtID09PSBsZXZlbCk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbGV2ZWwnKTtcbiAgfVxuICByZXR1cm4gbGV2ZWxzLnNsaWNlKGluZGV4KTtcbn07XG5cbmNvbnN0IGlzTGV2ZWwgPSAobGV2ZWw/OiBzdHJpbmcpOiBsZXZlbCBpcyBMb2dMZXZlbCA9PiB7XG4gIHJldHVybiBsZXZlbHMuaW5jbHVkZXMobGV2ZWwgYXMgTG9nTGV2ZWwpO1xufTtcblxuY29uc3QgdmVyYm9zaXR5RnJvbVByb2Nlc3NBcmdzID0gKFxuICBhcmdzID0gcHJvY2Vzcy5hcmd2XG4pOiBMb2dMZXZlbCB8ICdvZmYnIHwgdW5kZWZpbmVkID0+IHtcbiAgY29uc3QgaW5kZXggPSBhcmdzLmZpbmRJbmRleCgodmFsdWUpID0+IHZhbHVlID09PSAnLS1sb2ctbGV2ZWwnKTtcbiAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgY29uc3QgbGV2ZWwgPSBhcmdzW2luZGV4ICsgMV07XG4gIGlmIChsZXZlbCA9PT0gJ3NpbGVudCcgfHwgbGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuICdvZmYnO1xuICB9XG4gIGlmICghaXNMZXZlbChsZXZlbCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBsZXZlbDtcbn07XG5cbmNvbnN0IHZlcmJvc2l0eUZyb21FbnYgPSAoKTogTG9nTGV2ZWwgfCAnb2ZmJyB8IHVuZGVmaW5lZCA9PiB7XG4gIGNvbnN0IGxldmVsID0gcHJvY2Vzcy5lbnZbJ0xPR19MRVZFTCddO1xuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiAnb2ZmJztcbiAgfVxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5jb25zdCBnZXRWZXJib3NpdHlDb25maWcgPSAoKSA9PiB7XG4gIGNvbnN0IGFyZ3NMZXZlbCA9IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncygpO1xuICBjb25zdCBlbnZMZXZlbCA9IHZlcmJvc2l0eUZyb21FbnYoKTtcbiAgcmV0dXJuIGFyZ3NMZXZlbCA/PyBlbnZMZXZlbCA/PyAnaW5mbyc7XG59O1xuXG5jb25zdCBub29wID0gKC4uLl9hcmdzOiBQYXJhbXMpID0+IHtcbiAgcmV0dXJuO1xufTtcblxuY29uc3QgbG9nID0gKC4uLmFyZ3M6IFBhcmFtcykgPT4ge1xuICBjb25zb2xlLmxvZyguLi5hcmdzKTtcbn07XG5cbmNvbnN0IGVycm9yID0gKC4uLmFyZ3M6IFBhcmFtcykgPT4ge1xuICBjb25zb2xlLmVycm9yKC4uLmFyZ3MpO1xufTtcblxuY29uc3Qgc2hvdWxkRW5hYmxlVGlwID0gKCkgPT4gIXByb2Nlc3MuZW52WydDSSddICYmICFwcm9jZXNzLnN0ZG91dC5pc1RUWTtcblxuZXhwb3J0IGNvbnN0IGNyZWF0ZUxvZ2dlciA9IChcbiAgZGVwcyA9IHsgZ2V0VmVyYm9zaXR5Q29uZmlnLCBsb2csIGVycm9yLCBzaG91bGRFbmFibGVUaXAgfVxuKSA9PiB7XG4gIGNvbnN0IGxvZ0xldmVsID0gZGVwcy5nZXRWZXJib3NpdHlDb25maWcoKTtcbiAgY29uc3QgZW5hYmxlZCA9IGVuYWJsZWRMZXZlbHNBZnRlcihsb2dMZXZlbCk7XG4gIHJldHVybiBsZXZlbHMucmVkdWNlKFxuICAgIChhY2MsIGx2bCkgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uYWNjLFxuICAgICAgICBbbHZsXTogZW5hYmxlZC5pbmNsdWRlcyhsdmwpXG4gICAgICAgICAgPyBbJ2ZhdGFsJywgJ2Vycm9yJ10uaW5jbHVkZXMobHZsKVxuICAgICAgICAgICAgPyBkZXBzLmVycm9yXG4gICAgICAgICAgICA6IGRlcHMubG9nXG4gICAgICAgICAgOiBub29wLFxuICAgICAgfTtcbiAgICB9LFxuICAgIHtcbiAgICAgIGxvZ0xldmVsLFxuICAgICAgbG9nOiBlbmFibGVkLmluY2x1ZGVzKCdpbmZvJykgPyBkZXBzLmxvZyA6IG5vb3AsXG4gICAgICB0aXA6IGVuYWJsZWQuaW5jbHVkZXMoJ2luZm8nKSAmJiBkZXBzLnNob3VsZEVuYWJsZVRpcCgpID8gZGVwcy5sb2cgOiBub29wLFxuICAgIH0gYXMgTG9nZ2VyXG4gICk7XG59O1xuXG5jb25zdCBjcmVhdGVEZWxlZ2F0aW5nTG9nZ2VyID0gKG9wdHM6IHsgcGFyZW50OiBMb2dnZXIgfSk6IExvZ2dlciA9PlxuICBPYmplY3QuZnJlZXplKHtcbiAgICBnZXQgbG9nTGV2ZWwoKSB7XG4gICAgICByZXR1cm4gb3B0cy5wYXJlbnQubG9nTGV2ZWw7XG4gICAgfSxcbiAgICBkZWJ1ZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuZGVidWcoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGluZm8oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmluZm8oLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGxvZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQubG9nKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICB0aXAoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LnRpcCguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgd2FybiguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQud2FybiguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgZXJyb3IoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmVycm9yKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBmYXRhbCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuZmF0YWwoLi4ucGFyYW1zKTtcbiAgICB9LFxuICB9KTtcblxubGV0IGRlZmF1bHRMb2dnZXJGYWN0b3J5OiAoKCkgPT4gTG9nZ2VyKSB8IG51bGw7XG5cbmV4cG9ydCBjb25zdCBjb25maWd1cmVEZWZhdWx0TG9nZ2VyID0gKGZhY3Rvcnk6ICgpID0+IExvZ2dlcikgPT4ge1xuICBpZiAoZGVmYXVsdExvZ2dlckZhY3RvcnkpIHtcbiAgICBjb25zdCBlcnJvciA9IHtcbiAgICAgIHN0YWNrOiAnJyxcbiAgICB9O1xuICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKGVycm9yKTtcbiAgICBsb2dnZXIuZGVidWcoJ0Nhbm5vdCBvdmVycmlkZSBkZWZhdWx0IGxvZ2dlciBtdWx0aXBsZSB0aW1lcycsIGVycm9yLnN0YWNrKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZGVmYXVsdExvZ2dlckZhY3RvcnkgPSBmYWN0b3J5O1xufTtcblxuY29uc3QgZGVmYXVsdExvZ2dlciA9IG9uY2UoKCkgPT4ge1xuICBsZXQgZmFjdG9yeSA9IGRlZmF1bHRMb2dnZXJGYWN0b3J5O1xuICBpZiAoIWZhY3RvcnkpIHtcbiAgICBmYWN0b3J5ID0gKCkgPT4gY3JlYXRlTG9nZ2VyKCk7XG4gIH1cbiAgcmV0dXJuIGZhY3RvcnkoKTtcbn0pO1xuXG4vKipcbiAqIERlZmF1bHQgbG9nZ2VyIGluc3RhbmNlIGNhbiBiZSBjb25maWd1cmVkIG9uY2UgYXQgc3RhcnR1cFxuICovXG5leHBvcnQgY29uc3QgbG9nZ2VyOiBMb2dnZXIgPSBjcmVhdGVEZWxlZ2F0aW5nTG9nZ2VyKHtcbiAgZ2V0IHBhcmVudCgpIHtcbiAgICByZXR1cm4gZGVmYXVsdExvZ2dlcigpO1xuICB9LFxufSk7XG4iLCIvKipcbiAqIENhcHR1cmUgdGhlIHN0YWNrIHRyYWNlIGFuZCBhbGxvdyB0byBlbnJpY2ggZXhjZXB0aW9ucyB0aHJvd24gaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrc1xuICogd2l0aCBhZGRpdGlvbmFsIHN0YWNrIGluZm9ybWF0aW9uIGNhcHR1cmVkIGF0IHRoZSBtb21lbnQgb2YgdGhlIGNhbGwgb2YgdGhpcyBmdW5jdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZVN0YWNrVHJhY2UocmVtb3ZlID0gMCkge1xuICBjb25zdCBzdGFja0NvbnRhaW5lciA9IHtcbiAgICBzdGFjazogJycsXG4gIH07XG4gIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHN0YWNrQ29udGFpbmVyKTtcbiAgY29uc3Qgc3RhY2tUcmFjZSA9IHN0YWNrQ29udGFpbmVyLnN0YWNrXG4gICAgLnNwbGl0KCdcXG4nKVxuICAgIC5zbGljZSg2ICsgcmVtb3ZlKVxuICAgIC5qb2luKCdcXG4nKTtcbiAgcmV0dXJuIHtcbiAgICAvKipcbiAgICAgKiBDYXB0dXJlZCBzdGFjayB0cmFjZSBpbmZvcm1hdGlvblxuICAgICAqL1xuICAgIHN0YWNrVHJhY2UsXG4gICAgLyoqXG4gICAgICogQ2FuIGJlIGNhbGxlZCBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2sgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgd2l0aCBhZGRpdGlvbmFsIGluZm9ybWF0aW9uXG4gICAgICogQHBhcmFtIGVyciBFeGNlcHRpb24gdG8gZW5yaWNoIC0gaXQgaXMgZ29pbmcgdG8gaGF2ZSBpdHMgYC5zdGFja2AgcHJvcCBtdXRhdGVkXG4gICAgICogQHJldHVybnMgU2FtZSBleGNlcHRpb25cbiAgICAgKi9cbiAgICBwcmVwYXJlRm9yUmV0aHJvdzogKGVycjogRXJyb3IpID0+IHtcbiAgICAgIGNvbnN0IG9sZFN0YWNrVHJhY2UgPSBlcnIuc3RhY2sgPz8gJycuc3BsaXQoJ1xcbicpLnNsaWNlKDEpLmpvaW4oJ1xcbicpO1xuICAgICAgZXJyLnN0YWNrID0gYCR7ZXJyLm5hbWUgfHwgJ0Vycm9yJ306ICR7XG4gICAgICAgIGVyci5tZXNzYWdlXG4gICAgICB9XFxuJHtvbGRTdGFja1RyYWNlfVxcbiR7c3RhY2tUcmFjZX1gO1xuICAgICAgcmV0dXJuIGVycjtcbiAgICB9LFxuICB9O1xufVxuIiwiaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IENoaWxkUHJvY2VzcyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB0eXBlIHsgQXNzaWduIH0gZnJvbSAndXRpbGl0eS10eXBlcyc7XG5cbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgY2FwdHVyZVN0YWNrVHJhY2UgfSBmcm9tICcuLi91dGlscy9zdGFja1RyYWNlJztcblxuZXhwb3J0IHR5cGUgU3Bhd25Ub1Byb21pc2VFeHRyYSA9IHtcbiAgZXhpdENvZGVzPzogbnVtYmVyW10gfCAnaW5oZXJpdCcgfCAnYW55Jztcbn07XG5cbnR5cGUgU2hhcmVkT3B0cyA9IFBpY2s8U3Bhd25PcHRpb25zLCAnY3dkJz47XG5cbnR5cGUgU3Bhd25BcmdzPEUgZXh0ZW5kcyBvYmplY3Q+ID0gW1xuICBjb21tYW5kOiBzdHJpbmcsXG4gIGFyZ3M/OiBSZWFkb25seUFycmF5PHN0cmluZz4sXG4gIG9wdGlvbnM/OiBBc3NpZ248U3Bhd25PcHRpb25zLCBFPlxuXTtcblxuZXhwb3J0IHR5cGUgU3Bhd25PcHRpb25zV2l0aEV4dHJhPEUgZXh0ZW5kcyBvYmplY3QgPSBTcGF3blRvUHJvbWlzZUV4dHJhPiA9XG4gIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+O1xuXG5leHBvcnQgdHlwZSBTcGF3blBhcmFtZXRlck1peDxFIGV4dGVuZHMgb2JqZWN0ID0gU3Bhd25Ub1Byb21pc2VFeHRyYT4gPVxuICB8IFtjcDogQ2hpbGRQcm9jZXNzLCBleHRyYU9wdHM/OiBBc3NpZ248RSwgU2hhcmVkT3B0cz5dXG4gIHwgU3Bhd25BcmdzPEU+O1xuXG5leHBvcnQgZnVuY3Rpb24gaXNTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4oXG4gIGFyZ3M6IFNwYXduUGFyYW1ldGVyTWl4PEU+XG4pOiBhcmdzIGlzIFNwYXduQXJnczxFPiB7XG4gIHJldHVybiAhKGFyZ3NbMF0gaW5zdGFuY2VvZiBDaGlsZFByb2Nlc3MpICYmIHR5cGVvZiBhcmdzWzBdID09PSAnc3RyaW5nJztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNwYXduV2l0aFNwYXduUGFyYW1ldGVyczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgcGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbikge1xuICBjb25zdCBbY2hpbGQsIFtjb21tYW5kLCBhcmdzLCBvcHRzXV0gPSBpc1NwYXduQXJncyhwYXJhbWV0ZXJzKVxuICAgID8gW1xuICAgICAgICBzcGF3biguLi4ocGFyYW1ldGVycyBhcyB1bmtub3duIGFzIFBhcmFtZXRlcnM8dHlwZW9mIHNwYXduPikpLFxuICAgICAgICBwYXJhbWV0ZXJzLFxuICAgICAgXVxuICAgIDogW1xuICAgICAgICBwYXJhbWV0ZXJzWzBdLFxuICAgICAgICBbXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmZpbGUsXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmFyZ3Muc2xpY2UoMSksXG4gICAgICAgICAgcGFyYW1ldGVyc1sxXSBhcyBBc3NpZ248U3Bhd25PcHRpb25zLCBFPixcbiAgICAgICAgXSxcbiAgICAgIF07XG4gIHJldHVybiB7XG4gICAgY2hpbGQsXG4gICAgY29tbWFuZCxcbiAgICBhcmdzLFxuICAgIG9wdHMsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blRvUHJvbWlzZShcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXhcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB7IGNoaWxkLCBjb21tYW5kLCBhcmdzLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHsgcHJlcGFyZUZvclJldGhyb3cgfSA9IGNhcHR1cmVTdGFja1RyYWNlKCk7XG5cbiAgLy8gYnkgZGVmYXVsdCB3ZSBkbyBub3QgdGhyb3cgaWYgZXhpdCBjb2RlIGlzIG5vbi16ZXJvXG4gIC8vIGFuZCBpbnN0ZWFkIGp1c3QgaW5oZXJpdCB0aGUgZXhpdCBjb2RlIGludG8gdGhlIG1haW5cbiAgLy8gcHJvY2Vzc1xuICBjb25zdCBleGl0Q29kZXMgPSBvcHRzPy5leGl0Q29kZXMgfHwgJ2luaGVyaXQnO1xuXG4gIGNvbnN0IGN3ZCA9IG9wdHM/LmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY21kID0gKCkgPT4gW2NvbW1hbmQsIC4uLihhcmdzID8gYXJncyA6IFtdKV0uam9pbignICcpO1xuXG4gIGxvZ2dlci5kZWJ1ZyhbJz4nLCBjbWQoKV0uam9pbignICcpLCAuLi4oY3dkID8gW2BpbiAke2N3ZH1gXSA6IFtdKSk7XG5cbiAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlcywgcmVqKSA9PlxuICAgIGNoaWxkXG4gICAgICAub24oJ2Nsb3NlJywgKGNvZGUsIHNpZ25hbCkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIGNvZGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgZXhpdENvZGVzICE9PSAnaW5oZXJpdCcgJiZcbiAgICAgICAgICAgIGV4aXRDb2RlcyAhPT0gJ2FueScgJiZcbiAgICAgICAgICAgICFleGl0Q29kZXMuaW5jbHVkZXMoY29kZSlcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHJlaihcbiAgICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3coXG4gICAgICAgICAgICAgICAgbmV3IEVycm9yKGBDb21tYW5kIFwiJHtjbWQoKX1cIiBoYXMgZmFpbGVkIHdpdGggY29kZSAke2NvZGV9YClcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHNpZ25hbCkge1xuICAgICAgICAgIHJlaihcbiAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICBuZXcgRXJyb3IoYEZhaWxlZCB0byBleGVjdXRlIGNvbW1hbmQgXCIke2NtZCgpfVwiIC0gJHtzaWduYWx9YClcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IHByZXBhcmVGb3JSZXRocm93KG5ldyBFcnJvcignRXhwZWN0ZWQgc2lnbmFsIG9yIGVycm9yIGNvZGUnKSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAub24oJ2Vycm9yJywgcmVqKVxuICApO1xuICAvLyBpbmhlcml0IGV4aXQgY29kZVxuICBpZiAoZXhpdENvZGVzID09PSAnaW5oZXJpdCcpIHtcbiAgICBpZiAoXG4gICAgICB0eXBlb2YgY2hpbGQuZXhpdENvZGUgPT09ICdudW1iZXInICYmXG4gICAgICAodHlwZW9mIHByb2Nlc3MuZXhpdENvZGUgIT09ICdudW1iZXInIHx8IHByb2Nlc3MuZXhpdENvZGUgPT09IDApXG4gICAgKSB7XG4gICAgICBwcm9jZXNzLmV4aXRDb2RlID0gY2hpbGQuZXhpdENvZGU7XG4gICAgfVxuICB9XG59XG4iLCJpbXBvcnQgeyBhc3NlcnQgfSBmcm9tICdjb25zb2xlJztcblxuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCwgU3Bhd25Ub1Byb21pc2VFeHRyYSB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5pbXBvcnQgeyBzcGF3blRvUHJvbWlzZSB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuXG5leHBvcnQgdHlwZSBFeHRyYVNwYXduUmVzdWx0T3B0cyA9IHtcbiAgb3V0cHV0PzogWydzdGRvdXQnIHwgJ3N0ZGVycicsIC4uLkFycmF5PCdzdGRvdXQnIHwgJ3N0ZGVycic+XTtcbn0gJiBTcGF3blRvUHJvbWlzZUV4dHJhO1xuXG50eXBlIFNwYXduUmVzdWx0UmV0dXJuID0ge1xuICBwaWQ/OiBudW1iZXI7XG4gIG91dHB1dDogc3RyaW5nW107XG4gIHN0ZG91dDogc3RyaW5nO1xuICBzdGRlcnI6IHN0cmluZztcbiAgc3RhdHVzOiBudW1iZXIgfCBudWxsO1xuICBzaWduYWw6IE5vZGVKUy5TaWduYWxzIHwgbnVsbDtcbiAgZXJyb3I/OiBFcnJvciB8IHVuZGVmaW5lZDtcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blJlc3VsdChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8RXh0cmFTcGF3blJlc3VsdE9wdHM+XG4pOiBQcm9taXNlPFNwYXduUmVzdWx0UmV0dXJuPiB7XG4gIGNvbnN0IHsgY2hpbGQsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgY29tYmluZWREYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGRvdXREYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBvdXRwdXQgPSBvcHRzPy5vdXRwdXQgPz8gWydzdGRvdXQnLCAnc3RkZXJyJ107XG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZG91dCcpKSB7XG4gICAgYXNzZXJ0KFxuICAgICAgISFjaGlsZC5zdGRvdXQsXG4gICAgICAnRXhwZWN0ZWQgXCIuc3Rkb3V0XCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xuICAgICk7XG4gICAgY2hpbGQuc3Rkb3V0Py5zZXRFbmNvZGluZygndXRmLTgnKTtcbiAgICBjaGlsZC5zdGRvdXQ/Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRvdXREYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3RkZXJyJykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZGVycixcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRlcnJcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRlcnI/LnNldEVuY29kaW5nKCd1dGYtOCcpO1xuICAgIGNoaWxkLnN0ZGVycj8ub24oJ2RhdGEnLCAoZGF0YTogc3RyaW5nKSA9PiB7XG4gICAgICBjb21iaW5lZERhdGEucHVzaChkYXRhKTtcbiAgICAgIHN0ZGVyckRhdGEucHVzaChkYXRhKTtcbiAgICB9KTtcbiAgfVxuICBjb25zdCBbcmVzdWx0XSA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbXG4gICAgc3Bhd25Ub1Byb21pc2UoY2hpbGQsIHtcbiAgICAgIGV4aXRDb2Rlczogb3B0cz8uZXhpdENvZGVzID8/ICdhbnknLFxuICAgICAgY3dkOiBvcHRzPy5jd2QsXG4gICAgfSksXG4gIF0pO1xuICByZXR1cm4ge1xuICAgIHBpZDogY2hpbGQucGlkLFxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcbiAgICBzdGF0dXM6IGNoaWxkLmV4aXRDb2RlLFxuICAgIGdldCBvdXRwdXQoKSB7XG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xuICAgIH0sXG4gICAgZ2V0IHN0ZGVycigpIHtcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IHN0ZG91dCgpIHtcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IGVycm9yKCkge1xuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcbiAgICAgICAgPyAocmVzdWx0LnJlYXNvbiBhcyBFcnJvcilcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHR5cGUgeyBFeHRyYVNwYXduUmVzdWx0T3B0cyB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHsgc3Bhd25SZXN1bHQgfSBmcm9tICcuL3NwYXduUmVzdWx0JztcbmltcG9ydCB0eXBlIHsgU3Bhd25QYXJhbWV0ZXJNaXggfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25PdXRwdXQoXG4gIC4uLnBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4PEV4dHJhU3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwge1xuICAgIC4uLm9wdHMsXG4gICAgZXhpdENvZGVzOiBvcHRzPy5leGl0Q29kZXMgPz8gWzBdLFxuICB9KTtcbiAgcmV0dXJuIHJlc3VsdC5vdXRwdXQuam9pbignJyk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bldpdGhPdXRwdXRXaGVuRmFpbGVkKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxFeHRyYVNwYXduUmVzdWx0T3B0cz5cbikge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdCguLi5wYXJhbWV0ZXJzKTtcbiAgaWYgKHJlc3VsdC5lcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcihyZXN1bHQub3V0cHV0LmpvaW4oJycpKTtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gaW5jbHVkZXNBbnlPZih0YXJnZXQ6IHN0cmluZ1tdLCBoYXNBbnlPZkFyZ3M6IHN0cmluZ1tdKSB7XG4gIHJldHVybiBoYXNBbnlPZkFyZ3Muc29tZSgodmFyaWFudCkgPT4gdGFyZ2V0LmluY2x1ZGVzKHZhcmlhbnQpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUFyZ3NGcm9tKFxuICB0YXJnZXQ6IHN0cmluZ1tdLFxuICBhcmdzOiBBcnJheTxzdHJpbmcgfCBSZWdFeHA+LFxuICBvcHRzPzogeyBudW1WYWx1ZXM6IG51bWJlciB9XG4pIHtcbiAgY29uc3QgcmVzdWx0ID0gWy4uLnRhcmdldF07XG4gIGZvciAoY29uc3QgYXJnIG9mIGFyZ3MpIHtcbiAgICBjb25zdCBpbmRleCA9IHRhcmdldC5maW5kSW5kZXgoKHZhbHVlKSA9PlxuICAgICAgdHlwZW9mIGFyZyA9PT0gJ3N0cmluZycgPyB2YWx1ZSA9PT0gYXJnIDogYXJnLnRlc3QodmFsdWUpXG4gICAgKTtcbiAgICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgICByZXN1bHQuc3BsaWNlKGluZGV4LCBvcHRzPy5udW1WYWx1ZXMgPyBvcHRzLm51bVZhbHVlcyArIDEgOiAxKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUlucHV0QXJncyhcbiAgYXJnczogQXJyYXk8c3RyaW5nIHwgUmVnRXhwPixcbiAgb3B0cz86IHsgbnVtVmFsdWVzOiBudW1iZXIgfVxuKSB7XG4gIHJldHVybiAodmFsdWU6IENsaUFyZ3MpID0+IHtcbiAgICByZXR1cm4ge1xuICAgICAgLi4udmFsdWUsXG4gICAgICBpbnB1dEFyZ3M6IHJlbW92ZUFyZ3NGcm9tKHZhbHVlLmlucHV0QXJncywgYXJncywgb3B0cyksXG4gICAgfTtcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNldERlZmF1bHRBcmdzKFxuICBhcmdzOiBbc3RyaW5nLCAuLi5zdHJpbmdbXV0sXG4gIHZhbHVlczogc3RyaW5nW10gPSBbXSxcbiAgY29uZGl0aW9uPzogKGFyZ3M6IENsaUFyZ3MpID0+IGJvb2xlYW5cbikge1xuICByZXR1cm4gKHZhbHVlOiBDbGlBcmdzKSA9PiB7XG4gICAgaWYgKGNvbmRpdGlvbikge1xuICAgICAgaWYgKCFjb25kaXRpb24odmFsdWUpKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGluY2x1ZGVzQW55T2YodmFsdWUuaW5wdXRBcmdzLCBhcmdzKSkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgLi4udmFsdWUsXG4gICAgICBwcmVBcmdzOiBbLi4udmFsdWUucHJlQXJncywgYXJnc1swXSwgLi4udmFsdWVzXSxcbiAgICB9O1xuICB9O1xufVxuXG5leHBvcnQgdHlwZSBDbGlBcmdzID0ge1xuICAvKipcbiAgICogRXh0cmEgYXJndW1lbnRzIHRoYXQgZ28gYmVmb3JlIGFyZ3VtZW50cyBwYXNzZWQgaW4gYnkgdGhlIHVzZXJcbiAgICovXG4gIHByZUFyZ3M6IHN0cmluZ1tdO1xuICAvKipcbiAgICogQXJndW1lbnRzIGFzIHBhc3NlZCBpbiBieSB0aGUgdXNlciwgY291bGQgYmUgbW9kaWZpZWQgYnlcbiAgICogdHJhbnNmb3JtcyB0aGF0IGNvbWUgYmVmb3JlIGN1cnJlbnRcbiAgICovXG4gIGlucHV0QXJnczogc3RyaW5nW107XG4gIC8qKlxuICAgKiBFeHRyYSBhcmd1bWVudHMgdGhhdCBnbyBhZnRlciBhcmd1bWVudHMgcGFzc2VkIGluIGJ5IHRoZSB1c2VyXG4gICAqL1xuICBwb3N0QXJnczogc3RyaW5nW107XG59O1xuXG5leHBvcnQgdHlwZSBDbGlBcmdzVHJhbnNmb3JtID0gKG9wdHM6IENsaUFyZ3MpID0+IENsaUFyZ3M7XG5cbmV4cG9ydCBmdW5jdGlvbiBjbGlBcmdzUGlwZShcbiAgdHJhbnNmb3JtczogQ2xpQXJnc1RyYW5zZm9ybVtdLFxuICBpbnB1dEFyZ3M6IHN0cmluZ1tdXG4pIHtcbiAgY29uc3Qge1xuICAgIHByZUFyZ3MsXG4gICAgaW5wdXRBcmdzOiBtb2RpZmllZElucHV0QXJncyxcbiAgICBwb3N0QXJncyxcbiAgfSA9IHRyYW5zZm9ybXMucmVkdWNlPENsaUFyZ3M+KChhY2MsIHRyYW5zZm9ybSkgPT4gdHJhbnNmb3JtKGFjYyksIHtcbiAgICBpbnB1dEFyZ3MsXG4gICAgcHJlQXJnczogW10sXG4gICAgcG9zdEFyZ3M6IFtdLFxuICB9KTtcbiAgcmV0dXJuIFsuLi5wcmVBcmdzLCAuLi5tb2RpZmllZElucHV0QXJncywgLi4ucG9zdEFyZ3NdO1xufVxuIiwiaW1wb3J0IHR5cGUgeyBDbGlBcmdzVHJhbnNmb3JtIH0gZnJvbSAnLi9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyByZW1vdmVJbnB1dEFyZ3MgfSBmcm9tICcuL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGNsaUFyZ3NQaXBlIH0gZnJvbSAnLi9jbGlBcmdzUGlwZSc7XG5cbmV4cG9ydCBmdW5jdGlvbiB0YXNrQXJnc1BpcGUoXG4gIHRyYW5zZm9ybXM6IENsaUFyZ3NUcmFuc2Zvcm1bXSxcbiAgaW5wdXRBcmdzOiBzdHJpbmdbXSA9IHByb2Nlc3MuYXJndi5zbGljZSgyKVxuKSB7XG4gIHJldHVybiBjbGlBcmdzUGlwZShcbiAgICBbXG4gICAgICAvLyByZW1vdmUgLS1sb2ctbGV2ZWwgYXMgdGhhdCBpcyBjb25zdW1lZCBieSBvdXIgbG9nZ2VyXG4gICAgICByZW1vdmVJbnB1dEFyZ3MoWyctLWxvZy1sZXZlbCddLCB7IG51bVZhbHVlczogMSB9KSxcbiAgICAgIC4uLnRyYW5zZm9ybXMsXG4gICAgXSxcbiAgICBpbnB1dEFyZ3NcbiAgKTtcbn1cbiIsImltcG9ydCB7IHNwYXduVG9Qcm9taXNlIH0gZnJvbSAnLi4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgeyB0YXNrQXJnc1BpcGUgfSBmcm9tICcuLi91dGlscy90YXNrQXJnc1BpcGUnO1xuXG4vLyBOT1RFOiBwYXRoIHJlbGF0aXZlIHRvIHRoZSAuL2JpbiBhdCB0aGUgcm9vdCBvZiB0aGUgcGFja2FnZSB3aGVyZVxuLy8gdGhpcyBmaWxlIGlzIGdvaW5nIHRvIHJlc2lkZVxuY29uc3QgYmluUGF0aCA9IChiaW46IHN0cmluZykgPT5cbiAgbmV3IFVSTChgLi4vbm9kZV9tb2R1bGVzLy5iaW4vJHtiaW59YCwgaW1wb3J0Lm1ldGEudXJsKS5wYXRobmFtZTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1bkJpbihiaW46IHN0cmluZywgYXJncyA9IHRhc2tBcmdzUGlwZShbXSkpIHtcbiAgYXdhaXQgc3Bhd25Ub1Byb21pc2UoYmluUGF0aChiaW4pLCBhcmdzLCB7XG4gICAgc3RkaW86ICdpbmhlcml0JyxcbiAgfSk7XG59XG4iLCJpbXBvcnQgeyBzcGF3bk91dHB1dCwgc3Bhd25XaXRoT3V0cHV0V2hlbkZhaWxlZCB9IGZyb20gJy4uL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd25SZXN1bHQgfSBmcm9tICcuLi9jaGlsZC1wcm9jZXNzL3NwYXduUmVzdWx0JztcbmltcG9ydCB7IHJ1bkJpbiB9IGZyb20gJy4vcnVuQmluJztcblxuY29uc3QgbGludFN0YWdlZCA9IGFzeW5jICgpID0+IHtcbiAgYXdhaXQgcnVuQmluKCdsaW50LXN0YWdlZCcpO1xufTtcblxuY29uc3Qgc3Rhc2hJbmNsdWRlVW50cmFja2VkS2VlcEluZGV4ID0gYXN5bmMgKCkgPT4ge1xuICBjb25zdCBzcGxpdCA9IChvdXQ6IHN0cmluZykgPT4gb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG4gIGNvbnN0IFtzdGFnZWQsIG1vZGlmaWVkLCB1bnRyYWNrZWRdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHNwYXduT3V0cHV0KCdnaXQnLCAnZGlmZiAtLW5hbWUtb25seSAtLWNhY2hlZCcuc3BsaXQoJyAnKSkudGhlbihzcGxpdCksXG4gICAgc3Bhd25PdXRwdXQoJ2dpdCcsICdkaWZmIC0tbmFtZS1vbmx5Jy5zcGxpdCgnICcpKS50aGVuKHNwbGl0KSxcbiAgICBzcGF3bk91dHB1dChcbiAgICAgICdnaXQnLFxuICAgICAgJ2xzLWZpbGVzIC0tb3RoZXJzIC0tZXhjbHVkZS1zdGFuZGFyZCAtLWZ1bGwtbmFtZScuc3BsaXQoJyAnKVxuICAgICkudGhlbihzcGxpdCksXG4gIF0pO1xuICBjb25zdCBzaG91bGRTdGFzaCA9XG4gICAgc3RhZ2VkLmxlbmd0aCA+IDAgJiYgKG1vZGlmaWVkLmxlbmd0aCA+IDAgfHwgdW50cmFja2VkLmxlbmd0aCA+IDApO1xuICBpZiAoc2hvdWxkU3Rhc2gpIHtcbiAgICBhd2FpdCBzcGF3bldpdGhPdXRwdXRXaGVuRmFpbGVkKFxuICAgICAgJ2dpdCcsXG4gICAgICAnY29tbWl0IC0tbm8tdmVyaWZ5IC1tIFwibGludC1zdGFnZWQtdGVtcG9yYXJ5XCInLnNwbGl0KCcgJyksXG4gICAgICB7XG4gICAgICAgIGV4aXRDb2RlczogWzBdLFxuICAgICAgfVxuICAgICk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHNwYXduV2l0aE91dHB1dFdoZW5GYWlsZWQoXG4gICAgICAgICdnaXQnLFxuICAgICAgICAnc3Rhc2ggcHVzaCAtdSAtLW1lc3NhZ2UgbGludC1zdGFnZWQtdGVtcG9yYXJ5Jy5zcGxpdCgnICcpLFxuICAgICAgICB7XG4gICAgICAgICAgZXhpdENvZGVzOiBbMF0sXG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIC8vIGlmIHN0YXNoaW5nIGZhaWxlZCwgcmVzZXQgYW55d2F5XG4gICAgICBhd2FpdCBzcGF3bldpdGhPdXRwdXRXaGVuRmFpbGVkKCdnaXQnLCAncmVzZXQgLS1zb2Z0IEhFQUR+MScuc3BsaXQoJyAnKSwge1xuICAgICAgICBleGl0Q29kZXM6IFswXSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyBzdGFnZWQsIG1vZGlmaWVkLCB1bnRyYWNrZWQsIGRpZFN0YXNoOiBzaG91bGRTdGFzaCB9O1xufTtcblxuY29uc3QgYXBwbHlTdGFzaGVkID0gYXN5bmMgKCkgPT4gc3Bhd25SZXN1bHQoJ2dpdCcsICdzdGFzaCBwb3AnLnNwbGl0KCcgJykpO1xuXG5jb25zdCBydW4gPSBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHsgZGlkU3Rhc2gsIHN0YWdlZCB9ID0gYXdhaXQgc3Rhc2hJbmNsdWRlVW50cmFja2VkS2VlcEluZGV4KCk7XG4gIHRyeSB7XG4gICAgYXdhaXQgbGludFN0YWdlZCgpO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChkaWRTdGFzaCkge1xuICAgICAgYXdhaXQgYXBwbHlTdGFzaGVkKCkudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgIGlmIChyZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKHJlc3VsdC5lcnJvcik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlc3VsdC5zdGF0dXMgIT09IDApIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xuICAgICAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAgICAgJ1xcblRvIGF0IGxlYXN0IHJlc3RvcmUgbGlzdCBvZiBzdGFnZWQgZmlsZXMgYWZ0ZXIgcmVzb2x1dGlvbiwgdHJ5IHRoaXM6IFxcblxcbicsXG4gICAgICAgICAgICBgZ2l0IHJlc2V0ICYmIGdpdCBhZGQgJHtzdGFnZWRcbiAgICAgICAgICAgICAgLm1hcCgoZmlsZSkgPT4gYCcke2ZpbGV9J2ApXG4gICAgICAgICAgICAgIC5qb2luKCcgJyl9IFxcblxcbmBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufTtcblxuYXdhaXQgcnVuKCk7XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBTyxTQUFBLElBQUEsQ0FBaUIsRUFBc0IsRUFBQTtBQUM1QyxFQUFJLElBQUEsS0FBQSxDQUFBO0FBQ0osRUFBQSxJQUFJLFVBQWEsR0FBQSxLQUFBLENBQUE7QUFDakIsRUFBQSxPQUFPLE1BQVM7QUFDZCxJQUFBLElBQUksVUFBWSxFQUFBO0FBQ2QsTUFBTyxPQUFBLEtBQUEsQ0FBQTtBQUFBLEtBQ1Q7QUFDQSxJQUFBLEtBQUEsR0FBUSxFQUFHLEVBQUEsQ0FBQTtBQUNYLElBQWEsVUFBQSxHQUFBLElBQUEsQ0FBQTtBQUNiLElBQU8sT0FBQSxLQUFBLENBQUE7QUFBQSxHQUNULENBQUE7QUFDRjs7QUNUQSxNQUFNLFNBQVMsQ0FBQyxPQUFBLEVBQVMsTUFBUSxFQUFBLE1BQUEsRUFBUSxTQUFTLE9BQU8sQ0FBQSxDQUFBO0FBbUJ6RCxNQUFNLGtCQUFBLEdBQXFCLENBQUMsS0FBNEIsS0FBQTtBQUN0RCxFQUFBLElBQUksVUFBVSxLQUFPLEVBQUE7QUFDbkIsSUFBQSxPQUFPLEVBQUMsQ0FBQTtBQUFBLEdBQ1Y7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
