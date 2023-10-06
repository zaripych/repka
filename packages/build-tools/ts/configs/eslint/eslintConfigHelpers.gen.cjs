// This file is bundled up from './src/*' and needs to be committed
'use strict';

var prettier = require('prettier');
var node_child_process = require('node:child_process');
var node_url = require('node:url');
var node_util = require('node:util');
var node_crypto = require('node:crypto');
var promises = require('node:fs/promises');
var node_path = require('node:path');
var jsYaml = require('js-yaml');
var assert = require('node:assert');
var fg = require('fast-glob');

var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
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
  const url = node_url.fileURLToPath((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.src || new URL('eslintConfigHelpers.gen.cjs', document.baseURI).href)));
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

const getIndentForTemplateIndentRule = async (root) => {
  const prettierConfig = await prettier.resolveConfig(root);
  const useTabs = (prettierConfig == null ? void 0 : prettierConfig.useTabs) ?? false;
  const tabWidth = (prettierConfig == null ? void 0 : prettierConfig.tabWidth) ?? 2;
  const indent = useTabs ? "	".repeat(tabWidth) : " ".repeat(tabWidth);
  return indent;
};
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
    tsConfigGlobs: globs.size === 0 ? ["tsconfig.json"] : [...globs],
    indent: await getIndentForTemplateIndentRule(root)
  };
};
const syncEslintConfigHelpers = once(() => {
  return asyncToSync(
    (typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.src || new URL('eslintConfigHelpers.gen.cjs', document.baseURI).href)),
    "eslintConfigHelpers",
    []
  );
});

exports.eslintConfigHelpers = eslintConfigHelpers;
exports.getIndentForTemplateIndentRule = getIndentForTemplateIndentRule;
exports.syncEslintConfigHelpers = syncEslintConfigHelpers;
