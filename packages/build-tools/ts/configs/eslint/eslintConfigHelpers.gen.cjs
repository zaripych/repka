// This file is bundled up from './src/*' and needs to be committed
'use strict';

var node_child_process = require('node:child_process');
var node_url = require('node:url');
var node_util = require('node:util');
var node_crypto = require('node:crypto');
var promises = require('node:fs/promises');
var node_path = require('node:path');
var jsYaml = require('js-yaml');
var assert = require('node:assert');
var fg = require('fast-glob');

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
  const text = await promises.readFile(node_path.join(monorepoRoot, "package.json"), "utf-8");
  const packageJson = JSON.parse(text);
  return Array.isArray(packageJson.workspaces) && packageJson.workspaces.length > 0 ? packageJson.workspaces : void 0;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXNsaW50Q29uZmlnSGVscGVycy5nZW4uY2pzIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi91dGlscy90cy9zcmMvZXNjYXBlUmVnRXhwLnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL2lzVHJ1dGh5LnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL29uY2UudHMiLCIuLi8uLi8uLi8uLi91dGlscy90cy9zcmMvb25jZUFzeW5jLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JhbmRvbVRleHQudHMiLCIuLi8uLi9zcmMvdXRpbHMvYXN5bmMtdG8tc3luYy9pbmRleC50cyIsIi4uLy4uL3NyYy91dGlscy9yZXBvc2l0b3J5Um9vdFBhdGgudHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVhZFBhY2thZ2VzR2xvYnMudHMiLCIuLi8uLi9zcmMvZXNsaW50L2VzbGludENvbmZpZ0hlbHBlcnMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gaHR0cHM6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMzQ0NjE3MC9lc2NhcGUtc3RyaW5nLWZvci11c2UtaW4tamF2YXNjcmlwdC1yZWdleFxyXG5leHBvcnQgZnVuY3Rpb24gZXNjYXBlUmVnRXhwKHN0cjogc3RyaW5nKTogc3RyaW5nIHtcclxuICByZXR1cm4gc3RyLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XHJcbn1cclxuIiwiZXhwb3J0IGZ1bmN0aW9uIGlzVHJ1dGh5PFQ+KFxyXG4gIHZhbHVlOiBOb25OdWxsYWJsZTxUPiB8IGZhbHNlIHwgbnVsbCB8IHVuZGVmaW5lZCB8ICcnIHwgMFxyXG4pOiB2YWx1ZSBpcyBOb25OdWxsYWJsZTxUPiB7XHJcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUpO1xyXG59XHJcbiIsImV4cG9ydCBmdW5jdGlvbiBvbmNlPFQ+KGZuOiAoKSA9PiBUKTogKCkgPT4gVCB7XHJcbiAgbGV0IHZhbHVlOiBUO1xyXG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XHJcbiAgcmV0dXJuICgpOiBUID0+IHtcclxuICAgIGlmIChjYWxjdWxhdGVkKSB7XHJcbiAgICAgIHJldHVybiB2YWx1ZTtcclxuICAgIH1cclxuICAgIHZhbHVlID0gZm4oKTtcclxuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xyXG4gICAgcmV0dXJuIHZhbHVlO1xyXG4gIH07XHJcbn1cclxuIiwiZXhwb3J0IGZ1bmN0aW9uIG9uY2VBc3luYzxUPihmbjogKCkgPT4gVCB8IFByb21pc2U8VD4pOiAoKSA9PiBQcm9taXNlPFQ+IHtcclxuICBsZXQgdmFsdWU6IFQ7XHJcbiAgbGV0IGluRmxpZ2h0OiBQcm9taXNlPFQ+IHwgbnVsbDtcclxuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xyXG4gIHJldHVybiBhc3luYyAoKTogUHJvbWlzZTxUPiA9PiB7XHJcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xyXG4gICAgICByZXR1cm4gdmFsdWU7XHJcbiAgICB9XHJcbiAgICBpZiAoaW5GbGlnaHQpIHtcclxuICAgICAgcmV0dXJuIGluRmxpZ2h0O1xyXG4gICAgfVxyXG4gICAgaW5GbGlnaHQgPSBQcm9taXNlLnJlc29sdmUoZm4oKSk7XHJcbiAgICB2YWx1ZSA9IGF3YWl0IGluRmxpZ2h0O1xyXG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XHJcbiAgICBpbkZsaWdodCA9IG51bGw7XHJcbiAgICByZXR1cm4gdmFsdWU7XHJcbiAgfTtcclxufVxyXG4iLCJpbXBvcnQgeyByYW5kb21CeXRlcyB9IGZyb20gJ2NyeXB0byc7XHJcblxyXG4vLyA2MiBhbHBoYW51bWVyaWNzIGZyb20gQVNDSUk6IG51bWJlcnMsIGNhcGl0YWxzLCBsb3dlcmNhc2VcclxuY29uc3QgYWxwaGFiZXQgPVxyXG4gICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSc7XHJcblxyXG5leHBvcnQgY29uc3QgcmFuZG9tVGV4dCA9IChsZW5ndGg6IG51bWJlcikgPT4ge1xyXG4gIC8vIDYyICogNCAtIDEgPSAyNDcgPCAyNTUgLSA4IG51bWJlcnMgYmV0d2VlbiAyNDcgYW5kIDI1NSBhcmUgZGlzY2FyZGVkXHJcbiAgY29uc3QgdXNlZnVsTWF4ID0gYWxwaGFiZXQubGVuZ3RoICogNCAtIDE7XHJcbiAgbGV0IHJlc3VsdCA9ICcnO1xyXG4gIHdoaWxlIChyZXN1bHQubGVuZ3RoIDwgbGVuZ3RoKSB7XHJcbiAgICBmb3IgKGNvbnN0IGJ5dGUgb2YgcmFuZG9tQnl0ZXMobGVuZ3RoKSkge1xyXG4gICAgICBpZiAoYnl0ZSA8PSB1c2VmdWxNYXgpIHtcclxuICAgICAgICByZXN1bHQgKz0gYWxwaGFiZXQuY2hhckF0KGJ5dGUgJSBhbHBoYWJldC5sZW5ndGgpO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChyZXN1bHQubGVuZ3RoID09PSBsZW5ndGgpIHtcclxuICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG4iLCJpbXBvcnQgeyBzcGF3blN5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICd1cmwnO1xuaW1wb3J0IHsgZm9ybWF0IH0gZnJvbSAndXRpbCc7XG5cbmltcG9ydCB7IHJhbmRvbVRleHQgfSBmcm9tICcuLi9yYW5kb21UZXh0JztcblxuLyoqXG4gKiBUb3AgbGV2ZWwgaGFja2VyeSB3aGljaCBhbGxvd3MgdXMgdG8gdXNlIGFzeW5jIGZ1bmN0aW9ucyB3aGVyZSBvbmx5IHN5bmNcbiAqIGNvZGUgd291bGQgaGF2ZSBiZWVuIGFsbG93ZWQgZHVlIHRvIGZyYW1ld29yayBsaW1pdGF0aW9ucyAoZS5nLiBlc2xpbnQgYW5kXG4gKiBzeW5jIEpTIGNvbmZpZ3MpLlxuICpcbiAqIFRoaXMgd29ya3MgdmlhIGBzcGF3blN5bmNgLCBsb2FkaW5nIGEgbW9kdWxlIGR5bmFtaWNhbGx5IGluIGEgc2VwYXJhdGUgcHJvY2VzcyxcbiAqIHNlcmlhbGl6aW5nIGlucHV0IHZpYSBlbnYgdmFyIGFuZCBvdXRwdXQgdmlhIHN0ZG91dC5cbiAqXG4gKiBOT1RFOiBUaGVyZSBtaWdodCBiZSBhIGxpbWl0IG9uIGVudiB2YXIgdmFsdWUgc2l6ZXMgLSB0cmVhZCBjYXJlZnVsbHlcbiAqXG4gKiBAcGFyYW0gbW9kdWxlTG9jYXRpb24gTW9kdWxlIHRvIGxvYWQgZHluYW1pY2FsbHkgaW4gdGhlIHNwYXduZWQgcHJvY2Vzc1xuICogQHBhcmFtIGZuIEEgbmFtZWQgZnVuY3Rpb24gdG8gZXhlY3V0ZSB0aGF0IHNob3VsZCBiZSBleHBvcnRlZCBpbiB0aGUgbW9kdWxlXG4gKiBAcGFyYW0gYXJncyBBcmd1bWVudHMgdG8gcGFzcyB0byB0aGUgZnVuY3Rpb24sIHNob3VsZCBiZSBKU09OIHNlcmlhbGl6YWJsZVxuICogQHJldHVybnMgUmVzdWx0IHJldHVybmVkIGJ5IHRoZSBmdW5jdGlvbiwgc2hvdWxkIGJlIEpTT04gc2VyaWFsaXphYmxlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3luY1RvU3luYzxUPihcbiAgbW9kdWxlTG9jYXRpb246IHN0cmluZyxcbiAgZm46IHN0cmluZyxcbiAgYXJnczogdW5rbm93bltdXG4pIHtcbiAgY29uc3Qga2V5ID0gcmFuZG9tVGV4dCg4KTtcbiAgY29uc3QgdXJsID0gZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpO1xuICBjb25zdCBtb2R1bGVQYXRoID0gZmlsZVVSTFRvUGF0aChtb2R1bGVMb2NhdGlvbik7XG5cbiAgY29uc3QgbW9kdWxlUGF0aENyb3NzUGxhdGZvcm0gPVxuICAgIHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicgPyBgZmlsZTovLyR7bW9kdWxlUGF0aH1gIDogbW9kdWxlUGF0aDtcblxuICBjb25zdCByZXN1bHQgPSBzcGF3blN5bmMocHJvY2Vzcy5leGVjUGF0aCwgW3VybCwga2V5XSwge1xuICAgIHN0ZGlvOiAncGlwZScsXG4gICAgZW5jb2Rpbmc6ICd1dGYtOCcsXG4gICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxuICAgIGVudjoge1xuICAgICAgRUxFQ1RST05fUlVOX0FTX05PREU6ICcxJyxcbiAgICAgIFtrZXldOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIG1vZHVsZTogbW9kdWxlUGF0aENyb3NzUGxhdGZvcm0sXG4gICAgICAgIGZuLFxuICAgICAgICBhcmdzLFxuICAgICAgfSksXG4gICAgfSxcbiAgfSk7XG5cbiAgaWYgKHJlc3VsdC5zdGF0dXMgIT09IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7Zm59IGZhaWxlZDogJHtyZXN1bHQuc3RkZXJyfWApO1xuICB9XG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShyZXN1bHQuc3Rkb3V0LnRyaW0oKSkgYXMgdW5rbm93biBhcyBUO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgQ2Fubm90IHBhcnNlIGludmFsaWQgSlNPTiByZWNlaXZlZCBmcm9tIHRoZSBjaGlsZCBwcm9jZXNzJ3Mgb3V0cHV0OlxuJHtyZXN1bHQuc3Rkb3V0LnRyaW0oKX1gXG4gICAgKTtcbiAgfVxufVxuXG5jb25zdCBwYXNzZWRLZXkgPSBwcm9jZXNzLmFyZ3ZbMl07XG5jb25zdCBzZXJpYWxpemVkQ29uZmlnID0gcGFzc2VkS2V5ICYmIHByb2Nlc3MuZW52W3Bhc3NlZEtleV07XG5cbmlmIChwYXNzZWRLZXkgJiYgc2VyaWFsaXplZENvbmZpZykge1xuICBjb25zdCBub29wID0gKCkgPT4ge1xuICAgIHJldHVybjtcbiAgfTtcblxuICBjb25zb2xlLmxvZyA9IG5vb3AuYmluZChjb25zb2xlKTtcbiAgY29uc29sZS5lcnJvciA9IG5vb3AuYmluZChjb25zb2xlKTtcblxuICBjb25zdCBjb25maWcgPSBKU09OLnBhcnNlKHNlcmlhbGl6ZWRDb25maWcpIGFzIHtcbiAgICBtb2R1bGU6IHN0cmluZztcbiAgICBmbjogc3RyaW5nO1xuICAgIGFyZ3M6IHVua25vd25bXTtcbiAgfTtcblxuICBpbXBvcnQoY29uZmlnLm1vZHVsZSlcbiAgICAudGhlbihhc3luYyAocmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCAoLi4uYXJnczogdW5rbm93bltdKSA9PiB1bmtub3duPikgPT4ge1xuICAgICAgY29uc3QgZm4gPSByZXN1bHRbY29uZmlnLmZuXTtcblxuICAgICAgaWYgKCFmbikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYCR7Y29uZmlnLmZufSBub3QgZm91bmQgaW4gJHtjb25maWcubW9kdWxlfSwgZ290OiAke2Zvcm1hdChjb25maWcpfWBcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IFByb21pc2UucmVzb2x2ZShmbiguLi5jb25maWcuYXJncykpO1xuICAgICAgcHJvY2Vzcy5zdGRvdXQuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgICBwcm9jZXNzLnN0ZG91dC53cml0ZShKU09OLnN0cmluZ2lmeShkYXRhKSk7XG4gICAgICBwcm9jZXNzLmV4aXRDb2RlID0gMDtcbiAgICB9KVxuICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICBwcm9jZXNzLnN0ZGVyci5zZXRFbmNvZGluZygndXRmLTgnKTtcbiAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKFN0cmluZyhlcnIpKTtcbiAgICAgIHByb2Nlc3MuZXhpdENvZGUgPSAxO1xuICAgIH0pO1xufVxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydCc7XG5pbXBvcnQgeyBkaXJuYW1lLCBub3JtYWxpemUsIHNlcCB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IGVzY2FwZVJlZ0V4cCwgaXNUcnV0aHksIG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcblxuY29uc3QgZ2V0UmVwb3NpdG9yeVJvb3RTY2FuQ2FuZGlkYXRlcyA9IChjdXJyZW50RGlyZWN0b3J5OiBzdHJpbmcpID0+IHtcbiAgY29uc3QgZXNjID0gZXNjYXBlUmVnRXhwKHNlcCk7XG4gIC8vIGhhdmluZyAncGFja2FnZXMvKicgaW4gdGhlIHJvb3Qgb2YgYSBtb25vcmVwbyBpcyBzdXBlciBjb21tb25cbiAgY29uc3QgcmVzdWx0ID0gbmV3IFJlZ0V4cChcbiAgICBgKC4qKD89JHtlc2N9cGFja2FnZXMke2VzY30pKXwoLiooPz0ke2VzY31ub2RlX21vZHVsZXMke2VzY30pKXwoLiopYFxuICApLmV4ZWMoY3VycmVudERpcmVjdG9yeSk7XG4gIGFzc2VydCghIXJlc3VsdCk7XG4gIGNvbnN0IFssIHBhY2thZ2VzUm9vdCwgbm9kZU1vZHVsZXNSb290XSA9IHJlc3VsdDtcbiAgcmV0dXJuIFtwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdF0uZmlsdGVyKGlzVHJ1dGh5KTtcbn07XG5cbi8vIHJldHVybnMgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aGljaCBoYXMgbW9ub3JlcG8gbWFya2VycywgbXVsdGlwbGVcbi8vIGRpcmVjdG9yaWVzIGNhbiBoYXZlIHRoZW0gLSB3aGljaGV2ZXIgcmVhZCBmaXJzdCB3aWxsIGJlIHJldHVybmVkXG4vLyBzbyBpZiBvcmRlciBpcyBpbXBvcnRhbnQgLSBzY2FubmluZyBzaG91bGQgYmUgc2VwYXJhdGVkIHRvIG11bHRpcGxlIGpvYnNcbi8vIHZpYSBwcmlvcml0aXplZEhhc01vbm9yZXBvTWFya2Vyc1xuY29uc3QgaGFzUm9vdE1hcmtlcnNGb3IgPSBhc3luYyAoY2FuZGlkYXRlOiBzdHJpbmcpID0+IHtcbiAgY29uc3QgbWFya2VycyA9IFtcbiAgICAnLmdpdCcsXG4gICAgJ3lhcm4ubG9jaycsXG4gICAgJ3BucG0tbG9jay55YW1sJyxcbiAgICAncGFja2FnZS1sb2NrLmpzb24nLFxuICAgICdwbnBtLXdvcmtzcGFjZS55YW1sJyxcbiAgXTtcbiAgY29uc3QgbWFya2Vyc1N0cmVhbSA9IGZnLnN0cmVhbShtYXJrZXJzLCB7XG4gICAgbWFya0RpcmVjdG9yaWVzOiB0cnVlLFxuICAgIG9ubHlGaWxlczogZmFsc2UsXG4gICAgY3dkOiBjYW5kaWRhdGUsXG4gICAgYWJzb2x1dGU6IHRydWUsXG4gIH0pO1xuICBmb3IgYXdhaXQgKGNvbnN0IGVudHJ5IG9mIG1hcmtlcnNTdHJlYW0pIHtcbiAgICBhc3NlcnQodHlwZW9mIGVudHJ5ID09PSAnc3RyaW5nJyk7XG4gICAgcmV0dXJuIGRpcm5hbWUoZW50cnkpO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG5jb25zdCBoYXNSb290TWFya2VycyA9IGFzeW5jIChjYW5kaWRhdGVzOiBzdHJpbmdbXSkgPT4ge1xuICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgY2FuZGlkYXRlcy5tYXAoKGNhbmRpZGF0ZSkgPT4gaGFzUm9vdE1hcmtlcnNGb3IoY2FuZGlkYXRlKSlcbiAgKTtcbiAgcmV0dXJuIHJlc3VsdHMuZmlsdGVyKGlzVHJ1dGh5KVswXTtcbn07XG5cbmNvbnN0IHByaW9yaXRpemVkSGFzTWFya2VycyA9IChqb2JzOiBzdHJpbmdbXVtdKSA9PiB7XG4gIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+KChyZXMpID0+IHtcbiAgICBjb25zdCByZXN1bHRzID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZyB8IHVuZGVmaW5lZD4oKTtcblxuICAgIGNvbnN0IGNoZWNrU2hvdWxkQ29tcGxldGUgPSAoaW5kZXg6IG51bWJlciwgcmVzdWx0OiBzdHJpbmcgfCB1bmRlZmluZWQpID0+IHtcbiAgICAgIHJlc3VsdHMuc2V0KGluZGV4LCByZXN1bHQpO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBqb2JzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGNvbnN0IGhhc1Jlc3VsdCA9IHJlc3VsdHMuaGFzKGkpO1xuICAgICAgICBpZiAoIWhhc1Jlc3VsdCkge1xuICAgICAgICAgIC8vIGlmIGEgam9iIHdpdGggaGlnaGVzdCBwcmlvcml0eSBoYXNuJ3QgZmluaXNoZWQgeWV0XG4gICAgICAgICAgLy8gdGhlbiB3YWl0IGZvciBpdFxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc3VsdHMuZ2V0KGkpO1xuICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgLy8gam9iIGZpbmlzaGVkIGFuZCB3ZSBmb3VuZCBtYXJrZXJzLCBhbHNvIGFsbCBqb2JzXG4gICAgICAgICAgLy8gd2l0aCBoaWdoZXIgcHJpb3JpdHkgZmluaXNoZWQgYW5kIHRoZXkgZG9uJ3QgaGF2ZVxuICAgICAgICAgIC8vIGFueSBtYXJrZXJzIC0gd2UgYXJlIGRvbmVcbiAgICAgICAgICByZXMocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHJlc3VsdHMuc2l6ZSA9PT0gam9icy5sZW5ndGgpIHtcbiAgICAgICAgLy8gYWxsIGpvYnMgZmluaXNoZWQgLSBubyBtYXJrZXJzIGZvdW5kXG4gICAgICAgIHJlcyh1bmRlZmluZWQpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBqb2JzLmZvckVhY2goKGRpcmVjdG9yaWVzLCBpbmRleCkgPT4ge1xuICAgICAgaGFzUm9vdE1hcmtlcnMoZGlyZWN0b3JpZXMpXG4gICAgICAgIC50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgICBjaGVja1Nob3VsZENvbXBsZXRlKGluZGV4LCByZXN1bHQpO1xuICAgICAgICB9KVxuICAgICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgIC8vIGlnbm9yZVxuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufTtcblxuZXhwb3J0IGNvbnN0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4gPSBhc3luYyAoXG4gIGxvb2t1cERpcmVjdG9yeTogc3RyaW5nXG4pID0+IHtcbiAgY29uc3QgdW5pcXVlRGlybmFtZSA9IChwYXRoPzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKCFwYXRoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGRpcm5hbWUocGF0aCk7XG4gICAgaWYgKHJlc3VsdCA9PT0gcGF0aCkge1xuICAgICAgLy8gZS5nLiB0aGUgcGF0aCB3YXMgYWxyZWFkeSBhIHJvb3QgXCIvXCJcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICBjb25zdCBwYXJlbnQgPSB1bmlxdWVEaXJuYW1lKGxvb2t1cERpcmVjdG9yeSk7XG4gIGNvbnN0IHN1cGVyUGFyZW50ID0gdW5pcXVlRGlybmFtZShwYXJlbnQpO1xuXG4gIGNvbnN0IHJlc3VsdCA9XG4gICAgKGF3YWl0IHByaW9yaXRpemVkSGFzTWFya2VycyhcbiAgICAgIC8vIHNjYW4gaW4gbW9zdCBsaWtlbHkgbG9jYXRpb25zIGZpcnN0IHdpdGggY3VycmVudCBsb29rdXAgZGlyZWN0b3J5IHRha2luZyBwcmlvcml0eVxuICAgICAgW1xuICAgICAgICBbbG9va3VwRGlyZWN0b3J5XSxcbiAgICAgICAgZ2V0UmVwb3NpdG9yeVJvb3RTY2FuQ2FuZGlkYXRlcyhsb29rdXBEaXJlY3RvcnkpLFxuICAgICAgICAvLyBzY2FuIDIgZGlyZWN0b3JpZXMgdXB3YXJkc1xuICAgICAgICBbcGFyZW50XSxcbiAgICAgICAgW3N1cGVyUGFyZW50XSxcbiAgICAgIF1cbiAgICAgICAgLm1hcCgoZGlycykgPT4gZGlycy5maWx0ZXIoaXNUcnV0aHkpKVxuICAgICAgICAuZmlsdGVyKChqb2IpID0+IGpvYi5sZW5ndGggPiAwKVxuICAgICkpIHx8IGxvb2t1cERpcmVjdG9yeTsgLyogZmFsbGJhY2sgdG8gY3VycmVudCBkaXJlY3RvcnkgaW4gd29yc2Ugc2NlbmFyaW8gKi9cblxuICByZXR1cm4gbm9ybWFsaXplKHJlc3VsdCk7XG59O1xuXG4vKipcbiAqIERldGVybWluZSByZXBvc2l0b3J5IHJvb3QgcGF0aCBieSBzY2FubmluZyBjdXJyZW50IGFuZCBwYXJlbnQgZGlyZWN0b3JpZXNcbiAqIGFuZCBsb29raW5nIGZvciBtYXJrZXIgZmlsZXMvZGlycyBsaWtlOlxuICpcbiAqIC0gLmdpdFxuICogLSBwYWNrYWdlLWxvY2suanNvblxuICogLSB5YXJuLmxvY2tcbiAqIC0gcG5wbS1sb2NrLnlhbWxcbiAqIC0gcG5wbS13b3Jrc3BhY2UueWFtbFxuICovXG5leHBvcnQgY29uc3QgcmVwb3NpdG9yeVJvb3RQYXRoID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3Qgcm9vdFBhdGggPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuKHByb2Nlc3MuY3dkKCkpO1xuICByZXR1cm4gcm9vdFBhdGg7XG59KTtcbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XHJcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xyXG5cclxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcclxuaW1wb3J0IHsgbG9hZCB9IGZyb20gJ2pzLXlhbWwnO1xyXG5cclxuaW1wb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xyXG5cclxuYXN5bmMgZnVuY3Rpb24gdHJ5UmVhZGluZ1BucG1Xb3Jrc3BhY2VZYW1sKG1vbm9yZXBvUm9vdDogc3RyaW5nKSB7XHJcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHJlYWRGaWxlKFxyXG4gICAgam9pbihtb25vcmVwb1Jvb3QsICdwbnBtLXdvcmtzcGFjZS55YW1sJyksXHJcbiAgICAndXRmLTgnXHJcbiAgKTtcclxuICBjb25zdCByb290UGF0aCA9IGxvYWQodGV4dCkgYXMge1xyXG4gICAgcGFja2FnZXM/OiBzdHJpbmdbXTtcclxuICB9O1xyXG4gIHJldHVybiBBcnJheS5pc0FycmF5KHJvb3RQYXRoLnBhY2thZ2VzKSAmJiByb290UGF0aC5wYWNrYWdlcy5sZW5ndGggPiAwXHJcbiAgICA/IHJvb3RQYXRoLnBhY2thZ2VzXHJcbiAgICA6IHVuZGVmaW5lZDtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gdHJ5UmVhZGluZ1BhY2thZ2VKc29uV29ya3NwYWNlcyhtb25vcmVwb1Jvb3Q6IHN0cmluZykge1xyXG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShqb2luKG1vbm9yZXBvUm9vdCwgJ3BhY2thZ2UuanNvbicpLCAndXRmLTgnKTtcclxuICBjb25zdCBwYWNrYWdlSnNvbiA9IEpTT04ucGFyc2UodGV4dCkgYXMge1xyXG4gICAgd29ya3NwYWNlcz86IHN0cmluZ1tdO1xyXG4gIH07XHJcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkocGFja2FnZUpzb24ud29ya3NwYWNlcykgJiZcclxuICAgIHBhY2thZ2VKc29uLndvcmtzcGFjZXMubGVuZ3RoID4gMFxyXG4gICAgPyBwYWNrYWdlSnNvbi53b3Jrc3BhY2VzXHJcbiAgICA6IHVuZGVmaW5lZDtcclxufVxyXG5cclxuY29uc3QgcmVhZFBhY2thZ2VzR2xvYnNBdCA9IGFzeW5jIChtb25vcmVwb1Jvb3Q6IHN0cmluZykgPT4ge1xyXG4gIGNvbnN0IFtwbnBtV29ya3NwYWNlcywgcGFja2FnZUpzb25Xb3Jrc3BhY2VzXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcclxuICAgIHRyeVJlYWRpbmdQbnBtV29ya3NwYWNlWWFtbChtb25vcmVwb1Jvb3QpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCksXHJcbiAgICB0cnlSZWFkaW5nUGFja2FnZUpzb25Xb3Jrc3BhY2VzKG1vbm9yZXBvUm9vdCkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKSxcclxuICBdKTtcclxuICByZXR1cm4gcG5wbVdvcmtzcGFjZXMgfHwgcGFja2FnZUpzb25Xb3Jrc3BhY2VzIHx8IFtdO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIERldGVybWluZSBtb25vcmVwbyBwYWNrYWdlcyBnbG9iIGJ5IHJlYWRpbmcgb25lIG9mIHRoZSBzdXBwb3J0ZWRcclxuICogZmlsZXNcclxuICpcclxuICogTk9URTogb25seSBwbnBtIGlzIHN1cHBvcnRlZCBhdCB0aGUgbW9tZW50XHJcbiAqL1xyXG5leHBvcnQgY29uc3QgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XHJcbiAgY29uc3Qgcm9vdCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xyXG4gIGNvbnN0IHBhY2thZ2VzR2xvYnMgPSBhd2FpdCByZWFkUGFja2FnZXNHbG9ic0F0KHJvb3QpO1xyXG4gIHJldHVybiB7XHJcbiAgICByb290LFxyXG4gICAgcGFja2FnZXNHbG9icyxcclxuICB9O1xyXG59KTtcclxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XHJcblxyXG5pbXBvcnQgeyBhc3luY1RvU3luYyB9IGZyb20gJy4uL3V0aWxzL2FzeW5jLXRvLXN5bmMnO1xyXG5pbXBvcnQgeyByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzIH0gZnJvbSAnLi4vdXRpbHMvcmVhZFBhY2thZ2VzR2xvYnMnO1xyXG5cclxuZXhwb3J0IGNvbnN0IGVzbGludENvbmZpZ0hlbHBlcnMgPSBhc3luYyAoKSA9PiB7XHJcbiAgY29uc3QgeyByb290LCBwYWNrYWdlc0dsb2JzIH0gPSBhd2FpdCByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzKCk7XHJcbiAgY29uc3QgZ2xvYnMgPSBuZXcgU2V0KFxyXG4gICAgcGFja2FnZXNHbG9icy5tYXAoKGdsb2IpID0+XHJcbiAgICAgIGdsb2IgIT09ICcqJyA/IGAke2dsb2J9L3RzY29uZmlnLmpzb25gIDogJ3RzY29uZmlnLmpzb24nXHJcbiAgICApXHJcbiAgKTtcclxuICByZXR1cm4ge1xyXG4gICAgbW9ub3JlcG9Sb290UGF0aDogcm9vdCxcclxuICAgIHBhY2thZ2VzR2xvYnMsXHJcbiAgICB0c0NvbmZpZ0dsb2JzOiBnbG9icy5zaXplID09PSAwID8gWyd0c2NvbmZpZy5qc29uJ10gOiBbLi4uZ2xvYnNdLFxyXG4gIH07XHJcbn07XHJcblxyXG5leHBvcnQgY29uc3Qgc3luY0VzbGludENvbmZpZ0hlbHBlcnMgPSBvbmNlKCgpID0+IHtcclxuICByZXR1cm4gYXN5bmNUb1N5bmM8QXdhaXRlZDxSZXR1cm5UeXBlPHR5cGVvZiBlc2xpbnRDb25maWdIZWxwZXJzPj4+KFxyXG4gICAgaW1wb3J0Lm1ldGEudXJsLFxyXG4gICAgJ2VzbGludENvbmZpZ0hlbHBlcnMnLFxyXG4gICAgW11cclxuICApO1xyXG59KTtcclxuIl0sIm5hbWVzIjpbInJhbmRvbUJ5dGVzIiwiZmlsZVVSTFRvUGF0aCIsInNwYXduU3luYyIsImZvcm1hdCIsInNlcCIsImRpcm5hbWUiLCJyZXN1bHQiLCJub3JtYWxpemUiLCJyZWFkRmlsZSIsImpvaW4iLCJsb2FkIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7O0FBQ08sU0FBUyxhQUFhLEdBQXFCLEVBQUE7QUFDaEQsRUFBTyxPQUFBLEdBQUEsQ0FBSSxPQUFRLENBQUEscUJBQUEsRUFBdUIsTUFBTSxDQUFBLENBQUE7QUFDbEQ7O0FDSE8sU0FBUyxTQUNkLEtBQ3lCLEVBQUE7QUFDekIsRUFBQSxPQUFPLFFBQVEsS0FBSyxDQUFBLENBQUE7QUFDdEI7O0FDSk8sU0FBUyxLQUFRLEVBQXNCLEVBQUE7QUFDNUMsRUFBSSxJQUFBLEtBQUEsQ0FBQTtBQUNKLEVBQUEsSUFBSSxVQUFhLEdBQUEsS0FBQSxDQUFBO0FBQ2pCLEVBQUEsT0FBTyxNQUFTO0FBQ2QsSUFBQSxJQUFJLFVBQVksRUFBQTtBQUNkLE1BQU8sT0FBQSxLQUFBLENBQUE7QUFBQSxLQUNUO0FBQ0EsSUFBQSxLQUFBLEdBQVEsRUFBRyxFQUFBLENBQUE7QUFDWCxJQUFhLFVBQUEsR0FBQSxJQUFBLENBQUE7QUFDYixJQUFPLE9BQUEsS0FBQSxDQUFBO0FBQUEsR0FDVCxDQUFBO0FBQ0Y7O0FDWE8sU0FB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
