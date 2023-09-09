// This file is bundled up from './src/*' and needs to be committed
'use strict';

var node_child_process = require('node:child_process');
var node_url = require('node:url');
var node_util = require('node:util');
var node_crypto = require('node:crypto');
var promises = require('node:fs/promises');
var node_path = require('node:path');
var jsYaml = require('js-yaml');
var fg = require('fast-glob');
var assert = require('node:assert');

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const randomText = (length) => {
  const usefulMax = alphabet.length * 4 - 1;
  let result = "";
  while (result.length < length) {
    for (const byte of node_crypto.randomBytes(length)) {
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

function asyncToSync(moduleLocation, fn, args) {
  const key = randomText(8);
  const url = node_url.fileURLToPath((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (document.currentScript && document.currentScript.src || new URL('eslintConfigHelpers.gen.cjs', document.baseURI).href)));
  const modulePath = node_url.fileURLToPath(moduleLocation);
  const modulePathCrossPlatform = process.platform === "win32" ? `file://${modulePath}` : modulePath;
  const result = node_child_process.spawnSync(process.execPath, [url, key], {
    stdio: "pipe",
    encoding: "utf-8",
    cwd: process.cwd(),
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      [key]: JSON.stringify({
        module: modulePathCrossPlatform,
        fn,
        args
      })
    }
  });
  if (result.status !== 0) {
    throw new Error(`${fn} failed: ${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch (err) {
    throw new Error(
      `Cannot parse invalid JSON received from the child process's output:
${result.stdout.trim()}`
    );
  }
}
const passedKey = process.argv[2];
const serializedConfig = passedKey && process.env[passedKey];
if (passedKey && serializedConfig) {
  const noop = () => {
    return;
  };
  console.log = noop.bind(console);
  console.error = noop.bind(console);
  const config = JSON.parse(serializedConfig);
  import(config.module).then(async (result) => {
    const fn = result[config.fn];
    if (!fn) {
      throw new Error(
        `${config.fn} not found in ${config.module}, got: ${node_util.format(config)}`
      );
    }
    const data = await Promise.resolve(fn(...config.args));
    process.stdout.setEncoding("utf-8");
    process.stdout.write(JSON.stringify(data));
    process.exitCode = 0;
  }).catch((err) => {
    process.stderr.setEncoding("utf-8");
    process.stderr.write(String(err));
    process.exitCode = 1;
  });
}

const cwdPackageJsonPath = () => node_path.join(process.cwd(), "./package.json");
async function readPackageJsonAt(path, deps = { readFile: (path2) => promises.readFile(path2, "utf-8") }) {
  return await deps.readFile(path).then((result) => JSON.parse(result));
}
const readCwdPackageJson = onceAsync(
  () => readPackageJsonAt(cwdPackageJsonPath())
);
async function readPackageJson(path, deps = { readFile: (path2) => promises.readFile(path2, "utf-8") }) {
  return path === cwdPackageJsonPath() ? await readCwdPackageJson() : await readPackageJsonAt(path, deps);
}

const getRepositoryRootScanCandidates = (currentDirectory) => {
  const esc = escapeRegExp(node_path.sep);
  const result = new RegExp(
    `(.*(?=${esc}packages${esc}))|(.*(?=${esc}node_modules${esc}))|(.*)`
  ).exec(currentDirectory);
  assert(!!result);
  const [, packagesRoot, nodeModulesRoot] = result;
  return [packagesRoot, nodeModulesRoot].filter(isTruthy);
};
const hasRootMarkersFor = async (candidate) => {
  const markers = [
    ".git",
    "yarn.lock",
    "pnpm-lock.yaml",
    "package-lock.json",
    "pnpm-workspace.yaml"
  ];
  const markersStream = fg.stream(markers, {
    markDirectories: true,
    onlyFiles: false,
    cwd: candidate,
    absolute: true
  });
  for await (const entry of markersStream) {
    assert(typeof entry === "string");
    return node_path.dirname(entry);
  }
  return void 0;
};
const hasRootMarkers = async (candidates) => {
  const results = await Promise.all(
    candidates.map((candidate) => hasRootMarkersFor(candidate))
  );
  return results.filter(isTruthy)[0];
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
    const result2 = node_path.dirname(path);
    if (result2 === path) {
      return;
    }
    return result2;
  };
  const parent = uniqueDirname(lookupDirectory);
  const superParent = uniqueDirname(parent);
  const result = await prioritizedHasMarkers(
    // scan in most likely locations first with current lookup directory taking priority
    [
      [lookupDirectory],
      getRepositoryRootScanCandidates(lookupDirectory),
      // scan 2 directories upwards
      [parent],
      [superParent]
    ].map((dirs) => dirs.filter(isTruthy)).filter((job) => job.length > 0)
  ) || lookupDirectory;
  return node_path.normalize(result);
};
const repositoryRootPath = onceAsync(async () => {
  const rootPath = await repositoryRootPathViaDirectoryScan(process.cwd());
  return rootPath;
});

async function tryReadingPnpmWorkspaceYaml(monorepoRoot) {
  const text = await promises.readFile(
    node_path.join(monorepoRoot, "pnpm-workspace.yaml"),
    "utf-8"
  );
  const rootPath = jsYaml.load(text);
  return Array.isArray(rootPath.packages) && rootPath.packages.length > 0 ? rootPath.packages : void 0;
}
async function tryReadingPackageJsonWorkspaces(monorepoRoot) {
  const packageJson = await readPackageJson(node_path.join(monorepoRoot, "package.json"));
  const workspaces = packageJson["workspaces"];
  return Array.isArray(workspaces) && workspaces.length > 0 ? workspaces.flatMap((entry) => typeof entry === "string" ? [entry] : []) : void 0;
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

const eslintConfigHelpers = async () => {
  const { root, packagesGlobs } = await readMonorepoPackagesGlobs();
  const globs = new Set(
    packagesGlobs.map(
      (glob) => glob !== "*" ? `${glob}/tsconfig.json` : "tsconfig.json"
    )
  );
  return {
    monorepoRootPath: root,
    packagesGlobs,
    tsConfigGlobs: globs.size === 0 ? ["tsconfig.json"] : [...globs]
  };
};
const syncEslintConfigHelpers = once(() => {
  return asyncToSync(
    (typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (document.currentScript && document.currentScript.src || new URL('eslintConfigHelpers.gen.cjs', document.baseURI).href)),
    "eslintConfigHelpers",
    []
  );
});

exports.eslintConfigHelpers = eslintConfigHelpers;
exports.syncEslintConfigHelpers = syncEslintConfigHelpers;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXNsaW50Q29uZmlnSGVscGVycy5nZW4uY2pzIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi91dGlscy90cy9zcmMvZXNjYXBlUmVnRXhwLnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL2lzVHJ1dGh5LnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL29uY2UudHMiLCIuLi8uLi8uLi8uLi91dGlscy90cy9zcmMvb25jZUFzeW5jLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JhbmRvbVRleHQudHMiLCIuLi8uLi9zcmMvdXRpbHMvYXN5bmMtdG8tc3luYy9pbmRleC50cyIsIi4uLy4uL3NyYy9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlcG9zaXRvcnlSb290UGF0aC50cyIsIi4uLy4uL3NyYy91dGlscy9yZWFkUGFja2FnZXNHbG9icy50cyIsIi4uLy4uL3NyYy9lc2xpbnQvZXNsaW50Q29uZmlnSGVscGVycy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBodHRwczovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy8zNDQ2MTcwL2VzY2FwZS1zdHJpbmctZm9yLXVzZS1pbi1qYXZhc2NyaXB0LXJlZ2V4XG5leHBvcnQgZnVuY3Rpb24gZXNjYXBlUmVnRXhwKHN0cjogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIGlzVHJ1dGh5PFQ+KFxuICB2YWx1ZTogTm9uTnVsbGFibGU8VD4gfCBmYWxzZSB8IG51bGwgfCB1bmRlZmluZWQgfCAnJyB8IDBcbik6IHZhbHVlIGlzIE5vbk51bGxhYmxlPFQ+IHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUpO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIG9uY2U8VD4oZm46ICgpID0+IFQpOiAoKSA9PiBUIHtcbiAgbGV0IHZhbHVlOiBUO1xuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xuICByZXR1cm4gKCk6IFQgPT4ge1xuICAgIGlmIChjYWxjdWxhdGVkKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHZhbHVlID0gZm4oKTtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZUFzeW5jPFQ+KGZuOiAoKSA9PiBUIHwgUHJvbWlzZTxUPik6ICgpID0+IFByb21pc2U8VD4ge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBpbkZsaWdodDogUHJvbWlzZTxUPiB8IG51bGw7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiBhc3luYyAoKTogUHJvbWlzZTxUPiA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKGluRmxpZ2h0KSB7XG4gICAgICByZXR1cm4gaW5GbGlnaHQ7XG4gICAgfVxuICAgIGluRmxpZ2h0ID0gUHJvbWlzZS5yZXNvbHZlKGZuKCkpO1xuICAgIHZhbHVlID0gYXdhaXQgaW5GbGlnaHQ7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgaW5GbGlnaHQgPSBudWxsO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImltcG9ydCB7IHJhbmRvbUJ5dGVzIH0gZnJvbSAnY3J5cHRvJztcblxuLy8gNjIgYWxwaGFudW1lcmljcyBmcm9tIEFTQ0lJOiBudW1iZXJzLCBjYXBpdGFscywgbG93ZXJjYXNlXG5jb25zdCBhbHBoYWJldCA9XG4gICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSc7XG5cbmV4cG9ydCBjb25zdCByYW5kb21UZXh0ID0gKGxlbmd0aDogbnVtYmVyKSA9PiB7XG4gIC8vIDYyICogNCAtIDEgPSAyNDcgPCAyNTUgLSA4IG51bWJlcnMgYmV0d2VlbiAyNDcgYW5kIDI1NSBhcmUgZGlzY2FyZGVkXG4gIGNvbnN0IHVzZWZ1bE1heCA9IGFscGhhYmV0Lmxlbmd0aCAqIDQgLSAxO1xuICBsZXQgcmVzdWx0ID0gJyc7XG4gIHdoaWxlIChyZXN1bHQubGVuZ3RoIDwgbGVuZ3RoKSB7XG4gICAgZm9yIChjb25zdCBieXRlIG9mIHJhbmRvbUJ5dGVzKGxlbmd0aCkpIHtcbiAgICAgIGlmIChieXRlIDw9IHVzZWZ1bE1heCkge1xuICAgICAgICByZXN1bHQgKz0gYWxwaGFiZXQuY2hhckF0KGJ5dGUgJSBhbHBoYWJldC5sZW5ndGgpO1xuICAgICAgfVxuICAgICAgaWYgKHJlc3VsdC5sZW5ndGggPT09IGxlbmd0aCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn07XG4iLCJpbXBvcnQgeyBzcGF3blN5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICd1cmwnO1xuaW1wb3J0IHsgZm9ybWF0IH0gZnJvbSAndXRpbCc7XG5cbmltcG9ydCB7IHJhbmRvbVRleHQgfSBmcm9tICcuLi9yYW5kb21UZXh0JztcblxuLyoqXG4gKiBUb3AgbGV2ZWwgaGFja2VyeSB3aGljaCBhbGxvd3MgdXMgdG8gdXNlIGFzeW5jIGZ1bmN0aW9ucyB3aGVyZSBvbmx5IHN5bmNcbiAqIGNvZGUgd291bGQgaGF2ZSBiZWVuIGFsbG93ZWQgZHVlIHRvIGZyYW1ld29yayBsaW1pdGF0aW9ucyAoZS5nLiBlc2xpbnQgYW5kXG4gKiBzeW5jIEpTIGNvbmZpZ3MpLlxuICpcbiAqIFRoaXMgd29ya3MgdmlhIGBzcGF3blN5bmNgLCBsb2FkaW5nIGEgbW9kdWxlIGR5bmFtaWNhbGx5IGluIGEgc2VwYXJhdGUgcHJvY2VzcyxcbiAqIHNlcmlhbGl6aW5nIGlucHV0IHZpYSBlbnYgdmFyIGFuZCBvdXRwdXQgdmlhIHN0ZG91dC5cbiAqXG4gKiBOT1RFOiBUaGVyZSBtaWdodCBiZSBhIGxpbWl0IG9uIGVudiB2YXIgdmFsdWUgc2l6ZXMgLSB0cmVhZCBjYXJlZnVsbHlcbiAqXG4gKiBAcGFyYW0gbW9kdWxlTG9jYXRpb24gTW9kdWxlIHRvIGxvYWQgZHluYW1pY2FsbHkgaW4gdGhlIHNwYXduZWQgcHJvY2Vzc1xuICogQHBhcmFtIGZuIEEgbmFtZWQgZnVuY3Rpb24gdG8gZXhlY3V0ZSB0aGF0IHNob3VsZCBiZSBleHBvcnRlZCBpbiB0aGUgbW9kdWxlXG4gKiBAcGFyYW0gYXJncyBBcmd1bWVudHMgdG8gcGFzcyB0byB0aGUgZnVuY3Rpb24sIHNob3VsZCBiZSBKU09OIHNlcmlhbGl6YWJsZVxuICogQHJldHVybnMgUmVzdWx0IHJldHVybmVkIGJ5IHRoZSBmdW5jdGlvbiwgc2hvdWxkIGJlIEpTT04gc2VyaWFsaXphYmxlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3luY1RvU3luYzxUPihcbiAgbW9kdWxlTG9jYXRpb246IHN0cmluZyxcbiAgZm46IHN0cmluZyxcbiAgYXJnczogdW5rbm93bltdXG4pIHtcbiAgY29uc3Qga2V5ID0gcmFuZG9tVGV4dCg4KTtcbiAgY29uc3QgdXJsID0gZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpO1xuICBjb25zdCBtb2R1bGVQYXRoID0gZmlsZVVSTFRvUGF0aChtb2R1bGVMb2NhdGlvbik7XG5cbiAgY29uc3QgbW9kdWxlUGF0aENyb3NzUGxhdGZvcm0gPVxuICAgIHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicgPyBgZmlsZTovLyR7bW9kdWxlUGF0aH1gIDogbW9kdWxlUGF0aDtcblxuICBjb25zdCByZXN1bHQgPSBzcGF3blN5bmMocHJvY2Vzcy5leGVjUGF0aCwgW3VybCwga2V5XSwge1xuICAgIHN0ZGlvOiAncGlwZScsXG4gICAgZW5jb2Rpbmc6ICd1dGYtOCcsXG4gICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxuICAgIGVudjoge1xuICAgICAgRUxFQ1RST05fUlVOX0FTX05PREU6ICcxJyxcbiAgICAgIFtrZXldOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIG1vZHVsZTogbW9kdWxlUGF0aENyb3NzUGxhdGZvcm0sXG4gICAgICAgIGZuLFxuICAgICAgICBhcmdzLFxuICAgICAgfSksXG4gICAgfSxcbiAgfSk7XG5cbiAgaWYgKHJlc3VsdC5zdGF0dXMgIT09IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7Zm59IGZhaWxlZDogJHtyZXN1bHQuc3RkZXJyfWApO1xuICB9XG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShyZXN1bHQuc3Rkb3V0LnRyaW0oKSkgYXMgdW5rbm93biBhcyBUO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgQ2Fubm90IHBhcnNlIGludmFsaWQgSlNPTiByZWNlaXZlZCBmcm9tIHRoZSBjaGlsZCBwcm9jZXNzJ3Mgb3V0cHV0OlxuJHtyZXN1bHQuc3Rkb3V0LnRyaW0oKX1gXG4gICAgKTtcbiAgfVxufVxuXG5jb25zdCBwYXNzZWRLZXkgPSBwcm9jZXNzLmFyZ3ZbMl07XG5jb25zdCBzZXJpYWxpemVkQ29uZmlnID0gcGFzc2VkS2V5ICYmIHByb2Nlc3MuZW52W3Bhc3NlZEtleV07XG5cbmlmIChwYXNzZWRLZXkgJiYgc2VyaWFsaXplZENvbmZpZykge1xuICBjb25zdCBub29wID0gKCkgPT4ge1xuICAgIHJldHVybjtcbiAgfTtcblxuICBjb25zb2xlLmxvZyA9IG5vb3AuYmluZChjb25zb2xlKTtcbiAgY29uc29sZS5lcnJvciA9IG5vb3AuYmluZChjb25zb2xlKTtcblxuICBjb25zdCBjb25maWcgPSBKU09OLnBhcnNlKHNlcmlhbGl6ZWRDb25maWcpIGFzIHtcbiAgICBtb2R1bGU6IHN0cmluZztcbiAgICBmbjogc3RyaW5nO1xuICAgIGFyZ3M6IHVua25vd25bXTtcbiAgfTtcblxuICBpbXBvcnQoY29uZmlnLm1vZHVsZSlcbiAgICAudGhlbihhc3luYyAocmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCAoLi4uYXJnczogdW5rbm93bltdKSA9PiB1bmtub3duPikgPT4ge1xuICAgICAgY29uc3QgZm4gPSByZXN1bHRbY29uZmlnLmZuXTtcblxuICAgICAgaWYgKCFmbikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYCR7Y29uZmlnLmZufSBub3QgZm91bmQgaW4gJHtjb25maWcubW9kdWxlfSwgZ290OiAke2Zvcm1hdChjb25maWcpfWBcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IFByb21pc2UucmVzb2x2ZShmbiguLi5jb25maWcuYXJncykpO1xuICAgICAgcHJvY2Vzcy5zdGRvdXQuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgICBwcm9jZXNzLnN0ZG91dC53cml0ZShKU09OLnN0cmluZ2lmeShkYXRhKSk7XG4gICAgICBwcm9jZXNzLmV4aXRDb2RlID0gMDtcbiAgICB9KVxuICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICBwcm9jZXNzLnN0ZGVyci5zZXRFbmNvZGluZygndXRmLTgnKTtcbiAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKFN0cmluZyhlcnIpKTtcbiAgICAgIHByb2Nlc3MuZXhpdENvZGUgPSAxO1xuICAgIH0pO1xufVxuIiwiaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICdAdXRpbHMvdHMnO1xuXG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi4vdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5pbXBvcnQgdHlwZSB7IFBhY2thZ2VKc29uIH0gZnJvbSAnLi9wYWNrYWdlSnNvbic7XG5cbmNvbnN0IGN3ZFBhY2thZ2VKc29uUGF0aCA9ICgpID0+IGpvaW4ocHJvY2Vzcy5jd2QoKSwgJy4vcGFja2FnZS5qc29uJyk7XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbkF0KFxuICBwYXRoOiBzdHJpbmcsXG4gIGRlcHMgPSB7IHJlYWRGaWxlOiAocGF0aDogc3RyaW5nKSA9PiByZWFkRmlsZShwYXRoLCAndXRmLTgnKSB9XG4pOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIHJldHVybiBhd2FpdCBkZXBzXG4gICAgLnJlYWRGaWxlKHBhdGgpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gSlNPTi5wYXJzZShyZXN1bHQpIGFzIFBhY2thZ2VKc29uKTtcbn1cblxuZXhwb3J0IGNvbnN0IHJlYWRDd2RQYWNrYWdlSnNvbiA9IG9uY2VBc3luYygoKSA9PlxuICByZWFkUGFja2FnZUpzb25BdChjd2RQYWNrYWdlSnNvblBhdGgoKSlcbik7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb24oXG4gIHBhdGg6IHN0cmluZyxcbiAgZGVwcyA9IHsgcmVhZEZpbGU6IChwYXRoOiBzdHJpbmcpID0+IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpIH1cbik6IFByb21pc2U8UGFja2FnZUpzb24+IHtcbiAgLy8gYXNzdW1pbmcgY3VycmVudCBkaXJlY3RvcnkgZG9lc24ndCBjaGFuZ2Ugd2hpbGUgYXBwIGlzIHJ1bm5pbmdcbiAgcmV0dXJuIHBhdGggPT09IGN3ZFBhY2thZ2VKc29uUGF0aCgpXG4gICAgPyBhd2FpdCByZWFkQ3dkUGFja2FnZUpzb24oKVxuICAgIDogYXdhaXQgcmVhZFBhY2thZ2VKc29uQXQocGF0aCwgZGVwcyk7XG59XG5cbi8qKlxuICogUmVhZCBwYWNrYWdlIGpzb24gb2YgdGhlIGN1cnJlbnQgbGlicmFyeSAoQHJlcGthLWtpdC90cylcbiAqL1xuZXhwb3J0IGNvbnN0IG91clBhY2thZ2VKc29uID0gb25jZUFzeW5jKFxuICBhc3luYyAoXG4gICAgZGVwcyA9IHtcbiAgICAgIHJlYWRGaWxlOiAocGF0aDogc3RyaW5nKSA9PiByZWFkRmlsZShwYXRoLCAndXRmLTgnKSxcbiAgICB9XG4gICkgPT4ge1xuICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IGpvaW4obW9kdWxlUm9vdERpcmVjdG9yeSgpLCAncGFja2FnZS5qc29uJyk7XG4gICAgcmV0dXJuIGF3YWl0IHJlYWRQYWNrYWdlSnNvbkF0KHBhY2thZ2VKc29uUGF0aCwge1xuICAgICAgcmVhZEZpbGU6IGRlcHMucmVhZEZpbGUsXG4gICAgfSk7XG4gIH1cbik7XG4iLCJpbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0JztcbmltcG9ydCB7IGRpcm5hbWUsIG5vcm1hbGl6ZSwgc2VwIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgZXNjYXBlUmVnRXhwLCBpc1RydXRoeSwgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcbmltcG9ydCBmZyBmcm9tICdmYXN0LWdsb2InO1xuXG5jb25zdCBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzID0gKGN1cnJlbnREaXJlY3Rvcnk6IHN0cmluZykgPT4ge1xuICBjb25zdCBlc2MgPSBlc2NhcGVSZWdFeHAoc2VwKTtcbiAgLy8gaGF2aW5nICdwYWNrYWdlcy8qJyBpbiB0aGUgcm9vdCBvZiBhIG1vbm9yZXBvIGlzIHN1cGVyIGNvbW1vblxuICBjb25zdCByZXN1bHQgPSBuZXcgUmVnRXhwKFxuICAgIGAoLiooPz0ke2VzY31wYWNrYWdlcyR7ZXNjfSkpfCguKig/PSR7ZXNjfW5vZGVfbW9kdWxlcyR7ZXNjfSkpfCguKilgXG4gICkuZXhlYyhjdXJyZW50RGlyZWN0b3J5KTtcbiAgYXNzZXJ0KCEhcmVzdWx0KTtcbiAgY29uc3QgWywgcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdID0gcmVzdWx0O1xuICByZXR1cm4gW3BhY2thZ2VzUm9vdCwgbm9kZU1vZHVsZXNSb290XS5maWx0ZXIoaXNUcnV0aHkpO1xufTtcblxuLy8gcmV0dXJucyB0aGUgZmlyc3QgZGlyZWN0b3J5IHdoaWNoIGhhcyBtb25vcmVwbyBtYXJrZXJzLCBtdWx0aXBsZVxuLy8gZGlyZWN0b3JpZXMgY2FuIGhhdmUgdGhlbSAtIHdoaWNoZXZlciByZWFkIGZpcnN0IHdpbGwgYmUgcmV0dXJuZWRcbi8vIHNvIGlmIG9yZGVyIGlzIGltcG9ydGFudCAtIHNjYW5uaW5nIHNob3VsZCBiZSBzZXBhcmF0ZWQgdG8gbXVsdGlwbGUgam9ic1xuLy8gdmlhIHByaW9yaXRpemVkSGFzTW9ub3JlcG9NYXJrZXJzXG5jb25zdCBoYXNSb290TWFya2Vyc0ZvciA9IGFzeW5jIChjYW5kaWRhdGU6IHN0cmluZykgPT4ge1xuICBjb25zdCBtYXJrZXJzID0gW1xuICAgICcuZ2l0JyxcbiAgICAneWFybi5sb2NrJyxcbiAgICAncG5wbS1sb2NrLnlhbWwnLFxuICAgICdwYWNrYWdlLWxvY2suanNvbicsXG4gICAgJ3BucG0td29ya3NwYWNlLnlhbWwnLFxuICBdO1xuICBjb25zdCBtYXJrZXJzU3RyZWFtID0gZmcuc3RyZWFtKG1hcmtlcnMsIHtcbiAgICBtYXJrRGlyZWN0b3JpZXM6IHRydWUsXG4gICAgb25seUZpbGVzOiBmYWxzZSxcbiAgICBjd2Q6IGNhbmRpZGF0ZSxcbiAgICBhYnNvbHV0ZTogdHJ1ZSxcbiAgfSk7XG4gIGZvciBhd2FpdCAoY29uc3QgZW50cnkgb2YgbWFya2Vyc1N0cmVhbSkge1xuICAgIGFzc2VydCh0eXBlb2YgZW50cnkgPT09ICdzdHJpbmcnKTtcbiAgICByZXR1cm4gZGlybmFtZShlbnRyeSk7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbmNvbnN0IGhhc1Jvb3RNYXJrZXJzID0gYXN5bmMgKGNhbmRpZGF0ZXM6IHN0cmluZ1tdKSA9PiB7XG4gIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBjYW5kaWRhdGVzLm1hcCgoY2FuZGlkYXRlKSA9PiBoYXNSb290TWFya2Vyc0ZvcihjYW5kaWRhdGUpKVxuICApO1xuICByZXR1cm4gcmVzdWx0cy5maWx0ZXIoaXNUcnV0aHkpWzBdO1xufTtcblxuY29uc3QgcHJpb3JpdGl6ZWRIYXNNYXJrZXJzID0gKGpvYnM6IHN0cmluZ1tdW10pID0+IHtcbiAgaWYgKGpvYnMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4oKHJlcykgPT4ge1xuICAgIGNvbnN0IHJlc3VsdHMgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nIHwgdW5kZWZpbmVkPigpO1xuXG4gICAgY29uc3QgY2hlY2tTaG91bGRDb21wbGV0ZSA9IChpbmRleDogbnVtYmVyLCByZXN1bHQ6IHN0cmluZyB8IHVuZGVmaW5lZCkgPT4ge1xuICAgICAgcmVzdWx0cy5zZXQoaW5kZXgsIHJlc3VsdCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGpvYnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3QgaGFzUmVzdWx0ID0gcmVzdWx0cy5oYXMoaSk7XG4gICAgICAgIGlmICghaGFzUmVzdWx0KSB7XG4gICAgICAgICAgLy8gaWYgYSBqb2Igd2l0aCBoaWdoZXN0IHByaW9yaXR5IGhhc24ndCBmaW5pc2hlZCB5ZXRcbiAgICAgICAgICAvLyB0aGVuIHdhaXQgZm9yIGl0XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzdWx0cy5nZXQoaSk7XG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAvLyBqb2IgZmluaXNoZWQgYW5kIHdlIGZvdW5kIG1hcmtlcnMsIGFsc28gYWxsIGpvYnNcbiAgICAgICAgICAvLyB3aXRoIGhpZ2hlciBwcmlvcml0eSBmaW5pc2hlZCBhbmQgdGhleSBkb24ndCBoYXZlXG4gICAgICAgICAgLy8gYW55IG1hcmtlcnMgLSB3ZSBhcmUgZG9uZVxuICAgICAgICAgIHJlcyhyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0cy5zaXplID09PSBqb2JzLmxlbmd0aCkge1xuICAgICAgICAvLyBhbGwgam9icyBmaW5pc2hlZCAtIG5vIG1hcmtlcnMgZm91bmRcbiAgICAgICAgcmVzKHVuZGVmaW5lZCk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGpvYnMuZm9yRWFjaCgoZGlyZWN0b3JpZXMsIGluZGV4KSA9PiB7XG4gICAgICBoYXNSb290TWFya2VycyhkaXJlY3RvcmllcylcbiAgICAgICAgLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGNoZWNrU2hvdWxkQ29tcGxldGUoaW5kZXgsIHJlc3VsdCk7XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gaWdub3JlXG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59O1xuXG5leHBvcnQgY29uc3QgcmVwb3NpdG9yeVJvb3RQYXRoVmlhRGlyZWN0b3J5U2NhbiA9IGFzeW5jIChcbiAgbG9va3VwRGlyZWN0b3J5OiBzdHJpbmdcbikgPT4ge1xuICBjb25zdCB1bmlxdWVEaXJuYW1lID0gKHBhdGg/OiBzdHJpbmcpID0+IHtcbiAgICBpZiAoIXBhdGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gZGlybmFtZShwYXRoKTtcbiAgICBpZiAocmVzdWx0ID09PSBwYXRoKSB7XG4gICAgICAvLyBlLmcuIHRoZSBwYXRoIHdhcyBhbHJlYWR5IGEgcm9vdCBcIi9cIlxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIGNvbnN0IHBhcmVudCA9IHVuaXF1ZURpcm5hbWUobG9va3VwRGlyZWN0b3J5KTtcbiAgY29uc3Qgc3VwZXJQYXJlbnQgPSB1bmlxdWVEaXJuYW1lKHBhcmVudCk7XG5cbiAgY29uc3QgcmVzdWx0ID1cbiAgICAoYXdhaXQgcHJpb3JpdGl6ZWRIYXNNYXJrZXJzKFxuICAgICAgLy8gc2NhbiBpbiBtb3N0IGxpa2VseSBsb2NhdGlvbnMgZmlyc3Qgd2l0aCBjdXJyZW50IGxvb2t1cCBkaXJlY3RvcnkgdGFraW5nIHByaW9yaXR5XG4gICAgICBbXG4gICAgICAgIFtsb29rdXBEaXJlY3RvcnldLFxuICAgICAgICBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzKGxvb2t1cERpcmVjdG9yeSksXG4gICAgICAgIC8vIHNjYW4gMiBkaXJlY3RvcmllcyB1cHdhcmRzXG4gICAgICAgIFtwYXJlbnRdLFxuICAgICAgICBbc3VwZXJQYXJlbnRdLFxuICAgICAgXVxuICAgICAgICAubWFwKChkaXJzKSA9PiBkaXJzLmZpbHRlcihpc1RydXRoeSkpXG4gICAgICAgIC5maWx0ZXIoKGpvYikgPT4gam9iLmxlbmd0aCA+IDApXG4gICAgKSkgfHwgbG9va3VwRGlyZWN0b3J5OyAvKiBmYWxsYmFjayB0byBjdXJyZW50IGRpcmVjdG9yeSBpbiB3b3JzZSBzY2VuYXJpbyAqL1xuXG4gIHJldHVybiBub3JtYWxpemUocmVzdWx0KTtcbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIHJlcG9zaXRvcnkgcm9vdCBwYXRoIGJ5IHNjYW5uaW5nIGN1cnJlbnQgYW5kIHBhcmVudCBkaXJlY3Rvcmllc1xuICogYW5kIGxvb2tpbmcgZm9yIG1hcmtlciBmaWxlcy9kaXJzIGxpa2U6XG4gKlxuICogLSAuZ2l0XG4gKiAtIHBhY2thZ2UtbG9jay5qc29uXG4gKiAtIHlhcm4ubG9ja1xuICogLSBwbnBtLWxvY2sueWFtbFxuICogLSBwbnBtLXdvcmtzcGFjZS55YW1sXG4gKi9cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGggPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290UGF0aCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4ocHJvY2Vzcy5jd2QoKSk7XG4gIHJldHVybiByb290UGF0aDtcbn0pO1xuIiwiaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICdAdXRpbHMvdHMnO1xuaW1wb3J0IHsgbG9hZCB9IGZyb20gJ2pzLXlhbWwnO1xuXG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuL2ZpbmREZXZEZXBlbmRlbmN5JztcbmltcG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuYXN5bmMgZnVuY3Rpb24gdHJ5UmVhZGluZ1BucG1Xb3Jrc3BhY2VZYW1sKG1vbm9yZXBvUm9vdDogc3RyaW5nKSB7XG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShcbiAgICBqb2luKG1vbm9yZXBvUm9vdCwgJ3BucG0td29ya3NwYWNlLnlhbWwnKSxcbiAgICAndXRmLTgnXG4gICk7XG4gIGNvbnN0IHJvb3RQYXRoID0gbG9hZCh0ZXh0KSBhcyB7XG4gICAgcGFja2FnZXM/OiBzdHJpbmdbXTtcbiAgfTtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkocm9vdFBhdGgucGFja2FnZXMpICYmIHJvb3RQYXRoLnBhY2thZ2VzLmxlbmd0aCA+IDBcbiAgICA/IHJvb3RQYXRoLnBhY2thZ2VzXG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHRyeVJlYWRpbmdQYWNrYWdlSnNvbldvcmtzcGFjZXMobW9ub3JlcG9Sb290OiBzdHJpbmcpIHtcbiAgY29uc3QgcGFja2FnZUpzb24gPSBhd2FpdCByZWFkUGFja2FnZUpzb24oam9pbihtb25vcmVwb1Jvb3QsICdwYWNrYWdlLmpzb24nKSk7XG4gIGNvbnN0IHdvcmtzcGFjZXMgPSBwYWNrYWdlSnNvblsnd29ya3NwYWNlcyddO1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSh3b3Jrc3BhY2VzKSAmJiB3b3Jrc3BhY2VzLmxlbmd0aCA+IDBcbiAgICA/IHdvcmtzcGFjZXMuZmxhdE1hcCgoZW50cnkpID0+ICh0eXBlb2YgZW50cnkgPT09ICdzdHJpbmcnID8gW2VudHJ5XSA6IFtdKSlcbiAgICA6IHVuZGVmaW5lZDtcbn1cblxuY29uc3QgcmVhZFBhY2thZ2VzR2xvYnNBdCA9IGFzeW5jIChtb25vcmVwb1Jvb3Q6IHN0cmluZykgPT4ge1xuICBjb25zdCBbcG5wbVdvcmtzcGFjZXMsIHBhY2thZ2VKc29uV29ya3NwYWNlc10gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgdHJ5UmVhZGluZ1BucG1Xb3Jrc3BhY2VZYW1sKG1vbm9yZXBvUm9vdCkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKSxcbiAgICB0cnlSZWFkaW5nUGFja2FnZUpzb25Xb3Jrc3BhY2VzKG1vbm9yZXBvUm9vdCkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKSxcbiAgXSk7XG4gIHJldHVybiBwbnBtV29ya3NwYWNlcyB8fCBwYWNrYWdlSnNvbldvcmtzcGFjZXMgfHwgW107XG59O1xuXG4vKipcbiAqIERldGVybWluZSBtb25vcmVwbyBwYWNrYWdlcyBnbG9iIGJ5IHJlYWRpbmcgb25lIG9mIHRoZSBzdXBwb3J0ZWRcbiAqIGZpbGVzXG4gKlxuICogTk9URTogb25seSBwbnBtIGlzIHN1cHBvcnRlZCBhdCB0aGUgbW9tZW50XG4gKi9cbmV4cG9ydCBjb25zdCByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3Qgcm9vdCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICBjb25zdCBwYWNrYWdlc0dsb2JzID0gYXdhaXQgcmVhZFBhY2thZ2VzR2xvYnNBdChyb290KTtcbiAgcmV0dXJuIHtcbiAgICByb290LFxuICAgIHBhY2thZ2VzR2xvYnMsXG4gIH07XG59KTtcbiIsImltcG9ydCB7IG9uY2UgfSBmcm9tICdAdXRpbHMvdHMnO1xuXG5pbXBvcnQgeyBhc3luY1RvU3luYyB9IGZyb20gJy4uL3V0aWxzL2FzeW5jLXRvLXN5bmMnO1xuaW1wb3J0IHsgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyB9IGZyb20gJy4uL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzJztcblxuZXhwb3J0IGNvbnN0IGVzbGludENvbmZpZ0hlbHBlcnMgPSBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHsgcm9vdCwgcGFja2FnZXNHbG9icyB9ID0gYXdhaXQgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icygpO1xuICBjb25zdCBnbG9icyA9IG5ldyBTZXQoXG4gICAgcGFja2FnZXNHbG9icy5tYXAoKGdsb2IpID0+XG4gICAgICBnbG9iICE9PSAnKicgPyBgJHtnbG9ifS90c2NvbmZpZy5qc29uYCA6ICd0c2NvbmZpZy5qc29uJ1xuICAgIClcbiAgKTtcbiAgcmV0dXJuIHtcbiAgICBtb25vcmVwb1Jvb3RQYXRoOiByb290LFxuICAgIHBhY2thZ2VzR2xvYnMsXG4gICAgdHNDb25maWdHbG9iczogZ2xvYnMuc2l6ZSA9PT0gMCA/IFsndHNjb25maWcuanNvbiddIDogWy4uLmdsb2JzXSxcbiAgfTtcbn07XG5cbmV4cG9ydCBjb25zdCBzeW5jRXNsaW50Q29uZmlnSGVscGVycyA9IG9uY2UoKCkgPT4ge1xuICByZXR1cm4gYXN5bmNUb1N5bmM8QXdhaXRlZDxSZXR1cm5UeXBlPHR5cGVvZiBlc2xpbnRDb25maWdIZWxwZXJzPj4+KFxuICAgIGltcG9ydC5tZXRhLnVybCxcbiAgICAnZXNsaW50Q29uZmlnSGVscGVycycsXG4gICAgW11cbiAgKTtcbn0pO1xuIl0sIm5hbWVzIjpbInJhbmRvbUJ5dGVzIiwiZmlsZVVSTFRvUGF0aCIsInNwYXduU3luYyIsImZvcm1hdCIsImpvaW4iLCJwYXRoIiwicmVhZEZpbGUiLCJzZXAiLCJkaXJuYW1lIiwicmVzdWx0Iiwibm9ybWFsaXplIiwibG9hZCJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7OztBQUNPLFNBQVMsYUFBYSxHQUFxQixFQUFBO0FBQ2hELEVBQU8sT0FBQSxHQUFBLENBQUksT0FBUSxDQUFBLHFCQUFBLEVBQXVCLE1BQU0sQ0FBQSxDQUFBO0FBQ2xEOztBQ0hPLFNBQVMsU0FDZCxLQUN5QixF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
