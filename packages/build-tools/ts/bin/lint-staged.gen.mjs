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
    return {
      ...acc,
      [lvl]: enabled.includes(lvl) ? ["fatal", "error"].includes(lvl) ? error : log : noop
    };
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

const binPath = (bin) => new URL(`../node_modules/.bin/${bin}`, import.meta.url).pathname;
async function runBin(bin, args = process.argv.slice(2)) {
  await spawnToPromise(binPath(bin), args, {
    stdio: "inherit"
  });
}

const lintStaged = async () => {
  await runBin("lint-staged", process.argv.slice(2).filter((arg) => arg !== "--dry-run"));
};
const spawnWithOutputWhenFailed = async (...parameters) => {
  const result = await spawnResult(...parameters);
  if (result.error) {
    console.error(result.output.join(""));
    return Promise.reject(result.error);
  }
  return Promise.resolve(result);
};
const stashIncludeUntrackedKeepIndex = async () => {
  const split = (out) => out.split("\n").filter(Boolean);
  const [staged, modified, untracked] = await Promise.all([
    spawnOutput("git", "diff --name-only --cached".split(" ")).then(split),
    spawnOutput("git", "diff --name-only".split(" ")).then(split),
    spawnOutput("git", "ls-files --others --exclude-standard --full-name".split(" ")).then(split)
  ]);
  const didStash = modified.length > 0 || untracked.length > 0;
  if (didStash) {
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
  return { staged, modified, untracked, didStash };
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGludC1zdGFnZWQuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vc3JjL3V0aWxzL29uY2UudHMiLCIuLi9zcmMvbG9nZ2VyL2xvZ2dlci50cyIsIi4uL3NyYy91dGlscy9zdGFja1RyYWNlLnRzIiwiLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25Ub1Byb21pc2UudHMiLCIuLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdC50cyIsIi4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduT3V0cHV0LnRzIiwiLi4vc3JjL2Jpbi9ydW5CaW4udHMiLCIuLi9zcmMvYmluL2xpbnQtc3RhZ2VkLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBvbmNlPFQ+KGZuOiAoKSA9PiBUKTogKCkgPT4gVCB7XG4gIGxldCB2YWx1ZTogVDtcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcbiAgcmV0dXJuICgpOiBUID0+IHtcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICB2YWx1ZSA9IGZuKCk7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xufVxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJy4uL3V0aWxzL29uY2UnO1xuXG5jb25zdCBsZXZlbHMgPSBbJ2RlYnVnJywgJ2luZm8nLCAnd2FybicsICdlcnJvcicsICdmYXRhbCddIGFzIGNvbnN0O1xuXG50eXBlIExvZ0xldmVsID0gdHlwZW9mIGxldmVsc1tudW1iZXJdO1xuXG50eXBlIFBhcmFtcyA9IFBhcmFtZXRlcnM8dHlwZW9mIGNvbnNvbGUubG9nPjtcblxudHlwZSBMb2dnZXIgPSB7XG4gIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgaW5mbyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGxvZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbn07XG5cbmNvbnN0IGVuYWJsZWRMZXZlbHNBZnRlciA9IChsZXZlbDogTG9nTGV2ZWwgfCAnb2ZmJykgPT4ge1xuICBpZiAobGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIGNvbnN0IGluZGV4ID0gbGV2ZWxzLmZpbmRJbmRleCgoaXRlbSkgPT4gaXRlbSA9PT0gbGV2ZWwpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxldmVsJyk7XG4gIH1cbiAgcmV0dXJuIGxldmVscy5zbGljZShpbmRleCk7XG59O1xuXG5jb25zdCBpc0xldmVsID0gKGxldmVsPzogc3RyaW5nKTogbGV2ZWwgaXMgTG9nTGV2ZWwgPT4ge1xuICByZXR1cm4gbGV2ZWxzLmluY2x1ZGVzKGxldmVsIGFzIExvZ0xldmVsKTtcbn07XG5cbmNvbnN0IHZlcmJvc2l0eU9wdCA9IChhcmdzID0gcHJvY2Vzcy5hcmd2KTogTG9nTGV2ZWwgfCAnb2ZmJyA9PiB7XG4gIGNvbnN0IGluZGV4ID0gYXJncy5maW5kSW5kZXgoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gJy0tdmVyYm9zaXR5Jyk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICByZXR1cm4gJ2luZm8nO1xuICB9XG4gIGNvbnN0IGxldmVsID0gYXJnc1tpbmRleCArIDFdO1xuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiAnb2ZmJztcbiAgfVxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XG4gICAgcmV0dXJuICdpbmZvJztcbiAgfVxuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5jb25zdCBlbmFibGVkTGV2ZWxzID0gb25jZSgoKSA9PiBlbmFibGVkTGV2ZWxzQWZ0ZXIodmVyYm9zaXR5T3B0KCkpKTtcblxuY29uc3Qgbm9vcCA9ICguLi5fYXJnczogUGFyYW1zKSA9PiB7XG4gIHJldHVybjtcbn07XG5cbmNvbnN0IGxvZyA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5sb2coLi4uYXJncyk7XG59O1xuXG5jb25zdCBlcnJvciA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5lcnJvciguLi5hcmdzKTtcbn07XG5cbmNvbnN0IGNyZWF0ZUxvZ2dlciA9IChlbmFibGVkID0gZW5hYmxlZExldmVscygpKSA9PiB7XG4gIHJldHVybiBsZXZlbHMucmVkdWNlKFxuICAgIChhY2MsIGx2bCkgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uYWNjLFxuICAgICAgICBbbHZsXTogZW5hYmxlZC5pbmNsdWRlcyhsdmwpXG4gICAgICAgICAgPyBbJ2ZhdGFsJywgJ2Vycm9yJ10uaW5jbHVkZXMobHZsKVxuICAgICAgICAgICAgPyBlcnJvclxuICAgICAgICAgICAgOiBsb2dcbiAgICAgICAgICA6IG5vb3AsXG4gICAgICB9O1xuICAgIH0sXG4gICAge1xuICAgICAgbG9nOiBlbmFibGVkLmluY2x1ZGVzKCdpbmZvJykgPyBsb2cgOiBub29wLFxuICAgIH0gYXMgTG9nZ2VyXG4gICk7XG59O1xuXG5leHBvcnQgY29uc3QgbG9nZ2VyOiBMb2dnZXIgPSBPYmplY3QuZnJlZXplKGNyZWF0ZUxvZ2dlcigpKTtcbiIsIi8qKlxuICogQ2FwdHVyZSB0aGUgc3RhY2sgdHJhY2UgYW5kIGFsbG93IHRvIGVucmljaCBleGNlcHRpb25zIHRocm93biBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2tzXG4gKiB3aXRoIGFkZGl0aW9uYWwgc3RhY2sgaW5mb3JtYXRpb24gY2FwdHVyZWQgYXQgdGhlIG1vbWVudCBvZiB0aGUgY2FsbCBvZiB0aGlzIGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYXB0dXJlU3RhY2tUcmFjZShyZW1vdmUgPSAwKSB7XG4gIGNvbnN0IHN0YWNrQ29udGFpbmVyID0ge1xuICAgIHN0YWNrOiAnJyxcbiAgfTtcbiAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2Uoc3RhY2tDb250YWluZXIpO1xuICBjb25zdCBzdGFja1RyYWNlID0gc3RhY2tDb250YWluZXIuc3RhY2tcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLnNsaWNlKDYgKyByZW1vdmUpXG4gICAgLmpvaW4oJ1xcbicpO1xuICByZXR1cm4ge1xuICAgIC8qKlxuICAgICAqIENhcHR1cmVkIHN0YWNrIHRyYWNlIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgc3RhY2tUcmFjZSxcbiAgICAvKipcbiAgICAgKiBDYW4gYmUgY2FsbGVkIGluIGFzeW5jaHJvbm91cyBjYWxsYmFjayB0byBlbnJpY2ggZXhjZXB0aW9ucyB3aXRoIGFkZGl0aW9uYWwgaW5mb3JtYXRpb25cbiAgICAgKiBAcGFyYW0gZXJyIEV4Y2VwdGlvbiB0byBlbnJpY2ggLSBpdCBpcyBnb2luZyB0byBoYXZlIGl0cyBgLnN0YWNrYCBwcm9wIG11dGF0ZWRcbiAgICAgKiBAcmV0dXJucyBTYW1lIGV4Y2VwdGlvblxuICAgICAqL1xuICAgIHByZXBhcmVGb3JSZXRocm93OiAoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgY29uc3Qgb2xkU3RhY2tUcmFjZSA9IGVyci5zdGFjayA/PyAnJy5zcGxpdCgnXFxuJykuc2xpY2UoMSkuam9pbignXFxuJyk7XG4gICAgICBlcnIuc3RhY2sgPSBgJHtlcnIubmFtZSB8fCAnRXJyb3InfTogJHtcbiAgICAgICAgZXJyLm1lc3NhZ2VcbiAgICAgIH1cXG4ke29sZFN0YWNrVHJhY2V9XFxuJHtzdGFja1RyYWNlfWA7XG4gICAgICByZXR1cm4gZXJyO1xuICAgIH0sXG4gIH07XG59XG4iLCJpbXBvcnQgdHlwZSB7IFNwYXduT3B0aW9ucyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgQ2hpbGRQcm9jZXNzIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHR5cGUgeyBBc3NpZ24gfSBmcm9tICd1dGlsaXR5LXR5cGVzJztcblxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBjYXB0dXJlU3RhY2tUcmFjZSB9IGZyb20gJy4uL3V0aWxzL3N0YWNrVHJhY2UnO1xuXG5leHBvcnQgdHlwZSBTcGF3blRvUHJvbWlzZUV4dHJhID0ge1xuICBleGl0Q29kZXM/OiBudW1iZXJbXSB8ICdpbmhlcml0JyB8ICdhbnknO1xufTtcblxudHlwZSBTaGFyZWRPcHRzID0gUGljazxTcGF3bk9wdGlvbnMsICdjd2QnPjtcblxudHlwZSBTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4gPSBbXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgYXJncz86IFJlYWRvbmx5QXJyYXk8c3RyaW5nPixcbiAgb3B0aW9ucz86IEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+XG5dO1xuXG5leHBvcnQgdHlwZSBTcGF3blBhcmFtZXRlck1peDxFIGV4dGVuZHMgb2JqZWN0ID0gU3Bhd25Ub1Byb21pc2VFeHRyYT4gPVxuICB8IFtjcDogQ2hpbGRQcm9jZXNzLCBleHRyYU9wdHM/OiBBc3NpZ248RSwgU2hhcmVkT3B0cz5dXG4gIHwgU3Bhd25BcmdzPEU+O1xuXG5leHBvcnQgZnVuY3Rpb24gaXNTcGF3bkFyZ3M8RSBleHRlbmRzIG9iamVjdD4oXG4gIGFyZ3M6IFNwYXduUGFyYW1ldGVyTWl4PEU+XG4pOiBhcmdzIGlzIFNwYXduQXJnczxFPiB7XG4gIHJldHVybiAhKGFyZ3NbMF0gaW5zdGFuY2VvZiBDaGlsZFByb2Nlc3MpICYmIHR5cGVvZiBhcmdzWzBdID09PSAnc3RyaW5nJztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNwYXduV2l0aFNwYXduUGFyYW1ldGVyczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgcGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbikge1xuICBjb25zdCBbY2hpbGQsIFtjb21tYW5kLCBhcmdzLCBvcHRzXV0gPSBpc1NwYXduQXJncyhwYXJhbWV0ZXJzKVxuICAgID8gW1xuICAgICAgICBzcGF3biguLi4ocGFyYW1ldGVycyBhcyB1bmtub3duIGFzIFBhcmFtZXRlcnM8dHlwZW9mIHNwYXduPikpLFxuICAgICAgICBwYXJhbWV0ZXJzLFxuICAgICAgXVxuICAgIDogW1xuICAgICAgICBwYXJhbWV0ZXJzWzBdLFxuICAgICAgICBbXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmZpbGUsXG4gICAgICAgICAgcGFyYW1ldGVyc1swXS5zcGF3bmFyZ3Muc2xpY2UoMSksXG4gICAgICAgICAgcGFyYW1ldGVyc1sxXSBhcyBBc3NpZ248U3Bhd25PcHRpb25zLCBFPixcbiAgICAgICAgXSxcbiAgICAgIF07XG4gIHJldHVybiB7XG4gICAgY2hpbGQsXG4gICAgY29tbWFuZCxcbiAgICBhcmdzLFxuICAgIG9wdHMsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blRvUHJvbWlzZShcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXhcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB7IGNoaWxkLCBjb21tYW5kLCBhcmdzLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHsgcHJlcGFyZUZvclJldGhyb3cgfSA9IGNhcHR1cmVTdGFja1RyYWNlKCk7XG5cbiAgLy8gYnkgZGVmYXVsdCB3ZSBkbyBub3QgdGhyb3cgaWYgZXhpdCBjb2RlIGlzIG5vbi16ZXJvXG4gIC8vIGFuZCBpbnN0ZWFkIGp1c3QgaW5oZXJpdCB0aGUgZXhpdCBjb2RlIGludG8gdGhlIG1haW5cbiAgLy8gcHJvY2Vzc1xuICBjb25zdCBleGl0Q29kZXMgPSBvcHRzPy5leGl0Q29kZXMgfHwgJ2luaGVyaXQnO1xuXG4gIGNvbnN0IGN3ZCA9IG9wdHM/LmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY21kID0gKCkgPT4gW2NvbW1hbmQsIC4uLihhcmdzID8gYXJncyA6IFtdKV0uam9pbignICcpO1xuXG4gIGxvZ2dlci5sb2coWyc+JywgY21kKCldLmpvaW4oJyAnKSwgLi4uKGN3ZCA/IFtgaW4gJHtjd2R9YF0gOiBbXSkpO1xuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMsIHJlaikgPT5cbiAgICBjaGlsZFxuICAgICAgLm9uKCdjbG9zZScsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGV4aXRDb2RlcyAhPT0gJ2luaGVyaXQnICYmXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdhbnknICYmXG4gICAgICAgICAgICAhZXhpdENvZGVzLmluY2x1ZGVzKGNvZGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZWooXG4gICAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihgQ29tbWFuZCBcIiR7Y21kKCl9XCIgaGFzIGZhaWxlZCB3aXRoIGNvZGUgJHtjb2RlfWApXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgICByZWooXG4gICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBGYWlsZWQgdG8gZXhlY3V0ZSBjb21tYW5kIFwiJHtjbWQoKX1cIiAtICR7c2lnbmFsfWApXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLm9uKCdlcnJvcicsIHJlailcbiAgKTtcbiAgLy8gaW5oZXJpdCBleGl0IGNvZGVcbiAgaWYgKGV4aXRDb2RlcyA9PT0gJ2luaGVyaXQnKSB7XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIGNoaWxkLmV4aXRDb2RlID09PSAnbnVtYmVyJyAmJlxuICAgICAgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJyB8fCBwcm9jZXNzLmV4aXRDb2RlID09PSAwKVxuICAgICkge1xuICAgICAgcHJvY2Vzcy5leGl0Q29kZSA9IGNoaWxkLmV4aXRDb2RlO1xuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IHsgYXNzZXJ0IH0gZnJvbSAnY29uc29sZSc7XG5cbmltcG9ydCB0eXBlIHsgU3Bhd25QYXJhbWV0ZXJNaXgsIFNwYXduVG9Qcm9taXNlRXh0cmEgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcblxuZXhwb3J0IHR5cGUgRXh0cmFTcGF3blJlc3VsdE9wdHMgPSB7XG4gIG91dHB1dD86IFsnc3Rkb3V0JyB8ICdzdGRlcnInLCAuLi5BcnJheTwnc3Rkb3V0JyB8ICdzdGRlcnInPl07XG59ICYgU3Bhd25Ub1Byb21pc2VFeHRyYTtcblxudHlwZSBTcGF3blJlc3VsdFJldHVybiA9IHtcbiAgcGlkPzogbnVtYmVyO1xuICBvdXRwdXQ6IHN0cmluZ1tdO1xuICBzdGRvdXQ6IHN0cmluZztcbiAgc3RkZXJyOiBzdHJpbmc7XG4gIHN0YXR1czogbnVtYmVyIHwgbnVsbDtcbiAgc2lnbmFsOiBOb2RlSlMuU2lnbmFscyB8IG51bGw7XG4gIGVycm9yPzogRXJyb3IgfCB1bmRlZmluZWQ7XG59O1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25SZXN1bHQoXG4gIC4uLnBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4PEV4dHJhU3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxTcGF3blJlc3VsdFJldHVybj4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IGNvbWJpbmVkRGF0YTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc3Rkb3V0RGF0YTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc3RkZXJyRGF0YTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgb3V0cHV0ID0gb3B0cz8ub3V0cHV0ID8/IFsnc3Rkb3V0JywgJ3N0ZGVyciddO1xuICBpZiAob3V0cHV0LmluY2x1ZGVzKCdzdGRvdXQnKSkge1xuICAgIGFzc2VydChcbiAgICAgICEhY2hpbGQuc3Rkb3V0LFxuICAgICAgJ0V4cGVjdGVkIFwiLnN0ZG91dFwiIHRvIGJlIGRlZmluZWQsIHdoaWNoIHdpbGwgb25seSBiZSBkZWZpbmVkIGlmIGNoaWxkIHByb2Nlc3MgaXMgc3Bhd25lZCB3aXRoIGNvcnJlY3QgcGFyYW1ldGVycydcbiAgICApO1xuICAgIGNoaWxkLnN0ZG91dD8uc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3Rkb3V0Py5vbignZGF0YScsIChkYXRhOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbWJpbmVkRGF0YS5wdXNoKGRhdGEpO1xuICAgICAgc3Rkb3V0RGF0YS5wdXNoKGRhdGEpO1xuICAgIH0pO1xuICB9XG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZGVycicpKSB7XG4gICAgYXNzZXJ0KFxuICAgICAgISFjaGlsZC5zdGRlcnIsXG4gICAgICAnRXhwZWN0ZWQgXCIuc3RkZXJyXCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xuICAgICk7XG4gICAgY2hpbGQuc3RkZXJyPy5zZXRFbmNvZGluZygndXRmLTgnKTtcbiAgICBjaGlsZC5zdGRlcnI/Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW1xuICAgIHNwYXduVG9Qcm9taXNlKGNoaWxkLCB7XG4gICAgICBleGl0Q29kZXM6IG9wdHM/LmV4aXRDb2RlcyA/PyAnYW55JyxcbiAgICAgIGN3ZDogb3B0cz8uY3dkLFxuICAgIH0pLFxuICBdKTtcbiAgcmV0dXJuIHtcbiAgICBwaWQ6IGNoaWxkLnBpZCxcbiAgICBzaWduYWw6IGNoaWxkLnNpZ25hbENvZGUsXG4gICAgc3RhdHVzOiBjaGlsZC5leGl0Q29kZSxcbiAgICBnZXQgb3V0cHV0KCkge1xuICAgICAgcmV0dXJuIGNvbWJpbmVkRGF0YTtcbiAgICB9LFxuICAgIGdldCBzdGRlcnIoKSB7XG4gICAgICByZXR1cm4gc3RkZXJyRGF0YS5qb2luKCcnKTtcbiAgICB9LFxuICAgIGdldCBzdGRvdXQoKSB7XG4gICAgICByZXR1cm4gc3Rkb3V0RGF0YS5qb2luKCcnKTtcbiAgICB9LFxuICAgIGdldCBlcnJvcigpIHtcbiAgICAgIHJldHVybiByZXN1bHQuc3RhdHVzID09PSAncmVqZWN0ZWQnXG4gICAgICAgID8gKHJlc3VsdC5yZWFzb24gYXMgRXJyb3IpXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIH0sXG4gIH07XG59XG4iLCJpbXBvcnQgdHlwZSB7IEV4dHJhU3Bhd25SZXN1bHRPcHRzIH0gZnJvbSAnLi9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBzcGF3blJlc3VsdCB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8RXh0cmFTcGF3blJlc3VsdE9wdHM+XG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCB7XG4gICAgLi4ub3B0cyxcbiAgICBleGl0Q29kZXM6IG9wdHM/LmV4aXRDb2RlcyA/PyBbMF0sXG4gIH0pO1xuICByZXR1cm4gcmVzdWx0Lm91dHB1dC5qb2luKCcnKTtcbn1cbiIsImltcG9ydCB7IHNwYXduVG9Qcm9taXNlIH0gZnJvbSAnLi4vY2hpbGQtcHJvY2Vzcyc7XG5cbi8vIE5PVEU6IHBhdGggcmVsYXRpdmUgdG8gdGhlIC4vYmluIGF0IHRoZSByb290IG9mIHRoZSBwYWNrYWdlIHdoZXJlXG4vLyB0aGlzIGZpbGUgaXMgZ29pbmcgdG8gcmVzaWRlXG5jb25zdCBiaW5QYXRoID0gKGJpbjogc3RyaW5nKSA9PlxuICBuZXcgVVJMKGAuLi9ub2RlX21vZHVsZXMvLmJpbi8ke2Jpbn1gLCBpbXBvcnQubWV0YS51cmwpLnBhdGhuYW1lO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuQmluKGJpbjogc3RyaW5nLCBhcmdzID0gcHJvY2Vzcy5hcmd2LnNsaWNlKDIpKSB7XG4gIGF3YWl0IHNwYXduVG9Qcm9taXNlKGJpblBhdGgoYmluKSwgYXJncywge1xuICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gIH0pO1xufVxuIiwiaW1wb3J0IHsgc3Bhd25PdXRwdXQgfSBmcm9tICcuLi9jaGlsZC1wcm9jZXNzJztcbmltcG9ydCB7IHNwYXduUmVzdWx0IH0gZnJvbSAnLi4vY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBydW5CaW4gfSBmcm9tICcuL3J1bkJpbic7XG5cbmNvbnN0IGxpbnRTdGFnZWQgPSBhc3luYyAoKSA9PiB7XG4gIGF3YWl0IHJ1bkJpbihcbiAgICAnbGludC1zdGFnZWQnLFxuICAgIHByb2Nlc3MuYXJndi5zbGljZSgyKS5maWx0ZXIoKGFyZykgPT4gYXJnICE9PSAnLS1kcnktcnVuJylcbiAgKTtcbn07XG5cbmNvbnN0IHNwYXduV2l0aE91dHB1dFdoZW5GYWlsZWQgPSBhc3luYyAoXG4gIC4uLnBhcmFtZXRlcnM6IFBhcmFtZXRlcnM8dHlwZW9mIHNwYXduUmVzdWx0PlxuKSA9PiB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KC4uLnBhcmFtZXRlcnMpO1xuICBpZiAocmVzdWx0LmVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihyZXN1bHQub3V0cHV0LmpvaW4oJycpKTtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG59O1xuXG5jb25zdCBzdGFzaEluY2x1ZGVVbnRyYWNrZWRLZWVwSW5kZXggPSBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHNwbGl0ID0gKG91dDogc3RyaW5nKSA9PiBvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbiAgY29uc3QgW3N0YWdlZCwgbW9kaWZpZWQsIHVudHJhY2tlZF0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgc3Bhd25PdXRwdXQoJ2dpdCcsICdkaWZmIC0tbmFtZS1vbmx5IC0tY2FjaGVkJy5zcGxpdCgnICcpKS50aGVuKHNwbGl0KSxcbiAgICBzcGF3bk91dHB1dCgnZ2l0JywgJ2RpZmYgLS1uYW1lLW9ubHknLnNwbGl0KCcgJykpLnRoZW4oc3BsaXQpLFxuICAgIHNwYXduT3V0cHV0KFxuICAgICAgJ2dpdCcsXG4gICAgICAnbHMtZmlsZXMgLS1vdGhlcnMgLS1leGNsdWRlLXN0YW5kYXJkIC0tZnVsbC1uYW1lJy5zcGxpdCgnICcpXG4gICAgKS50aGVuKHNwbGl0KSxcbiAgXSk7XG4gIGNvbnN0IGRpZFN0YXNoID0gbW9kaWZpZWQubGVuZ3RoID4gMCB8fCB1bnRyYWNrZWQubGVuZ3RoID4gMDtcbiAgaWYgKGRpZFN0YXNoKSB7XG4gICAgYXdhaXQgc3Bhd25XaXRoT3V0cHV0V2hlbkZhaWxlZChcbiAgICAgICdnaXQnLFxuICAgICAgJ2NvbW1pdCAtLW5vLXZlcmlmeSAtbSBcImxpbnQtc3RhZ2VkLXRlbXBvcmFyeVwiJy5zcGxpdCgnICcpLFxuICAgICAge1xuICAgICAgICBleGl0Q29kZXM6IFswXSxcbiAgICAgIH1cbiAgICApO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzcGF3bldpdGhPdXRwdXRXaGVuRmFpbGVkKFxuICAgICAgICAnZ2l0JyxcbiAgICAgICAgJ3N0YXNoIHB1c2ggLXUgLS1tZXNzYWdlIGxpbnQtc3RhZ2VkLXRlbXBvcmFyeScuc3BsaXQoJyAnKSxcbiAgICAgICAge1xuICAgICAgICAgIGV4aXRDb2RlczogWzBdLFxuICAgICAgICB9XG4gICAgICApO1xuICAgIH0gZmluYWxseSB7XG4gICAgICAvLyBpZiBzdGFzaGluZyBmYWlsZWQsIHJlc2V0IGFueXdheVxuICAgICAgYXdhaXQgc3Bhd25XaXRoT3V0cHV0V2hlbkZhaWxlZCgnZ2l0JywgJ3Jlc2V0IC0tc29mdCBIRUFEfjEnLnNwbGl0KCcgJyksIHtcbiAgICAgICAgZXhpdENvZGVzOiBbMF0sXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgc3RhZ2VkLCBtb2RpZmllZCwgdW50cmFja2VkLCBkaWRTdGFzaCB9O1xufTtcblxuY29uc3QgYXBwbHlTdGFzaGVkID0gYXN5bmMgKCkgPT4gc3Bhd25SZXN1bHQoJ2dpdCcsICdzdGFzaCBwb3AnLnNwbGl0KCcgJykpO1xuXG5jb25zdCBydW4gPSBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHsgZGlkU3Rhc2gsIHN0YWdlZCB9ID0gYXdhaXQgc3Rhc2hJbmNsdWRlVW50cmFja2VkS2VlcEluZGV4KCk7XG4gIHRyeSB7XG4gICAgYXdhaXQgbGludFN0YWdlZCgpO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChkaWRTdGFzaCkge1xuICAgICAgYXdhaXQgYXBwbHlTdGFzaGVkKCkudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgIGlmIChyZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKHJlc3VsdC5lcnJvcik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlc3VsdC5zdGF0dXMgIT09IDApIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xuICAgICAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAgICAgJ1xcblRvIGF0IGxlYXN0IHJlc3RvcmUgbGlzdCBvZiBzdGFnZWQgZmlsZXMgYWZ0ZXIgcmVzb2x1dGlvbiwgdHJ5IHRoaXM6IFxcblxcbicsXG4gICAgICAgICAgICBgZ2l0IHJlc2V0ICYmIGdpdCBhZGQgJHtzdGFnZWRcbiAgICAgICAgICAgICAgLm1hcCgoZmlsZSkgPT4gYCcke2ZpbGV9J2ApXG4gICAgICAgICAgICAgIC5qb2luKCcgJyl9IFxcblxcbmBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufTtcblxuYXdhaXQgcnVuKCk7XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBTyxTQUFBLElBQUEsQ0FBaUIsRUFBc0IsRUFBQTtBQUM1QyxFQUFJLElBQUEsS0FBQSxDQUFBO0FBQ0osRUFBQSxJQUFJLFVBQWEsR0FBQSxLQUFBLENBQUE7QUFDakIsRUFBQSxPQUFPLE1BQVM7QUFDZCxJQUFBLElBQUksVUFBWSxFQUFBO0FBQ2QsTUFBTyxP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
