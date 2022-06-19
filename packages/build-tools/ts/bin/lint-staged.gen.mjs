#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed
import { spawn } from 'node:child_process';
import { realpath, stat, mkdir, symlink, copyFile, appendFile, rm } from 'node:fs/promises';
import { relative, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { assert as assert$1 } from 'node:console';
import assert from 'node:assert';
import fg from 'fast-glob';
import { randomBytes } from 'node:crypto';

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

const determineMonorepoRoot = (candidate) => {
  const result = /(.*(?=\/packages\/))|(.*(?=\/node_modules\/))|(.*)/.exec(candidate);
  assert(!!result);
  const [, packagesRoot, nodeModulesRoot, entirePath] = result;
  const rootPath = packagesRoot || nodeModulesRoot || entirePath;
  assert(!!rootPath);
  return rootPath;
};
const guessMonorepoRoot = once(() => {
  return determineMonorepoRoot(process.env["INIT_CWD"] || process.cwd());
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

async function spawnToPromise(child, opts) {
  const { prepareForRethrow } = captureStackTrace();
  const exitCodes = (opts == null ? void 0 : opts.exitCodes) || "inherit";
  const cwd = guessMonorepoRoot();
  console.log([">", child.spawnfile, ...child.spawnargs.slice(1)].map((entry) => entry.replace(cwd + "/", "./")).join(" "), ...(opts == null ? void 0 : opts.cwd) ? [`in ${opts.cwd}`] : []);
  await new Promise((res, rej) => child.on("close", (code, signal) => {
    if (typeof code === "number") {
      if (exitCodes !== "inherit" && !exitCodes.includes(code)) {
        rej(prepareForRethrow(new Error(`Process has failed with code ${code}`)));
      } else {
        res();
      }
    } else if (signal) {
      rej(prepareForRethrow(new Error(`Failed to execute process: ${signal}`)));
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

async function spawnOutput(child, opts) {
  var _a, _b, _c, _d;
  const combinedData = [];
  const output = (opts == null ? void 0 : opts.output) ?? ["stdout", "stderr"];
  if (output.includes("stdout")) {
    assert$1(!!child.stdout, 'Expected ".stdout" to be defined, which will only be defined if child process is spawned with correct parameters');
    (_a = child.stdout) == null ? void 0 : _a.setEncoding("utf-8");
    (_b = child.stdout) == null ? void 0 : _b.on("data", (data) => {
      combinedData.push(data);
    });
  }
  if (output.includes("stderr")) {
    assert$1(!!child.stderr, 'Expected ".stderr" to be defined, which will only be defined if child process is spawned with correct parameters');
    (_c = child.stderr) == null ? void 0 : _c.setEncoding("utf-8");
    (_d = child.stderr) == null ? void 0 : _d.on("data", (data) => {
      combinedData.push(data);
    });
  }
  await spawnToPromise(child, {
    exitCodes: (opts == null ? void 0 : opts.exitCodes) ?? [0]
  });
  return combinedData.join("");
}

var __defProp$1 = Object.defineProperty;
var __defProps$1 = Object.defineProperties;
var __getOwnPropDescs$1 = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols$1 = Object.getOwnPropertySymbols;
var __hasOwnProp$1 = Object.prototype.hasOwnProperty;
var __propIsEnum$1 = Object.prototype.propertyIsEnumerable;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues$1 = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp$1.call(b, prop))
      __defNormalProp$1(a, prop, b[prop]);
  if (__getOwnPropSymbols$1)
    for (var prop of __getOwnPropSymbols$1(b)) {
      if (__propIsEnum$1.call(b, prop))
        __defNormalProp$1(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps$1 = (a, b) => __defProps$1(a, __getOwnPropDescs$1(b));
async function entriesFromGlobs({
  source,
  exclude,
  include,
  options
}) {
  const entries = await fg([
    ...exclude ? exclude.map((glob) => `!${source || "."}/${glob}`) : [],
    ...include.map((glob) => `${source || "."}/${glob}`)
  ], __spreadProps$1(__spreadValues$1({
    followSymbolicLinks: false
  }, options), {
    onlyFiles: false,
    stats: true,
    objectMode: true
  }));
  return entries;
}
async function entriesFromBasic({ files, source }) {
  const entries = await Promise.all(files.map((path) => stat(join(source || ".", path)).then((stats) => {
    if (stats.isDirectory()) {
      return entriesFromGlobs({
        source,
        include: [`${path}**/*`],
        options: {
          dot: true
        }
      });
    }
    return [
      {
        path: join(source || ".", path),
        stats
      }
    ];
  })));
  return entries.flatMap((entries2) => entries2);
}
function getDeps$1(opts) {
  var _a;
  const normalDeps = {
    mkdir,
    realpath,
    symlink,
    copyFile
  };
  const dryRunDeps = {
    mkdir: (...[directory]) => {
      console.log("mkdir", { directory });
      return Promise.resolve();
    },
    realpath,
    symlink: (...[source, target]) => {
      console.log("symlink", { source, target });
      return Promise.resolve();
    },
    copyFile: (...[source, target]) => {
      console.log("copyFile", { source, target });
      return Promise.resolve();
    }
  };
  const deps = ((_a = opts.options) == null ? void 0 : _a.dryRun) ? dryRunDeps : normalDeps;
  return deps;
}
async function copyFiles(opts) {
  var _a, _b;
  const deps = getDeps$1(opts);
  const entries = "include" in opts ? await entriesFromGlobs(opts) : "files" in opts ? await entriesFromBasic(opts) : [];
  if ((_a = opts.options) == null ? void 0 : _a.dryRun) {
    console.log("entries", entries.map((entry) => entry.path));
  }
  const followSymbolicLinks = ((_b = opts.options) == null ? void 0 : _b.followSymbolicLinks) ?? false;
  const createdDirs = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const sourcePath = entry.path;
    const relativePath = relative(opts.source || ".", sourcePath);
    const targetPath = join(opts.destination, relativePath);
    const info = entry.stats;
    const targetDirectory = dirname(targetPath);
    if (!info.isDirectory() && !createdDirs.has(targetDirectory)) {
      await deps.mkdir(targetDirectory, {
        recursive: true
      });
      createdDirs.add(targetDirectory);
    }
    if (info.isSymbolicLink() && !followSymbolicLinks) {
      const realSourcePath = await realpath(sourcePath);
      await deps.symlink(realSourcePath, targetPath).catch(async (err) => {
        if (err.code === "EEXIST") {
          const existingRealSourcePath = await realpath(targetPath);
          if (existingRealSourcePath !== realSourcePath) {
            return Promise.reject(err);
          } else {
            return Promise.resolve();
          }
        }
      });
    } else if (info.isFile()) {
      await deps.copyFile(sourcePath, targetPath);
    } else if (info.isDirectory()) {
      await deps.mkdir(targetPath, {
        recursive: true
      });
    } else ;
  }
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const randomText = (length) => {
  const usefulMax = alphabet.length * 4 - 1;
  let result = "";
  while (result.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte <= usefulMax) {
        result += alphabet.charAt(byte % alphabet.length);
      }
      if (result.length === length) {
        break;
      }
    }
  }
  return result;
};

const binPath = (bin) => new URL(`../node_modules/.bin/${bin}`, import.meta.url).pathname;
async function runBin(bin, args = process.argv.slice(2)) {
  await spawnToPromise(spawn(binPath(bin), args, {
    stdio: "inherit"
  }));
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
const getDeps = (dryRun) => {
  const deps = {
    copyFiles,
    appendFile,
    rm
  };
  const dryRunDeps = {
    copyFiles: async (...[opts]) => {
      await copyFiles(__spreadProps(__spreadValues({}, opts), {
        options: __spreadProps(__spreadValues({}, opts.options), {
          dryRun: true
        })
      }));
    },
    appendFile: async (...[filePath, data]) => {
      console.log("appendFile", {
        filePath,
        data
      });
      return Promise.resolve();
    },
    rm: async (...[path]) => {
      console.log("rm", {
        path
      });
      return Promise.resolve();
    }
  };
  return dryRun ? dryRunDeps : deps;
};
const saveUntracked = async () => {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("Running in DRY RUN mode");
  }
  const output = await spawnOutput(spawn("git", "ls-files --others --exclude-standard --full-name".split(" ")));
  const files = output.split("\n").filter(Boolean);
  const id = randomText(8);
  const root = join(tmpdir(), "lint-staged-backup");
  const backupPath = join(root, id);
  const deps = getDeps(dryRun);
  const restoreUntracked = async () => {
    if (files.length === 0) {
      return;
    }
    try {
      await deps.copyFiles({
        source: backupPath,
        files,
        destination: process.cwd()
      });
      await deps.appendFile(join(root, "history.txt"), "copied " + id + "\n", {
        encoding: "utf-8"
      });
      await deps.rm(backupPath, {
        recursive: true
      });
      await deps.appendFile(join(root, "history.txt"), "cleaned " + id + "\n", {
        encoding: "utf-8"
      });
    } catch (err) {
      console.log("Failed to restore from backup", backupPath, `Try running "rsync -r ${backupPath} ." to restore manually?`);
      throw err;
    }
  };
  try {
    if (files.length > 0) {
      await deps.copyFiles({
        files,
        destination: backupPath
      });
      await deps.appendFile(join(root, "history.txt"), "added " + id + "\n", {
        encoding: "utf-8"
      });
      await Promise.all(files.map((file) => deps.rm(file, { recursive: true })));
    }
  } catch (err) {
    console.log("Failed to cleanup", {
      files
    }, `Try running "rsync -r ${backupPath} ." to restore them?`);
    await restoreUntracked();
    throw err;
  }
  return {
    restoreUntracked
  };
};
const lintStaged = async () => {
  await runBin("lint-staged", process.argv.slice(2).filter((arg) => arg !== "--dry-run"));
};
const run = async () => {
  const { restoreUntracked } = await saveUntracked();
  try {
    await lintStaged();
  } finally {
    await restoreUntracked();
  }
};
await run();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGludC1zdGFnZWQuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vc3JjL3V0aWxzL29uY2UudHMiLCIuLi9zcmMvZmlsZS1zeXN0ZW0vZ3Vlc3NNb25vcmVwb1Jvb3QudHMiLCIuLi9zcmMvdXRpbHMvc3RhY2tUcmFjZS50cyIsIi4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduVG9Qcm9taXNlLnRzIiwiLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25PdXRwdXQudHMiLCIuLi9zcmMvZmlsZS1zeXN0ZW0vY29weUZpbGVzLnRzIiwiLi4vc3JjL3V0aWxzL3JhbmRvbVRleHQudHMiLCIuLi9zcmMvYmluL3J1bkJpbi50cyIsIi4uL3NyYy9iaW4vbGludC1zdGFnZWQudHMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIG9uY2U8VD4oZm46ICgpID0+IFQpOiAoKSA9PiBUIHtcbiAgbGV0IHZhbHVlOiBUO1xuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xuICByZXR1cm4gKCk6IFQgPT4ge1xuICAgIGlmIChjYWxjdWxhdGVkKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHZhbHVlID0gZm4oKTtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG59XG4iLCJpbXBvcnQgYXNzZXJ0IGZyb20gJ2Fzc2VydCc7XG5cbmltcG9ydCB7IG9uY2UgfSBmcm9tICcuLi91dGlscy9vbmNlJztcblxuY29uc3QgZGV0ZXJtaW5lTW9ub3JlcG9Sb290ID0gKGNhbmRpZGF0ZTogc3RyaW5nKSA9PiB7XG4gIC8vIHRyeSB0byBndWVzcyB3aGF0IHRoZSByb290IGlzIGNvbnNpZGVyaW5nIHRoYXQgb3VyIGNvbW1hbmRzXG4gIC8vIGNhbiBiZSBleGVjdXRlZCBmcm9tIHdpdGhpbiBwYWNrYWdlIGRpcmVjdG9yeSBvciBmcm9tIHRoZSByb290XG4gIGNvbnN0IHJlc3VsdCA9IC8oLiooPz1cXC9wYWNrYWdlc1xcLykpfCguKig/PVxcL25vZGVfbW9kdWxlc1xcLykpfCguKikvLmV4ZWMoXG4gICAgY2FuZGlkYXRlXG4gICk7XG4gIGFzc2VydCghIXJlc3VsdCk7XG4gIGNvbnN0IFssIHBhY2thZ2VzUm9vdCwgbm9kZU1vZHVsZXNSb290LCBlbnRpcmVQYXRoXSA9IHJlc3VsdDtcbiAgY29uc3Qgcm9vdFBhdGggPSBwYWNrYWdlc1Jvb3QgfHwgbm9kZU1vZHVsZXNSb290IHx8IGVudGlyZVBhdGg7XG4gIGFzc2VydCghIXJvb3RQYXRoKTtcbiAgcmV0dXJuIHJvb3RQYXRoO1xufTtcblxuZXhwb3J0IGNvbnN0IGd1ZXNzTW9ub3JlcG9Sb290ID0gb25jZSgoKSA9PiB7XG4gIHJldHVybiBkZXRlcm1pbmVNb25vcmVwb1Jvb3QocHJvY2Vzcy5lbnZbJ0lOSVRfQ1dEJ10gfHwgcHJvY2Vzcy5jd2QoKSk7XG59KTtcbiIsIi8qKlxuICogQ2FwdHVyZSB0aGUgc3RhY2sgdHJhY2UgYW5kIGFsbG93IHRvIGVucmljaCBleGNlcHRpb25zIHRocm93biBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2tzXG4gKiB3aXRoIGFkZGl0aW9uYWwgc3RhY2sgaW5mb3JtYXRpb24gY2FwdHVyZWQgYXQgdGhlIG1vbWVudCBvZiB0aGUgY2FsbCBvZiB0aGlzIGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYXB0dXJlU3RhY2tUcmFjZShyZW1vdmUgPSAwKSB7XG4gIGNvbnN0IHN0YWNrQ29udGFpbmVyID0ge1xuICAgIHN0YWNrOiAnJyxcbiAgfTtcbiAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2Uoc3RhY2tDb250YWluZXIpO1xuICBjb25zdCBzdGFja1RyYWNlID0gc3RhY2tDb250YWluZXIuc3RhY2tcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLnNsaWNlKDYgKyByZW1vdmUpXG4gICAgLmpvaW4oJ1xcbicpO1xuICByZXR1cm4ge1xuICAgIC8qKlxuICAgICAqIENhcHR1cmVkIHN0YWNrIHRyYWNlIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgc3RhY2tUcmFjZSxcbiAgICAvKipcbiAgICAgKiBDYW4gYmUgY2FsbGVkIGluIGFzeW5jaHJvbm91cyBjYWxsYmFjayB0byBlbnJpY2ggZXhjZXB0aW9ucyB3aXRoIGFkZGl0aW9uYWwgaW5mb3JtYXRpb25cbiAgICAgKiBAcGFyYW0gZXJyIEV4Y2VwdGlvbiB0byBlbnJpY2ggLSBpdCBpcyBnb2luZyB0byBoYXZlIGl0cyBgLnN0YWNrYCBwcm9wIG11dGF0ZWRcbiAgICAgKiBAcmV0dXJucyBTYW1lIGV4Y2VwdGlvblxuICAgICAqL1xuICAgIHByZXBhcmVGb3JSZXRocm93OiAoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgY29uc3Qgb2xkU3RhY2tUcmFjZSA9IGVyci5zdGFjayA/PyAnJy5zcGxpdCgnXFxuJykuc2xpY2UoMSkuam9pbignXFxuJyk7XG4gICAgICBlcnIuc3RhY2sgPSBgJHtlcnIubmFtZSB8fCAnRXJyb3InfTogJHtcbiAgICAgICAgZXJyLm1lc3NhZ2VcbiAgICAgIH1cXG4ke29sZFN0YWNrVHJhY2V9XFxuJHtzdGFja1RyYWNlfWA7XG4gICAgICByZXR1cm4gZXJyO1xuICAgIH0sXG4gIH07XG59XG4iLCJpbXBvcnQgdHlwZSB7XG4gIENoaWxkUHJvY2VzcyxcbiAgQ2hpbGRQcm9jZXNzV2l0aG91dE51bGxTdHJlYW1zLFxufSBmcm9tICdjaGlsZF9wcm9jZXNzJztcblxuaW1wb3J0IHsgZ3Vlc3NNb25vcmVwb1Jvb3QgfSBmcm9tICcuLi9maWxlLXN5c3RlbS9ndWVzc01vbm9yZXBvUm9vdCc7XG5pbXBvcnQgeyBjYXB0dXJlU3RhY2tUcmFjZSB9IGZyb20gJy4uL3V0aWxzL3N0YWNrVHJhY2UnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25Ub1Byb21pc2UoXG4gIGNoaWxkOiBDaGlsZFByb2Nlc3MgfCBDaGlsZFByb2Nlc3NXaXRob3V0TnVsbFN0cmVhbXMsXG4gIG9wdHM/OiB7XG4gICAgZXhpdENvZGVzPzogbnVtYmVyW10gfCAnaW5oZXJpdCc7XG4gICAgY3dkPzogc3RyaW5nO1xuICB9XG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgeyBwcmVwYXJlRm9yUmV0aHJvdyB9ID0gY2FwdHVyZVN0YWNrVHJhY2UoKTtcblxuICAvLyBieSBkZWZhdWx0IHdlIGRvIG5vdCB0aHJvdyBpZiBleGl0IGNvZGUgaXMgbm9uLXplcm9cbiAgLy8gYW5kIGluc3RlYWQganVzdCBpbmhlcml0IHRoZSBleGl0IGNvZGUgaW50byB0aGUgbWFpblxuICAvLyBwcm9jZXNzXG4gIGNvbnN0IGV4aXRDb2RlcyA9IG9wdHM/LmV4aXRDb2RlcyB8fCAnaW5oZXJpdCc7XG5cbiAgY29uc3QgY3dkID0gZ3Vlc3NNb25vcmVwb1Jvb3QoKTtcbiAgY29uc29sZS5sb2coXG4gICAgWyc+JywgY2hpbGQuc3Bhd25maWxlLCAuLi5jaGlsZC5zcGF3bmFyZ3Muc2xpY2UoMSldXG4gICAgICAubWFwKChlbnRyeSkgPT4gZW50cnkucmVwbGFjZShjd2QgKyAnLycsICcuLycpKVxuICAgICAgLmpvaW4oJyAnKSxcbiAgICAuLi4ob3B0cz8uY3dkID8gW2BpbiAke29wdHMuY3dkfWBdIDogW10pXG4gICk7XG5cbiAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlcywgcmVqKSA9PlxuICAgIGNoaWxkXG4gICAgICAub24oJ2Nsb3NlJywgKGNvZGUsIHNpZ25hbCkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIGNvZGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgaWYgKGV4aXRDb2RlcyAhPT0gJ2luaGVyaXQnICYmICFleGl0Q29kZXMuaW5jbHVkZXMoY29kZSkpIHtcbiAgICAgICAgICAgIHJlaihcbiAgICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3coXG4gICAgICAgICAgICAgICAgbmV3IEVycm9yKGBQcm9jZXNzIGhhcyBmYWlsZWQgd2l0aCBjb2RlICR7Y29kZX1gKVxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoc2lnbmFsKSB7XG4gICAgICAgICAgcmVqKFxuICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3cobmV3IEVycm9yKGBGYWlsZWQgdG8gZXhlY3V0ZSBwcm9jZXNzOiAke3NpZ25hbH1gKSlcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IHByZXBhcmVGb3JSZXRocm93KG5ldyBFcnJvcignRXhwZWN0ZWQgc2lnbmFsIG9yIGVycm9yIGNvZGUnKSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAub24oJ2Vycm9yJywgcmVqKVxuICApO1xuICAvLyBpbmhlcml0IGV4aXQgY29kZVxuICBpZiAoZXhpdENvZGVzID09PSAnaW5oZXJpdCcpIHtcbiAgICBpZiAoXG4gICAgICB0eXBlb2YgY2hpbGQuZXhpdENvZGUgPT09ICdudW1iZXInICYmXG4gICAgICAodHlwZW9mIHByb2Nlc3MuZXhpdENvZGUgIT09ICdudW1iZXInIHx8IHByb2Nlc3MuZXhpdENvZGUgPT09IDApXG4gICAgKSB7XG4gICAgICBwcm9jZXNzLmV4aXRDb2RlID0gY2hpbGQuZXhpdENvZGU7XG4gICAgfVxuICB9XG59XG4iLCJpbXBvcnQgdHlwZSB7XG4gIENoaWxkUHJvY2VzcyxcbiAgQ2hpbGRQcm9jZXNzV2l0aG91dE51bGxTdHJlYW1zLFxufSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGFzc2VydCB9IGZyb20gJ2NvbnNvbGUnO1xuXG5pbXBvcnQgeyBzcGF3blRvUHJvbWlzZSB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25PdXRwdXQoXG4gIGNoaWxkOiBDaGlsZFByb2Nlc3MgfCBDaGlsZFByb2Nlc3NXaXRob3V0TnVsbFN0cmVhbXMsXG4gIG9wdHM/OiB7XG4gICAgZXhpdENvZGVzPzogbnVtYmVyW107XG4gICAgb3V0cHV0PzogWydzdGRvdXQnIHwgJ3N0ZGVycicsIC4uLkFycmF5PCdzdGRvdXQnIHwgJ3N0ZGVycic+XTtcbiAgfVxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgY29tYmluZWREYXRhOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBvdXRwdXQgPSBvcHRzPy5vdXRwdXQgPz8gWydzdGRvdXQnLCAnc3RkZXJyJ107XG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZG91dCcpKSB7XG4gICAgYXNzZXJ0KFxuICAgICAgISFjaGlsZC5zdGRvdXQsXG4gICAgICAnRXhwZWN0ZWQgXCIuc3Rkb3V0XCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xuICAgICk7XG4gICAgY2hpbGQuc3Rkb3V0Py5zZXRFbmNvZGluZygndXRmLTgnKTtcbiAgICBjaGlsZC5zdGRvdXQ/Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3RkZXJyJykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZGVycixcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRlcnJcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRlcnI/LnNldEVuY29kaW5nKCd1dGYtOCcpO1xuICAgIGNoaWxkLnN0ZGVycj8ub24oJ2RhdGEnLCAoZGF0YTogc3RyaW5nKSA9PiB7XG4gICAgICBjb21iaW5lZERhdGEucHVzaChkYXRhKTtcbiAgICB9KTtcbiAgfVxuICBhd2FpdCBzcGF3blRvUHJvbWlzZShjaGlsZCwge1xuICAgIC8vIHNpbmNlIHdlIGV4cGVjdCBhbiBvdXRwdXQsIHdlIHNob3VsZCBkb3VibGUgY2hlY2tcbiAgICAvLyB0aGF0IHdlIGFyZSBvbmx5IGludGVycHJldGluZyBvdXRwdXQgaWYgdGhlIGNoaWxkIHByb2Nlc3NcbiAgICAvLyBpcyBkb25lIHN1Y2Nlc3NmdWxseVxuICAgIGV4aXRDb2Rlczogb3B0cz8uZXhpdENvZGVzID8/IFswXSxcbiAgfSk7XG4gIHJldHVybiBjb21iaW5lZERhdGEuam9pbignJyk7XG59XG4iLCJpbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcbmltcG9ydCB0eXBlIHsgU3RhdHMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IGNvcHlGaWxlLCBta2RpciwgcmVhbHBhdGgsIHN0YXQsIHN5bWxpbmsgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGRpcm5hbWUsIGpvaW4sIHJlbGF0aXZlIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IHR5cGUgQ29weU9wdHNFeHRyYSA9IFBpY2s8XG4gIGZnLk9wdGlvbnMsXG4gICdjd2QnIHwgJ2RlZXAnIHwgJ2RvdCcgfCAnb25seURpcmVjdG9yaWVzJyB8ICdmb2xsb3dTeW1ib2xpY0xpbmtzJ1xuPjtcblxuZXhwb3J0IHR5cGUgQ29weUdsb2JPcHRzID0ge1xuICAvKipcbiAgICogU291cmNlIGRpcmVjdG9yeVxuICAgKi9cbiAgc291cmNlPzogc3RyaW5nO1xuICAvKipcbiAgICogT25lIG9yIG1vcmUgcGF0dGVybnMgaW5zaWRlIGRpcmVjdG9yeS5cbiAgICpcbiAgICogTk9URTogdGhlIGRpcmVjdG9yeSBzdHJ1Y3R1cmUgb2YgdGhlIG1hdGNoZWQgZmlsZXMvZGlyZWN0b3JpZXMgaXMgZ29pbmcgdG8gYmUgcmV0YWluZWRcbiAgICogcmVsYXRpdmUgdG8gdGhlIHNvdXJjZSBkaXJlY3RvcnlcbiAgICovXG4gIGluY2x1ZGU6IHN0cmluZ1tdO1xuICBleGNsdWRlPzogc3RyaW5nW107XG4gIGRlc3RpbmF0aW9uOiBzdHJpbmc7XG4gIG9wdGlvbnM/OiBDb3B5T3B0c0V4dHJhICYge1xuICAgIGRyeVJ1bj86IGJvb2xlYW47XG4gIH07XG59O1xuXG5leHBvcnQgdHlwZSBDb3B5QmFzaWNPcHRzID0ge1xuICBzb3VyY2U/OiBzdHJpbmc7XG4gIGZpbGVzOiBzdHJpbmdbXTtcbiAgZGVzdGluYXRpb246IHN0cmluZztcbiAgb3B0aW9ucz86IHtcbiAgICBmb2xsb3dTeW1ib2xpY0xpbmtzPzogYm9vbGVhbjtcbiAgICBkcnlSdW4/OiBib29sZWFuO1xuICB9O1xufTtcblxuZXhwb3J0IHR5cGUgQ29weU9wdHMgPSBDb3B5R2xvYk9wdHMgfCBDb3B5QmFzaWNPcHRzO1xuXG5hc3luYyBmdW5jdGlvbiBlbnRyaWVzRnJvbUdsb2JzKHtcbiAgc291cmNlLFxuICBleGNsdWRlLFxuICBpbmNsdWRlLFxuICBvcHRpb25zLFxufTogUGljazxDb3B5R2xvYk9wdHMsICdzb3VyY2UnIHwgJ2luY2x1ZGUnIHwgJ2V4Y2x1ZGUnIHwgJ29wdGlvbnMnPikge1xuICBjb25zdCBlbnRyaWVzID0gYXdhaXQgZmcoXG4gICAgW1xuICAgICAgLi4uKGV4Y2x1ZGUgPyBleGNsdWRlLm1hcCgoZ2xvYikgPT4gYCEke3NvdXJjZSB8fCAnLid9LyR7Z2xvYn1gKSA6IFtdKSxcbiAgICAgIC4uLmluY2x1ZGUubWFwKChnbG9iKSA9PiBgJHtzb3VyY2UgfHwgJy4nfS8ke2dsb2J9YCksXG4gICAgXSxcbiAgICB7XG4gICAgICBmb2xsb3dTeW1ib2xpY0xpbmtzOiBmYWxzZSxcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICBvbmx5RmlsZXM6IGZhbHNlLFxuICAgICAgc3RhdHM6IHRydWUsXG4gICAgICBvYmplY3RNb2RlOiB0cnVlLFxuICAgIH1cbiAgKTtcbiAgcmV0dXJuIGVudHJpZXMgYXMgQXJyYXk8e1xuICAgIHBhdGg6IHN0cmluZztcbiAgICBzdGF0czogU3RhdHM7XG4gIH0+O1xufVxuXG5hc3luYyBmdW5jdGlvbiBlbnRyaWVzRnJvbUJhc2ljKHsgZmlsZXMsIHNvdXJjZSB9OiBDb3B5QmFzaWNPcHRzKSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBmaWxlcy5tYXAoKHBhdGgpID0+XG4gICAgICBzdGF0KGpvaW4oc291cmNlIHx8ICcuJywgcGF0aCkpLnRoZW4oKHN0YXRzKSA9PiB7XG4gICAgICAgIGlmIChzdGF0cy5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgcmV0dXJuIGVudHJpZXNGcm9tR2xvYnMoe1xuICAgICAgICAgICAgc291cmNlLFxuICAgICAgICAgICAgaW5jbHVkZTogW2Ake3BhdGh9KiovKmBdLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICBkb3Q6IHRydWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgcGF0aDogam9pbihzb3VyY2UgfHwgJy4nLCBwYXRoKSxcbiAgICAgICAgICAgIHN0YXRzLFxuICAgICAgICAgIH0sXG4gICAgICAgIF07XG4gICAgICB9KVxuICAgIClcbiAgKTtcbiAgcmV0dXJuIGVudHJpZXMuZmxhdE1hcCgoZW50cmllcykgPT4gZW50cmllcyk7XG59XG5cbmZ1bmN0aW9uIGdldERlcHMob3B0czogQ29weU9wdHMpIHtcbiAgY29uc3Qgbm9ybWFsRGVwcyA9IHtcbiAgICBta2RpcixcbiAgICByZWFscGF0aCxcbiAgICBzeW1saW5rLFxuICAgIGNvcHlGaWxlLFxuICB9O1xuICBjb25zdCBkcnlSdW5EZXBzID0ge1xuICAgIG1rZGlyOiAoLi4uW2RpcmVjdG9yeV06IFBhcmFtZXRlcnM8dHlwZW9mIG1rZGlyPikgPT4ge1xuICAgICAgY29uc29sZS5sb2coJ21rZGlyJywgeyBkaXJlY3RvcnkgfSk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfSxcbiAgICByZWFscGF0aCxcbiAgICBzeW1saW5rOiAoLi4uW3NvdXJjZSwgdGFyZ2V0XTogUGFyYW1ldGVyczx0eXBlb2Ygc3ltbGluaz4pID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKCdzeW1saW5rJywgeyBzb3VyY2UsIHRhcmdldCB9KTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9LFxuICAgIGNvcHlGaWxlOiAoLi4uW3NvdXJjZSwgdGFyZ2V0XTogUGFyYW1ldGVyczx0eXBlb2YgY29weUZpbGU+KSA9PiB7XG4gICAgICBjb25zb2xlLmxvZygnY29weUZpbGUnLCB7IHNvdXJjZSwgdGFyZ2V0IH0pO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH0sXG4gIH07XG4gIGNvbnN0IGRlcHMgPSBvcHRzLm9wdGlvbnM/LmRyeVJ1biA/IGRyeVJ1bkRlcHMgOiBub3JtYWxEZXBzO1xuICByZXR1cm4gZGVwcztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvcHlGaWxlcyhvcHRzOiBDb3B5T3B0cykge1xuICBjb25zdCBkZXBzID0gZ2V0RGVwcyhvcHRzKTtcbiAgY29uc3QgZW50cmllcyA9XG4gICAgJ2luY2x1ZGUnIGluIG9wdHNcbiAgICAgID8gYXdhaXQgZW50cmllc0Zyb21HbG9icyhvcHRzKVxuICAgICAgOiAnZmlsZXMnIGluIG9wdHNcbiAgICAgID8gYXdhaXQgZW50cmllc0Zyb21CYXNpYyhvcHRzKVxuICAgICAgOiBbXTtcblxuICBpZiAob3B0cy5vcHRpb25zPy5kcnlSdW4pIHtcbiAgICBjb25zb2xlLmxvZyhcbiAgICAgICdlbnRyaWVzJyxcbiAgICAgIGVudHJpZXMubWFwKChlbnRyeSkgPT4gZW50cnkucGF0aClcbiAgICApO1xuICB9XG5cbiAgY29uc3QgZm9sbG93U3ltYm9saWNMaW5rcyA9IG9wdHMub3B0aW9ucz8uZm9sbG93U3ltYm9saWNMaW5rcyA/PyBmYWxzZTtcbiAgY29uc3QgY3JlYXRlZERpcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBjb25zdCBzb3VyY2VQYXRoID0gZW50cnkucGF0aDtcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSByZWxhdGl2ZShvcHRzLnNvdXJjZSB8fCAnLicsIHNvdXJjZVBhdGgpO1xuICAgIGNvbnN0IHRhcmdldFBhdGggPSBqb2luKG9wdHMuZGVzdGluYXRpb24sIHJlbGF0aXZlUGF0aCk7XG4gICAgY29uc3QgaW5mbyA9IGVudHJ5LnN0YXRzO1xuXG4gICAgY29uc3QgdGFyZ2V0RGlyZWN0b3J5ID0gZGlybmFtZSh0YXJnZXRQYXRoKTtcbiAgICBpZiAoIWluZm8uaXNEaXJlY3RvcnkoKSAmJiAhY3JlYXRlZERpcnMuaGFzKHRhcmdldERpcmVjdG9yeSkpIHtcbiAgICAgIGF3YWl0IGRlcHMubWtkaXIodGFyZ2V0RGlyZWN0b3J5LCB7XG4gICAgICAgIHJlY3Vyc2l2ZTogdHJ1ZSxcbiAgICAgIH0pO1xuICAgICAgY3JlYXRlZERpcnMuYWRkKHRhcmdldERpcmVjdG9yeSk7XG4gICAgfVxuXG4gICAgaWYgKGluZm8uaXNTeW1ib2xpY0xpbmsoKSAmJiAhZm9sbG93U3ltYm9saWNMaW5rcykge1xuICAgICAgY29uc3QgcmVhbFNvdXJjZVBhdGggPSBhd2FpdCByZWFscGF0aChzb3VyY2VQYXRoKTtcbiAgICAgIGF3YWl0IGRlcHNcbiAgICAgICAgLnN5bWxpbmsocmVhbFNvdXJjZVBhdGgsIHRhcmdldFBhdGgpXG4gICAgICAgIC5jYXRjaChhc3luYyAoZXJyOiBOb2RlSlMuRXJybm9FeGNlcHRpb24pID0+IHtcbiAgICAgICAgICBpZiAoZXJyLmNvZGUgPT09ICdFRVhJU1QnKSB7XG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ1JlYWxTb3VyY2VQYXRoID0gYXdhaXQgcmVhbHBhdGgodGFyZ2V0UGF0aCk7XG4gICAgICAgICAgICBpZiAoZXhpc3RpbmdSZWFsU291cmNlUGF0aCAhPT0gcmVhbFNvdXJjZVBhdGgpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KGVycik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKGluZm8uaXNGaWxlKCkpIHtcbiAgICAgIGF3YWl0IGRlcHMuY29weUZpbGUoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCk7XG4gICAgfSBlbHNlIGlmIChpbmZvLmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgIGF3YWl0IGRlcHMubWtkaXIodGFyZ2V0UGF0aCwge1xuICAgICAgICByZWN1cnNpdmU6IHRydWUsXG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gaWdub3JlXG4gICAgfVxuICB9XG59XG4iLCJpbXBvcnQgeyByYW5kb21CeXRlcyB9IGZyb20gJ2NyeXB0byc7XG5cbi8vIDYyIGFscGhhbnVtZXJpY3MgZnJvbSBBU0NJSTogbnVtYmVycywgY2FwaXRhbHMsIGxvd2VyY2FzZVxuY29uc3QgYWxwaGFiZXQgPVxuICAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODknO1xuXG5leHBvcnQgY29uc3QgcmFuZG9tVGV4dCA9IChsZW5ndGg6IG51bWJlcikgPT4ge1xuICAvLyA2MiAqIDQgLSAxID0gMjQ3IDwgMjU1IC0gOCBudW1iZXJzIGJldHdlZW4gMjQ3IGFuZCAyNTUgYXJlIGRpc2NhcmRlZFxuICBjb25zdCB1c2VmdWxNYXggPSBhbHBoYWJldC5sZW5ndGggKiA0IC0gMTtcbiAgbGV0IHJlc3VsdCA9ICcnO1xuICB3aGlsZSAocmVzdWx0Lmxlbmd0aCA8IGxlbmd0aCkge1xuICAgIGZvciAoY29uc3QgYnl0ZSBvZiByYW5kb21CeXRlcyhsZW5ndGgpKSB7XG4gICAgICBpZiAoYnl0ZSA8PSB1c2VmdWxNYXgpIHtcbiAgICAgICAgcmVzdWx0ICs9IGFscGhhYmV0LmNoYXJBdChieXRlICUgYWxwaGFiZXQubGVuZ3RoKTtcbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHQubGVuZ3RoID09PSBsZW5ndGgpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59O1xuIiwiaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuXG5pbXBvcnQgeyBzcGF3blRvUHJvbWlzZSB9IGZyb20gJy4uL2NoaWxkLXByb2Nlc3MnO1xuXG4vLyBOT1RFOiBwYXRoIHJlbGF0aXZlIHRvIHRoZSAuL2JpbiBhdCB0aGUgcm9vdCBvZiB0aGUgcGFja2FnZSB3aGVyZVxuLy8gdGhpcyBmaWxlIGlzIGdvaW5nIHRvIHJlc2lkZVxuY29uc3QgYmluUGF0aCA9IChiaW46IHN0cmluZykgPT5cbiAgbmV3IFVSTChgLi4vbm9kZV9tb2R1bGVzLy5iaW4vJHtiaW59YCwgaW1wb3J0Lm1ldGEudXJsKS5wYXRobmFtZTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1bkJpbihiaW46IHN0cmluZywgYXJncyA9IHByb2Nlc3MuYXJndi5zbGljZSgyKSkge1xuICBhd2FpdCBzcGF3blRvUHJvbWlzZShcbiAgICBzcGF3bihiaW5QYXRoKGJpbiksIGFyZ3MsIHtcbiAgICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgfSlcbiAgKTtcbn1cbiIsImltcG9ydCB7IHNwYXduIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBhcHBlbmRGaWxlLCBybSB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSAnb3MnO1xuXG5pbXBvcnQgeyBzcGF3bk91dHB1dCB9IGZyb20gJy4uL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgY29weUZpbGVzIH0gZnJvbSAnLi4vZmlsZS1zeXN0ZW0vY29weUZpbGVzJztcbmltcG9ydCB7IHJhbmRvbVRleHQgfSBmcm9tICcuLi91dGlscy9yYW5kb21UZXh0JztcbmltcG9ydCB7IHJ1bkJpbiB9IGZyb20gJy4vcnVuQmluJztcblxuY29uc3QgZ2V0RGVwcyA9IChkcnlSdW46IGJvb2xlYW4pID0+IHtcbiAgY29uc3QgZGVwcyA9IHtcbiAgICBjb3B5RmlsZXMsXG4gICAgYXBwZW5kRmlsZSxcbiAgICBybSxcbiAgfTtcbiAgY29uc3QgZHJ5UnVuRGVwcyA9IHtcbiAgICBjb3B5RmlsZXM6IGFzeW5jICguLi5bb3B0c106IFBhcmFtZXRlcnM8dHlwZW9mIGNvcHlGaWxlcz4pID0+IHtcbiAgICAgIGF3YWl0IGNvcHlGaWxlcyh7XG4gICAgICAgIC4uLm9wdHMsXG4gICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAuLi5vcHRzLm9wdGlvbnMsXG4gICAgICAgICAgZHJ5UnVuOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSxcbiAgICBhcHBlbmRGaWxlOiBhc3luYyAoLi4uW2ZpbGVQYXRoLCBkYXRhXTogUGFyYW1ldGVyczx0eXBlb2YgYXBwZW5kRmlsZT4pID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKCdhcHBlbmRGaWxlJywge1xuICAgICAgICBmaWxlUGF0aCxcbiAgICAgICAgZGF0YSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH0sXG4gICAgcm06IGFzeW5jICguLi5bcGF0aF06IFBhcmFtZXRlcnM8dHlwZW9mIHJtPikgPT4ge1xuICAgICAgY29uc29sZS5sb2coJ3JtJywge1xuICAgICAgICBwYXRoLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfSxcbiAgfTtcbiAgcmV0dXJuIGRyeVJ1biA/IGRyeVJ1bkRlcHMgOiBkZXBzO1xufTtcblxuY29uc3Qgc2F2ZVVudHJhY2tlZCA9IGFzeW5jICgpID0+IHtcbiAgY29uc3QgZHJ5UnVuID0gcHJvY2Vzcy5hcmd2LmluY2x1ZGVzKCctLWRyeS1ydW4nKTtcbiAgaWYgKGRyeVJ1bikge1xuICAgIGNvbnNvbGUubG9nKCdSdW5uaW5nIGluIERSWSBSVU4gbW9kZScpO1xuICB9XG5cbiAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgc3Bhd25PdXRwdXQoXG4gICAgc3Bhd24oJ2dpdCcsICdscy1maWxlcyAtLW90aGVycyAtLWV4Y2x1ZGUtc3RhbmRhcmQgLS1mdWxsLW5hbWUnLnNwbGl0KCcgJykpXG4gICk7XG4gIGNvbnN0IGZpbGVzID0gb3V0cHV0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG4gIGNvbnN0IGlkID0gcmFuZG9tVGV4dCg4KTtcbiAgY29uc3Qgcm9vdCA9IGpvaW4odG1wZGlyKCksICdsaW50LXN0YWdlZC1iYWNrdXAnKTtcbiAgY29uc3QgYmFja3VwUGF0aCA9IGpvaW4ocm9vdCwgaWQpO1xuXG4gIGNvbnN0IGRlcHMgPSBnZXREZXBzKGRyeVJ1bik7XG5cbiAgY29uc3QgcmVzdG9yZVVudHJhY2tlZCA9IGFzeW5jICgpID0+IHtcbiAgICBpZiAoZmlsZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBkZXBzLmNvcHlGaWxlcyh7XG4gICAgICAgIHNvdXJjZTogYmFja3VwUGF0aCxcbiAgICAgICAgZmlsZXMsXG4gICAgICAgIGRlc3RpbmF0aW9uOiBwcm9jZXNzLmN3ZCgpLFxuICAgICAgfSk7XG4gICAgICBhd2FpdCBkZXBzLmFwcGVuZEZpbGUoam9pbihyb290LCAnaGlzdG9yeS50eHQnKSwgJ2NvcGllZCAnICsgaWQgKyAnXFxuJywge1xuICAgICAgICBlbmNvZGluZzogJ3V0Zi04JyxcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgZGVwcy5ybShiYWNrdXBQYXRoLCB7XG4gICAgICAgIHJlY3Vyc2l2ZTogdHJ1ZSxcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgZGVwcy5hcHBlbmRGaWxlKGpvaW4ocm9vdCwgJ2hpc3RvcnkudHh0JyksICdjbGVhbmVkICcgKyBpZCArICdcXG4nLCB7XG4gICAgICAgIGVuY29kaW5nOiAndXRmLTgnLFxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgJ0ZhaWxlZCB0byByZXN0b3JlIGZyb20gYmFja3VwJyxcbiAgICAgICAgYmFja3VwUGF0aCxcbiAgICAgICAgYFRyeSBydW5uaW5nIFwicnN5bmMgLXIgJHtiYWNrdXBQYXRofSAuXCIgdG8gcmVzdG9yZSBtYW51YWxseT9gXG4gICAgICApO1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcblxuICB0cnkge1xuICAgIGlmIChmaWxlcy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBkZXBzLmNvcHlGaWxlcyh7XG4gICAgICAgIGZpbGVzLFxuICAgICAgICBkZXN0aW5hdGlvbjogYmFja3VwUGF0aCxcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgZGVwcy5hcHBlbmRGaWxlKGpvaW4ocm9vdCwgJ2hpc3RvcnkudHh0JyksICdhZGRlZCAnICsgaWQgKyAnXFxuJywge1xuICAgICAgICBlbmNvZGluZzogJ3V0Zi04JyxcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIGZpbGVzLm1hcCgoZmlsZSkgPT4gZGVwcy5ybShmaWxlLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KSlcbiAgICAgICk7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zb2xlLmxvZyhcbiAgICAgICdGYWlsZWQgdG8gY2xlYW51cCcsXG4gICAgICB7XG4gICAgICAgIGZpbGVzLFxuICAgICAgfSxcbiAgICAgIGBUcnkgcnVubmluZyBcInJzeW5jIC1yICR7YmFja3VwUGF0aH0gLlwiIHRvIHJlc3RvcmUgdGhlbT9gXG4gICAgKTtcbiAgICBhd2FpdCByZXN0b3JlVW50cmFja2VkKCk7XG4gICAgdGhyb3cgZXJyO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICByZXN0b3JlVW50cmFja2VkLFxuICB9O1xufTtcblxuY29uc3QgbGludFN0YWdlZCA9IGFzeW5jICgpID0+IHtcbiAgYXdhaXQgcnVuQmluKFxuICAgICdsaW50LXN0YWdlZCcsXG4gICAgcHJvY2Vzcy5hcmd2LnNsaWNlKDIpLmZpbHRlcigoYXJnKSA9PiBhcmcgIT09ICctLWRyeS1ydW4nKVxuICApO1xufTtcblxuY29uc3QgcnVuID0gYXN5bmMgKCkgPT4ge1xuICBjb25zdCB7IHJlc3RvcmVVbnRyYWNrZWQgfSA9IGF3YWl0IHNhdmVVbnRyYWNrZWQoKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBsaW50U3RhZ2VkKCk7XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcmVzdG9yZVVudHJhY2tlZCgpO1xuICB9XG59O1xuXG5hd2FpdCBydW4oKTtcbiJdLCJuYW1lcyI6WyJhc3NlcnQiLCJfX3NwcmVhZFByb3BzIiwiX19zcHJlYWRWYWx1ZXMiLCJnZXREZXBzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7OztBQUFPLFNBQUEsSUFBQSxDQUFpQixFQUFzQixFQUFBO0FBQzVDLEVBQUksSUFBQSxLQUFBLENBQUE7QUFDSixFQUFBLElBQUksVUFBYSxHQUFBLEtBQUEsQ0FBQTtBQUNqQixFQUFBLE9BQU8sTUFBUztBQUNkLElBQUEsSUFBSSxVQUFZLEVBQUE7QUFDZCxNQUFPLE9BQUEsS0FBQSxDQUFBO0FBQUEsS0FDVDtBQUNBLElBQUEsS0FBQSxHQUFRLEVBQUcsRUFBQSxDQUFBO0FBQ1gsSUFBYSxVQUFBLEdBQUEsSUFBQSxDQUFBO0FBQ2IsSUFBTyxPQUFBLEtBQUEsQ0FBQTtBQUFBLEdBQ1QsQ0FBQTtBQUNGOztBQ1BBLE1BQU0scUJBQUEsR0FBd0IsQ0FBQyxTQUFzQixLQUFBO0FBR25ELEVBQU0sTUFBQSxNQUFBLEdBQVMsb0RBQXFELENBQUEsSUFBQSxDQUNsRSxTQUNGLENBQUEsQ0FBQTtBQUNBLEVBQU8sTUFBQSxDQUFBLENBQUMsQ0FBQyxNQUFNLENBQUEsQ0FBQTtBQUNmLEVBQUEsTUFBTSxH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
