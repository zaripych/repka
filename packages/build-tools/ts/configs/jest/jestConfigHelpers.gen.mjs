// This file is bundled up from './src/*' and needs to be committed
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import { stat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, sep, join, normalize, resolve } from 'node:path';
import { defaults, readInitialOptions } from 'jest-config';
import fg from 'fast-glob';
import { load } from 'js-yaml';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

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
  return levels.reduce(
    (acc, lvl) => {
      return {
        ...acc,
        [lvl]: enabled.includes(lvl) ? ["fatal", "error"].includes(lvl) ? deps.error : deps.log : noop
      };
    },
    {
      logLevel,
      log: enabled.includes("info") ? deps.log : noop,
      tip: enabled.includes("info") && deps.shouldEnableTip() ? deps.log : noop
    }
  );
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
    /**
     * Captured stack trace information
     */
    stackTrace,
    /**
     * Can be called in asynchronous callback to enrich exceptions with additional information
     * @param err Exception to enrich - it is going to have its `.stack` prop mutated
     * @returns Same exception
     */
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
  await new Promise(
    (res, rej) => child.on("close", (code, signal) => {
      if (typeof code === "number") {
        if (exitCodes !== "inherit" && exitCodes !== "any" && !exitCodes.includes(code)) {
          rej(
            prepareForRethrow(
              new Error(`Command "${cmd()}" has failed with code ${code}`)
            )
          );
        } else {
          res();
        }
      } else if (signal) {
        rej(
          prepareForRethrow(
            new Error(`Failed to execute command "${cmd()}" - ${signal}`)
          )
        );
      } else {
        throw prepareForRethrow(new Error("Expected signal or error code"));
      }
    }).on("error", rej)
  );
  if (exitCodes === "inherit") {
    if (typeof child.exitCode === "number" && (typeof process.exitCode !== "number" || process.exitCode === 0)) {
      process.exitCode = child.exitCode;
    }
  }
}

async function spawnResult(...parameters) {
  var _a, _b, _c;
  const { child, opts } = spawnWithSpawnParameters(parameters);
  const combinedData = ((_a = opts.buffers) == null ? void 0 : _a.combined) ?? [];
  const stdoutData = ((_b = opts.buffers) == null ? void 0 : _b.stdout) ?? [];
  const stderrData = ((_c = opts.buffers) == null ? void 0 : _c.stderr) ?? [];
  const output = opts.output ?? ["stdout", "stderr"];
  if (output.includes("stdout")) {
    assert(
      !!child.stdout,
      'Expected ".stdout" to be defined, which will only be defined if child process is spawned with correct parameters'
    );
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (data) => {
      combinedData.push(data);
      stdoutData.push(data);
    });
  }
  if (output.includes("stderr")) {
    assert(
      !!child.stderr,
      'Expected ".stderr" to be defined, which will only be defined if child process is spawned with correct parameters'
    );
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
  if (result.error) {
    return Promise.reject(result.error);
  }
  return Promise.resolve(result);
}

const getModuleRootDirectoryForImportMetaUrl = (opts) => {
  const __fileName = fileURLToPath(new URL(opts.importMetaUrl));
  const parent = dirname(__fileName);
  const superParent = dirname(parent);
  const isBundledInDist = () => parent.endsWith(sep + "dist");
  const isBundledInBin = () => parent.endsWith(sep + "bin") && !superParent.endsWith(sep + "src");
  if (isBundledInDist() || isBundledInBin()) {
    return {
      type: "bundled",
      path: fileURLToPath(new URL(`../`, opts.importMetaUrl))
    };
  }
  return {
    type: "source",
    path: fileURLToPath(new URL(`../../`, opts.importMetaUrl))
  };
};
const moduleRootDirectory = once(
  () => getModuleRootDirectoryForImportMetaUrl({ importMetaUrl: import.meta.url }).path
);

async function isFile(filePath) {
  return await stat(filePath).then((result) => result.isFile()).catch(() => false);
}
async function* iterateNodeModules(startWith, path) {
  let current = startWith;
  while (current !== sep && current !== "~/") {
    const candidate = join(current, "node_modules", path);
    if (await isFile(candidate)) {
      yield candidate;
    }
    if (current === dirname(current)) {
      break;
    }
    current = dirname(current);
  }
}
async function findBinScript(startWith, binScriptPath) {
  for await (const path of iterateNodeModules(startWith, binScriptPath)) {
    return path;
  }
  return void 0;
}
async function binPath(opts) {
  const root = moduleRootDirectory();
  const result = await findBinScript(root, opts.binScriptPath);
  if (result) {
    return result;
  }
  throw new Error(`Cannot find bin ${opts.binName}`);
}

async function runTsScript(opts) {
  const started = performance.now();
  try {
    const location = opts.importMetaUrl ? fileURLToPath(new URL(opts.location, opts.importMetaUrl)) : opts.location;
    if (logger.logLevel !== "debug") {
      logger.log(`Running "${location}"`);
    }
    return await spawnOutputConditional(
      process.execPath,
      [
        await binPath({
          binName: "tsx",
          binScriptPath: "tsx/dist/cli.js"
        }),
        location,
        ...opts.args || []
      ],
      {
        exitCodes: [0],
        ...logger.logLevel === "debug" && {
          stdio: "inherit",
          output: []
        },
        env: {
          ...process.env,
          LOG_LEVEL: logger.logLevel
        }
      }
    );
  } finally {
    if (logger.logLevel !== "debug") {
      logger.log(
        `Finished in ${((performance.now() - started) / 1e3).toFixed(2)}s`
      );
    }
  }
}

const cwdPackageJsonPath = () => join(process.cwd(), "./package.json");
async function readPackageJsonAt(path, deps = { readFile: (path2) => readFile(path2, "utf-8") }) {
  return await deps.readFile(path).then((result) => JSON.parse(result));
}
const readCwdPackageJson = onceAsync(
  () => readPackageJsonAt(cwdPackageJsonPath())
);
async function readPackageJson(path, deps = { readFile: (path2) => readFile(path2, "utf-8") }) {
  return process.cwd() === cwdPackageJsonPath() ? await readCwdPackageJson() : await readPackageJsonAt(path, deps);
}

const getRepositoryRootScanCandidates = (currentDirectory) => {
  const esc = escapeRegExp(sep);
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
    return dirname(entry);
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
    const result2 = dirname(path);
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
  return normalize(result);
};
const repositoryRootPath = onceAsync(async () => {
  const rootPath = await repositoryRootPathViaDirectoryScan(process.cwd());
  return rootPath;
});

async function hasTurboJson() {
  const cwd = await repositoryRootPath();
  return await stat(join(cwd, "turbo.json")).then((res) => res.isFile()).catch(() => false);
}

async function tryReadingPnpmWorkspaceYaml(monorepoRoot) {
  const text = await readFile(
    join(monorepoRoot, "pnpm-workspace.yaml"),
    "utf-8"
  );
  const rootPath = load(text);
  return Array.isArray(rootPath.packages) && rootPath.packages.length > 0 ? rootPath.packages : void 0;
}
async function tryReadingPackageJsonWorkspaces(monorepoRoot) {
  const text = await readFile(join(monorepoRoot, "package.json"), "utf-8");
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
  const packageLocations = await fg(
    packagesGlobs.map((glob) => `${glob}/package.json`),
    {
      cwd: root
    }
  );
  return {
    root,
    packagesGlobs,
    packageLocations: packageLocations.map((location) => dirname(location)),
    hasTurbo,
    type: "multiple-packages"
  };
}

const extensions = [
  "js",
  "cjs",
  "mjs",
  "jsx",
  "ts",
  "cts",
  "mts",
  "tsx"
];
const ignoreDirs = ["/node_modules/", "/dist/", "/.tsc-out/"];
const jestTransformConfigProp = (jestPluginRoot) => {
  const esbuild = jestPluginRoot ? join(jestPluginRoot, "esbuild-jest") : "esbuild-jest";
  const esbuildDefaultOpts = {
    target: `node${process.versions.node}`,
    sourcemap: true
  };
  const loaderByExt = {
    ts: { loader: "ts", format: "esm" },
    cts: { loader: "ts", format: "cjs" },
    mts: { loader: "ts", format: "esm" },
    ctsx: { loader: "tsx", format: "cjs" },
    mtsx: { loader: "tsx", format: "esm" },
    tsx: { loader: "tsx", format: "esm" }
  };
  return {
    transform: Object.fromEntries(
      Object.entries(loaderByExt).map(([ext, opts]) => [
        `^.+\\.${ext}$`,
        [
          esbuild,
          {
            ...esbuildDefaultOpts,
            format: opts.format,
            loaders: {
              [`.${ext}`]: opts.loader,
              [`.test.${ext}`]: opts.loader
            }
          }
        ]
      ])
    )
  };
};
const commonDefaults = {
  cacheDirectory: "node_modules/.jest-cache",
  testPathIgnorePatterns: [
    ...ignoreDirs.map((dir) => `<rootDir>${dir}`),
    "<rootDir>/.*/test-cases/"
  ],
  transformIgnorePatterns: [...ignoreDirs.map((dir) => `<rootDir>${dir}`)],
  coveragePathIgnorePatterns: [...ignoreDirs.map((dir) => `<rootDir>${dir}`)],
  modulePathIgnorePatterns: [...ignoreDirs.map((dir) => `<rootDir>${dir}`)],
  moduleFileExtensions: [
    .../* @__PURE__ */ new Set([...defaults.moduleFileExtensions, ...extensions])
  ],
  extensionsToTreatAsEsm: [".jsx", ".ts", ".mts", ".tsx"],
  rootDir: process.cwd()
};
const flavorRegex = /\w+/;
function customFlavorTestDefaults(flavor) {
  if (flavor === "unit") {
    throw new Error("Flavor cannot be unit");
  }
  if (!flavorRegex.test(flavor)) {
    throw new Error(`Flavor should match /${flavorRegex.source}/`);
  }
  const roots = ["<rootDir>", "<rootDir>/src"];
  const flavorTestGlobs = [`__${flavor}__/**`];
  const exts = extensions.join(",");
  const flavorTestMatch = flavorTestGlobs.flatMap(
    (glob) => roots.map((root) => [root, glob].filter(Boolean).join("/"))
  ).map((glob) => [glob, `*.test.{${exts}}`].join("/"));
  return {
    testMatch: flavorTestMatch,
    testTimeout: 45e3,
    slowTestThreshold: 3e4,
    coverageDirectory: `node_modules/.coverage-${flavor}`,
    ...commonDefaults
  };
}
function unitTestDefaults() {
  const roots = ["<rootDir>"];
  const unitTestGlobs = ["**/__tests__/**", "**"];
  const exts = extensions.join(",");
  const unitTestMatch = unitTestGlobs.flatMap(
    (glob) => roots.map((root) => [root, glob].filter(Boolean).join("/"))
  ).map((glob) => [glob, `*.test.{${exts}}`].join("/"));
  return {
    testMatch: unitTestMatch,
    coverageDirectory: "node_modules/.coverage-unit",
    ...commonDefaults,
    testPathIgnorePatterns: [
      ...commonDefaults.testPathIgnorePatterns || [],
      `<rootDir>/(?!__tests__)(__[a-zA-Z0-9]+__)/`,
      `<rootDir>/src/(?!__tests__)(__[a-zA-Z0-9]+__)/`
    ]
  };
}

async function generateScript(opts) {
  const { flavor, script, rootDir } = opts;
  const stream = fg.stream(
    [`__${flavor}__/${script}.ts`, `src/__${flavor}__/${script}.ts`],
    {
      cwd: rootDir
    }
  );
  for await (const scriptLoc of stream) {
    if (scriptLoc) {
      const root = moduleRootDirectory();
      const location = resolve(join(rootDir, scriptLoc));
      const modulePath = (input) => process.platform === "win32" ? `file://${input.replaceAll(sep, "/")}` : input;
      const script2 = `import { runTsScript } from ${JSON.stringify(
        modulePath(join(root, "configs/jest/jestConfigHelpers.gen.mjs"))
      )};

export default async () => {
await runTsScript({
  location: ${JSON.stringify(location)}
})
}`;
      const hash = createHash("sha1").update(rootDir).update(flavor).update(script2).digest().toString("hex");
      const dir = join(tmpdir(), "jest-scripts");
      const file = join(dir, `${hash}.mjs`);
      await mkdir(dir, { recursive: true });
      await writeFile(file, script2);
      return file;
    }
  }
  return void 0;
}

async function isDirectory(path) {
  return stat(path).then((result) => result.isDirectory()).catch(() => void 0);
}

async function* upwardDirectoryWalk(opts) {
  var _a;
  let current = opts.start;
  while (current !== "/" && current !== "~/" && !(((_a = opts.stops) == null ? void 0 : _a.includes(current)) ?? false)) {
    const path = opts.appendPath ? join(current, opts.appendPath) : current;
    const candidate = await opts.test(path);
    if (candidate) {
      yield typeof candidate === "string" ? candidate : path;
    }
    current = dirname(current);
  }
}
async function upwardDirectorySearch(opts) {
  const walk = upwardDirectoryWalk(opts);
  for await (const dir of walk) {
    return dir;
  }
  return void 0;
}

async function lookup(opts) {
  return await upwardDirectorySearch({
    start: moduleRootDirectory(),
    appendPath: join("node_modules", opts.lookupPackageName),
    test: isDirectory
  });
}
async function findDevDependency(opts) {
  const lookupPackageName = opts.lookupPackageName;
  return await lookup({
    path: moduleRootDirectory(),
    lookupPackageName
  });
}

const jestPluginRoot = onceAsync(async () => {
  const result = await findDevDependency({
    lookupPackageName: "esbuild-jest"
  });
  if (!result) {
    logger.warn(
      'Jest plugins root cannot be determined. Do you have "@repka-kit/ts" in devDependencies at the monorepo root or at the local package?'
    );
  } else {
    if (logger.logLevel === "debug") {
      logger.debug("Found jest plugins root at", dirname(result));
    }
  }
  return result ? dirname(result) : ".";
});

async function createConfig(flavor, rootDir, parentRootDir) {
  const pluginRoot = jestPluginRoot();
  const baseConfig = flavor === "unit" ? unitTestDefaults() : customFlavorTestDefaults(flavor);
  const globalSetup = generateScript({
    script: "setup",
    flavor,
    rootDir
  });
  const globalTeardown = generateScript({
    script: "teardown",
    flavor,
    rootDir
  });
  process.env["TEST_FLAVOR"] = flavor;
  const jestConfig = readInitialOptions(void 0, {
    packageRootOrConfig: rootDir,
    parentConfigDirname: parentRootDir,
    readFromCwd: false,
    skipMultipleConfigError: true
  });
  const resolvedConfig = (await jestConfig).config;
  const config = {
    ...baseConfig,
    ...jestTransformConfigProp(await pluginRoot),
    ...resolvedConfig,
    globalSetup: await globalSetup,
    globalTeardown: await globalTeardown
  };
  return config;
}
async function createJestConfigForSinglePackage({
  flavor = "unit",
  rootDir = process.cwd()
}) {
  return await createConfig(flavor, rootDir);
}
async function createJestConfigForMonorepo({
  flavor = "unit",
  cwd = process.cwd()
}) {
  const repoConfig = await loadRepositoryConfiguration();
  if (repoConfig.type === "single-package") {
    return createJestConfigForSinglePackage({
      flavor,
      rootDir: repoConfig.root
    });
  }
  if (repoConfig.root !== cwd) {
    return createJestConfigForSinglePackage({ flavor, rootDir: cwd });
  }
  const projects = (await Promise.all(
    repoConfig.packageLocations.map(async (location) => {
      const baseConfig = createConfig(flavor, location, cwd);
      const packageJson = readPackageJson(join(location, "package.json"));
      return {
        ...await baseConfig,
        rootDir: location,
        displayName: (await packageJson).name
      };
    })
  )).filter(Boolean);
  const testTimeout = projects.reduce(
    (acc, project) => Math.max(
      acc,
      typeof project.testTimeout === "number" ? project.testTimeout : 0
    ),
    0
  );
  return {
    ...testTimeout !== 0 && {
      testTimeout
    },
    projects: projects.map(
      ({ coverageDirectory, testTimeout: testTimeout2, ...project }) => project
    )
  };
}

export { createJestConfigForMonorepo, createJestConfigForSinglePackage, runTsScript };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL2VzY2FwZVJlZ0V4cC50cyIsIi4uLy4uLy4uLy4uL3V0aWxzL3RzL3NyYy9pc1RydXRoeS50cyIsIi4uLy4uLy4uLy4uL3V0aWxzL3RzL3NyYy9vbmNlLnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL29uY2VBc3luYy50cyIsIi4uLy4uL3NyYy9sb2dnZXIvbG9nZ2VyLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3N0YWNrVHJhY2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blRvUHJvbWlzZS50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduUmVzdWx0LnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25PdXRwdXQudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeS50cyIsIi4uLy4uL3NyYy91dGlscy9iaW5QYXRoLnRzIiwiLi4vLi4vc3JjL3J1blRzU2NyaXB0LnRzIiwiLi4vLi4vc3JjL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24udHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoLnRzIiwiLi4vLi4vc3JjL3R1cmJvLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy9qZXN0L2NvbmZpZ0J1aWxkaW5nQmxvY2tzLnRzIiwiLi4vLi4vc3JjL2plc3QvZ2VuZXJhdGVTY3JpcHQudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNEaXJlY3RvcnkudHMiLCIuLi8uLi9zcmMvdXRpbHMvdXB3YXJkRGlyZWN0b3J5U2VhcmNoLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2ZpbmREZXZEZXBlbmRlbmN5LnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdFBsdWdpblJvb3QudHMiLCIuLi8uLi9zcmMvamVzdC9jcmVhdGVKZXN0Q29uZmlnLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIGh0dHBzOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzM0NDYxNzAvZXNjYXBlLXN0cmluZy1mb3ItdXNlLWluLWphdmFzY3JpcHQtcmVnZXhcbmV4cG9ydCBmdW5jdGlvbiBlc2NhcGVSZWdFeHAoc3RyOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc3RyLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gaXNUcnV0aHk8VD4oXG4gIHZhbHVlOiBOb25OdWxsYWJsZTxUPiB8IGZhbHNlIHwgbnVsbCB8IHVuZGVmaW5lZCB8ICcnIHwgMFxuKTogdmFsdWUgaXMgTm9uTnVsbGFibGU8VD4ge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSk7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZTxUPihmbjogKCkgPT4gVCk6ICgpID0+IFQge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiAoKTogVCA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdmFsdWUgPSBmbigpO1xuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBvbmNlQXN5bmM8VD4oZm46ICgpID0+IFQgfCBQcm9taXNlPFQ+KTogKCkgPT4gUHJvbWlzZTxUPiB7XG4gIGxldCB2YWx1ZTogVDtcbiAgbGV0IGluRmxpZ2h0OiBQcm9taXNlPFQ+IHwgbnVsbDtcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcbiAgcmV0dXJuIGFzeW5jICgpOiBQcm9taXNlPFQ+ID0+IHtcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICBpZiAoaW5GbGlnaHQpIHtcbiAgICAgIHJldHVybiBpbkZsaWdodDtcbiAgICB9XG4gICAgaW5GbGlnaHQgPSBQcm9taXNlLnJlc29sdmUoZm4oKSk7XG4gICAgdmFsdWUgPSBhd2FpdCBpbkZsaWdodDtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICBpbkZsaWdodCA9IG51bGw7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xufVxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XG5cbmNvbnN0IGxldmVscyA9IFsnZGVidWcnLCAnaW5mbycsICd3YXJuJywgJ2Vycm9yJywgJ2ZhdGFsJ10gYXMgY29uc3Q7XG5cbnR5cGUgTG9nTGV2ZWwgPSB0eXBlb2YgbGV2ZWxzW251bWJlcl07XG5cbnR5cGUgUGFyYW1zID0gUGFyYW1ldGVyczx0eXBlb2YgY29uc29sZS5sb2c+O1xuXG50eXBlIExvZ2dlciA9IHtcbiAgbG9nTGV2ZWw6IExvZ0xldmVsO1xuICBkZWJ1ZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGluZm8oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBhbGlhcyBmb3IgaW5mb1xuICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBzcGVjaWFsIHRyZWF0bWVudCwgZGlzYWJsZWQgb24gQ0kvVFRZXG4gIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbn07XG5cbmNvbnN0IGVuYWJsZWRMZXZlbHNBZnRlciA9IChsZXZlbDogTG9nTGV2ZWwgfCAnb2ZmJykgPT4ge1xuICBpZiAobGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIGNvbnN0IGluZGV4ID0gbGV2ZWxzLmZpbmRJbmRleCgoaXRlbSkgPT4gaXRlbSA9PT0gbGV2ZWwpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxldmVsJyk7XG4gIH1cbiAgcmV0dXJuIGxldmVscy5zbGljZShpbmRleCk7XG59O1xuXG5jb25zdCBpc0xldmVsID0gKGxldmVsPzogc3RyaW5nKTogbGV2ZWwgaXMgTG9nTGV2ZWwgPT4ge1xuICByZXR1cm4gbGV2ZWxzLmluY2x1ZGVzKGxldmVsIGFzIExvZ0xldmVsKTtcbn07XG5cbmNvbnN0IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncyA9IChcbiAgYXJncyA9IHByb2Nlc3MuYXJndlxuKTogTG9nTGV2ZWwgfCAnb2ZmJyB8IHVuZGVmaW5lZCA9PiB7XG4gIGNvbnN0IGluZGV4ID0gYXJncy5maW5kSW5kZXgoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gJy0tbG9nLWxldmVsJyk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGNvbnN0IGxldmVsID0gYXJnc1tpbmRleCArIDFdO1xuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiAnb2ZmJztcbiAgfVxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlGcm9tRW52ID0gKCk6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xuICBjb25zdCBsZXZlbCA9IHByb2Nlc3MuZW52WydMT0dfTEVWRUwnXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgZ2V0VmVyYm9zaXR5Q29uZmlnID0gKCkgPT4ge1xuICBjb25zdCBhcmdzTGV2ZWwgPSB2ZXJib3NpdHlGcm9tUHJvY2Vzc0FyZ3MoKTtcbiAgY29uc3QgZW52TGV2ZWwgPSB2ZXJib3NpdHlGcm9tRW52KCk7XG4gIHJldHVybiBhcmdzTGV2ZWwgPz8gZW52TGV2ZWwgPz8gJ2luZm8nO1xufTtcblxuY29uc3Qgbm9vcCA9ICguLi5fYXJnczogUGFyYW1zKSA9PiB7XG4gIHJldHVybjtcbn07XG5cbmNvbnN0IGxvZyA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5sb2coLi4uYXJncyk7XG59O1xuXG5jb25zdCBlcnJvciA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5lcnJvciguLi5hcmdzKTtcbn07XG5cbmNvbnN0IHNob3VsZEVuYWJsZVRpcCA9ICgpID0+ICFwcm9jZXNzLmVudlsnQ0knXSAmJiAhcHJvY2Vzcy5zdGRvdXQuaXNUVFk7XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoXG4gIGRlcHMgPSB7IGdldFZlcmJvc2l0eUNvbmZpZywgbG9nLCBlcnJvciwgc2hvdWxkRW5hYmxlVGlwIH1cbikgPT4ge1xuICBjb25zdCBsb2dMZXZlbCA9IGRlcHMuZ2V0VmVyYm9zaXR5Q29uZmlnKCk7XG4gIGNvbnN0IGVuYWJsZWQgPSBlbmFibGVkTGV2ZWxzQWZ0ZXIobG9nTGV2ZWwpO1xuICByZXR1cm4gbGV2ZWxzLnJlZHVjZShcbiAgICAoYWNjLCBsdmwpID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmFjYyxcbiAgICAgICAgW2x2bF06IGVuYWJsZWQuaW5jbHVkZXMobHZsKVxuICAgICAgICAgID8gWydmYXRhbCcsICdlcnJvciddLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICAgID8gZGVwcy5lcnJvclxuICAgICAgICAgICAgOiBkZXBzLmxvZ1xuICAgICAgICAgIDogbm9vcCxcbiAgICAgIH07XG4gICAgfSxcbiAgICB7XG4gICAgICBsb2dMZXZlbCxcbiAgICAgIGxvZzogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpID8gZGVwcy5sb2cgOiBub29wLFxuICAgICAgdGlwOiBlbmFibGVkLmluY2x1ZGVzKCdpbmZvJykgJiYgZGVwcy5zaG91bGRFbmFibGVUaXAoKSA/IGRlcHMubG9nIDogbm9vcCxcbiAgICB9IGFzIExvZ2dlclxuICApO1xufTtcblxuY29uc3QgY3JlYXRlRGVsZWdhdGluZ0xvZ2dlciA9IChvcHRzOiB7IHBhcmVudDogTG9nZ2VyIH0pOiBMb2dnZXIgPT5cbiAgT2JqZWN0LmZyZWV6ZSh7XG4gICAgZ2V0IGxvZ0xldmVsKCkge1xuICAgICAgcmV0dXJuIG9wdHMucGFyZW50LmxvZ0xldmVsO1xuICAgIH0sXG4gICAgZGVidWcoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmRlYnVnKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5pbmZvKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmxvZyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgdGlwKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC50aXAoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50Lndhcm4oLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGVycm9yKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5lcnJvciguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgZmF0YWwoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmZhdGFsKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgfSk7XG5cbmxldCBkZWZhdWx0TG9nZ2VyRmFjdG9yeTogKCgpID0+IExvZ2dlcikgfCBudWxsO1xuXG5leHBvcnQgY29uc3QgY29uZmlndXJlRGVmYXVsdExvZ2dlciA9IChmYWN0b3J5OiAoKSA9PiBMb2dnZXIpID0+IHtcbiAgaWYgKGRlZmF1bHRMb2dnZXJGYWN0b3J5KSB7XG4gICAgY29uc3QgZXJyb3IgPSB7XG4gICAgICBzdGFjazogJycsXG4gICAgfTtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShlcnJvcik7XG4gICAgbG9nZ2VyLmRlYnVnKCdDYW5ub3Qgb3ZlcnJpZGUgZGVmYXVsdCBsb2dnZXIgbXVsdGlwbGUgdGltZXMnLCBlcnJvci5zdGFjayk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGRlZmF1bHRMb2dnZXJGYWN0b3J5ID0gZmFjdG9yeTtcbn07XG5cbmNvbnN0IGRlZmF1bHRMb2dnZXIgPSBvbmNlKCgpID0+IHtcbiAgbGV0IGZhY3RvcnkgPSBkZWZhdWx0TG9nZ2VyRmFjdG9yeTtcbiAgaWYgKCFmYWN0b3J5KSB7XG4gICAgZmFjdG9yeSA9ICgpID0+IGNyZWF0ZUxvZ2dlcigpO1xuICB9XG4gIHJldHVybiBmYWN0b3J5KCk7XG59KTtcblxuLyoqXG4gKiBEZWZhdWx0IGxvZ2dlciBpbnN0YW5jZSBjYW4gYmUgY29uZmlndXJlZCBvbmNlIGF0IHN0YXJ0dXBcbiAqL1xuZXhwb3J0IGNvbnN0IGxvZ2dlcjogTG9nZ2VyID0gY3JlYXRlRGVsZWdhdGluZ0xvZ2dlcih7XG4gIGdldCBwYXJlbnQoKSB7XG4gICAgcmV0dXJuIGRlZmF1bHRMb2dnZXIoKTtcbiAgfSxcbn0pO1xuIiwiLyoqXG4gKiBDYXB0dXJlIHRoZSBzdGFjayB0cmFjZSBhbmQgYWxsb3cgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgdGhyb3duIGluIGFzeW5jaHJvbm91cyBjYWxsYmFja3NcbiAqIHdpdGggYWRkaXRpb25hbCBzdGFjayBpbmZvcm1hdGlvbiBjYXB0dXJlZCBhdCB0aGUgbW9tZW50IG9mIHRoZSBjYWxsIG9mIHRoaXMgZnVuY3Rpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhcHR1cmVTdGFja1RyYWNlKHJlbW92ZSA9IDApIHtcbiAgY29uc3Qgc3RhY2tDb250YWluZXIgPSB7XG4gICAgc3RhY2s6ICcnLFxuICB9O1xuICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShzdGFja0NvbnRhaW5lcik7XG4gIGNvbnN0IHN0YWNrVHJhY2UgPSBzdGFja0NvbnRhaW5lci5zdGFja1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuc2xpY2UoNiArIHJlbW92ZSlcbiAgICAuam9pbignXFxuJyk7XG4gIHJldHVybiB7XG4gICAgLyoqXG4gICAgICogQ2FwdHVyZWQgc3RhY2sgdHJhY2UgaW5mb3JtYXRpb25cbiAgICAgKi9cbiAgICBzdGFja1RyYWNlLFxuICAgIC8qKlxuICAgICAqIENhbiBiZSBjYWxsZWQgaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrIHRvIGVucmljaCBleGNlcHRpb25zIHdpdGggYWRkaXRpb25hbCBpbmZvcm1hdGlvblxuICAgICAqIEBwYXJhbSBlcnIgRXhjZXB0aW9uIHRvIGVucmljaCAtIGl0IGlzIGdvaW5nIHRvIGhhdmUgaXRzIGAuc3RhY2tgIHByb3AgbXV0YXRlZFxuICAgICAqIEByZXR1cm5zIFNhbWUgZXhjZXB0aW9uXG4gICAgICovXG4gICAgcHJlcGFyZUZvclJldGhyb3c6IChlcnI6IEVycm9yKSA9PiB7XG4gICAgICBjb25zdCBvbGRTdGFja1RyYWNlID0gZXJyLnN0YWNrID8/ICcnLnNwbGl0KCdcXG4nKS5zbGljZSgxKS5qb2luKCdcXG4nKTtcbiAgICAgIGVyci5zdGFjayA9IGAke2Vyci5uYW1lIHx8ICdFcnJvcid9OiAke1xuICAgICAgICBlcnIubWVzc2FnZVxuICAgICAgfVxcbiR7b2xkU3RhY2tUcmFjZX1cXG4ke3N0YWNrVHJhY2V9YDtcbiAgICAgIHJldHVybiBlcnI7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHNwYXduIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IEFzc2lnbiB9IGZyb20gJ3V0aWxpdHktdHlwZXMnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IGNhcHR1cmVTdGFja1RyYWNlIH0gZnJvbSAnLi4vdXRpbHMvc3RhY2tUcmFjZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduVG9Qcm9taXNlT3B0cyA9IHtcbiAgLyoqXG4gICAqIFNwZWNpZnkgZXhpdCBjb2RlcyB3aGljaCBzaG91bGQgbm90IHJlc3VsdCBpbiB0aHJvd2luZyBhbiBlcnJvciB3aGVuXG4gICAqIHRoZSBwcm9jZXNzIGhhcyBmaW5pc2hlZCwgZS5nLiBzcGVjaWZ5aW5nIGBbMF1gIG1lYW5zIGlmIHByb2Nlc3MgZmluaXNoZWRcbiAgICogd2l0aCB6ZXJvIGV4aXQgY29kZSB0aGVuIHRoZSBwcm9taXNlIHdpbGwgcmVzb2x2ZSBpbnN0ZWFkIG9mIHJlamVjdGluZy5cbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgc3BlY2lmeSBgaW5oZXJpdGAgdG8gc2F2ZSBzdGF0dXMgY29kZSB0byB0aGUgY3VycmVudCBgcHJvY2Vzcy5leGl0Q29kZWBcbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgY29tcGxldGVseSBpZ25vcmUgdGhlIGV4aXQgY29kZSAoZS5nLiB5b3UgZm9sbG93IHVwIGFuZCBpbnRlcnJvZ2F0ZVxuICAgKiB0aGUgcHJvY2VzcyBjb2RlIG1hbnVhbGx5IGFmdGVyd2FyZHMpXG4gICAqL1xuICBleGl0Q29kZXM6IG51bWJlcltdIHwgJ2luaGVyaXQnIHwgJ2FueSc7XG59O1xuXG50eXBlIFNoYXJlZE9wdHMgPSBQaWNrPFNwYXduT3B0aW9ucywgJ2N3ZCc+O1xuXG50eXBlIFNwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PiA9IFtcbiAgY29tbWFuZDogc3RyaW5nLFxuICBhcmdzOiBSZWFkb25seUFycmF5PHN0cmluZz4sXG4gIG9wdGlvbnM6IEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+XG5dO1xuXG5leHBvcnQgdHlwZSBTcGF3bk9wdGlvbnNXaXRoRXh0cmE8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICBBc3NpZ248U3Bhd25PcHRpb25zLCBFPjtcblxuZXhwb3J0IHR5cGUgU3Bhd25QYXJhbWV0ZXJNaXg8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICB8IFtjcDogQ2hpbGRQcm9jZXNzLCBleHRyYU9wdHM6IEFzc2lnbjxFLCBTaGFyZWRPcHRzPl1cbiAgfCBTcGF3bkFyZ3M8RT47XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgYXJnczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbik6IGFyZ3MgaXMgU3Bhd25BcmdzPEU+IHtcbiAgcmV0dXJuICEoYXJnc1swXSBpbnN0YW5jZW9mIENoaWxkUHJvY2VzcykgJiYgdHlwZW9mIGFyZ3NbMF0gPT09ICdzdHJpbmcnO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzPEUgZXh0ZW5kcyBvYmplY3Q+KFxuICBwYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxFPlxuKSB7XG4gIGNvbnN0IFtjaGlsZCwgW2NvbW1hbmQsIGFyZ3MsIG9wdHNdXSA9IGlzU3Bhd25BcmdzKHBhcmFtZXRlcnMpXG4gICAgPyBbXG4gICAgICAgIHNwYXduKC4uLihwYXJhbWV0ZXJzIGFzIHVua25vd24gYXMgUGFyYW1ldGVyczx0eXBlb2Ygc3Bhd24+KSksXG4gICAgICAgIHBhcmFtZXRlcnMsXG4gICAgICBdXG4gICAgOiBbXG4gICAgICAgIHBhcmFtZXRlcnNbMF0sXG4gICAgICAgIFtcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduZmlsZSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduYXJncy5zbGljZSgxKSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzFdIGFzIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+LFxuICAgICAgICBdLFxuICAgICAgXTtcbiAgcmV0dXJuIHtcbiAgICBjaGlsZCxcbiAgICBjb21tYW5kLFxuICAgIGFyZ3MsXG4gICAgb3B0cyxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduVG9Qcm9taXNlKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHsgY2hpbGQsIGNvbW1hbmQsIGFyZ3MsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgeyBwcmVwYXJlRm9yUmV0aHJvdyB9ID0gY2FwdHVyZVN0YWNrVHJhY2UoKTtcblxuICBjb25zdCBleGl0Q29kZXMgPSBvcHRzLmV4aXRDb2RlcztcblxuICBjb25zdCBjd2QgPSBvcHRzLmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY21kID0gKCkgPT4gW2NvbW1hbmQsIC4uLmFyZ3NdLmpvaW4oJyAnKTtcblxuICBsb2dnZXIuZGVidWcoWyc+JywgY21kKCldLmpvaW4oJyAnKSwgLi4uKGN3ZCA/IFtgaW4gJHtjd2R9YF0gOiBbXSkpO1xuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMsIHJlaikgPT5cbiAgICBjaGlsZFxuICAgICAgLm9uKCdjbG9zZScsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGV4aXRDb2RlcyAhPT0gJ2luaGVyaXQnICYmXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdhbnknICYmXG4gICAgICAgICAgICAhZXhpdENvZGVzLmluY2x1ZGVzKGNvZGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZWooXG4gICAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihgQ29tbWFuZCBcIiR7Y21kKCl9XCIgaGFzIGZhaWxlZCB3aXRoIGNvZGUgJHtjb2RlfWApXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgICByZWooXG4gICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBGYWlsZWQgdG8gZXhlY3V0ZSBjb21tYW5kIFwiJHtjbWQoKX1cIiAtICR7c2lnbmFsfWApXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLm9uKCdlcnJvcicsIHJlailcbiAgKTtcbiAgLy8gaW5oZXJpdCBleGl0IGNvZGVcbiAgaWYgKGV4aXRDb2RlcyA9PT0gJ2luaGVyaXQnKSB7XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIGNoaWxkLmV4aXRDb2RlID09PSAnbnVtYmVyJyAmJlxuICAgICAgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJyB8fCBwcm9jZXNzLmV4aXRDb2RlID09PSAwKVxuICAgICkge1xuICAgICAgcHJvY2Vzcy5leGl0Q29kZSA9IGNoaWxkLmV4aXRDb2RlO1xuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuXG5pbXBvcnQgdHlwZSB7IFNwYXduUGFyYW1ldGVyTWl4LCBTcGF3blRvUHJvbWlzZU9wdHMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcblxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRPcHRzID0ge1xuICBvdXRwdXQ/OlxuICAgIHwgQXJyYXk8J3N0ZG91dCcgfCAnc3RkZXJyJz5cbiAgICB8IFsnc3Rkb3V0JyB8ICdzdGRlcnInLCAuLi5BcnJheTwnc3Rkb3V0JyB8ICdzdGRlcnInPl07XG4gIGJ1ZmZlcnM/OiB7XG4gICAgY29tYmluZWQ/OiBzdHJpbmdbXTtcbiAgICBzdGRvdXQ/OiBzdHJpbmdbXTtcbiAgICBzdGRlcnI/OiBzdHJpbmdbXTtcbiAgfTtcbn0gJiBTcGF3blRvUHJvbWlzZU9wdHM7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0UmV0dXJuID0ge1xuICBwaWQ/OiBudW1iZXI7XG4gIG91dHB1dDogc3RyaW5nW107XG4gIHN0ZG91dDogc3RyaW5nO1xuICBzdGRlcnI6IHN0cmluZztcbiAgc3RhdHVzOiBudW1iZXIgfCBudWxsO1xuICBzaWduYWw6IE5vZGVKUy5TaWduYWxzIHwgbnVsbDtcbiAgZXJyb3I/OiBFcnJvciB8IHVuZGVmaW5lZDtcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blJlc3VsdChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxTcGF3blJlc3VsdFJldHVybj4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IGNvbWJpbmVkRGF0YTogc3RyaW5nW10gPSBvcHRzLmJ1ZmZlcnM/LmNvbWJpbmVkID8/IFtdO1xuICBjb25zdCBzdGRvdXREYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3Rkb3V0ID8/IFtdO1xuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3RkZXJyID8/IFtdO1xuICBjb25zdCBvdXRwdXQgPSBvcHRzLm91dHB1dCA/PyBbJ3N0ZG91dCcsICdzdGRlcnInXTtcbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3Rkb3V0JykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZG91dCxcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRvdXRcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRvdXREYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3RkZXJyJykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZGVycixcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRlcnJcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3NwYXduVG9Qcm9taXNlKGNoaWxkLCBvcHRzKV0pO1xuICByZXR1cm4ge1xuICAgIHBpZDogY2hpbGQucGlkLFxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcbiAgICBzdGF0dXM6IGNoaWxkLmV4aXRDb2RlLFxuICAgIGdldCBvdXRwdXQoKSB7XG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xuICAgIH0sXG4gICAgZ2V0IHN0ZGVycigpIHtcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IHN0ZG91dCgpIHtcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IGVycm9yKCkge1xuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcbiAgICAgICAgPyAocmVzdWx0LnJlYXNvbiBhcyBFcnJvcilcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMsIFNwYXduUmVzdWx0UmV0dXJuIH0gZnJvbSAnLi9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBzcGF3blJlc3VsdCB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwgb3B0cyk7XG4gIHJldHVybiByZXN1bHQub3V0cHV0LmpvaW4oJycpO1xufVxuXG5jb25zdCBkZWZhdWx0U2hvdWxkT3V0cHV0ID0gKHJlc3VsdDogU3Bhd25SZXN1bHRSZXR1cm4pID0+IHtcbiAgcmV0dXJuIHJlc3VsdC5lcnJvciB8fCByZXN1bHQuc3RhdHVzICE9PSAwIHx8IGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJztcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxcbiAgICBTcGF3blJlc3VsdE9wdHMgJiB7XG4gICAgICAvKipcbiAgICAgICAqIEJ5IGRlZmF1bHQgd2lsbCBvdXRwdXQgdG8gYHN0ZGVycmAgd2hlbiBzcGF3biByZXN1bHQgZmFpbGVkIHdpdGggYW4gZXJyb3IsIHdoZW5cbiAgICAgICAqIHN0YXR1cyBjb2RlIGlzIG5vdCB6ZXJvIG9yIHdoZW4gYExvZ2dlci5sb2dMZXZlbGAgaXMgYGRlYnVnYFxuICAgICAgICovXG4gICAgICBzaG91bGRPdXRwdXQ/OiAocmVzdWx0OiBTcGF3blJlc3VsdFJldHVybikgPT4gYm9vbGVhbjtcbiAgICB9XG4gID5cbikge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcbiAgY29uc3Qgc2hvdWxkT3V0cHV0ID0gb3B0cy5zaG91bGRPdXRwdXQgPz8gZGVmYXVsdFNob3VsZE91dHB1dDtcbiAgaWYgKHNob3VsZE91dHB1dChyZXN1bHQpKSB7XG4gICAgbG9nZ2VyLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xuICB9XG4gIGlmIChyZXN1bHQuZXJyb3IpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG59XG4iLCJpbXBvcnQgeyBkaXJuYW1lLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcblxuaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XG5cbmV4cG9ydCBjb25zdCBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCA9IChvcHRzOiB7XG4gIGltcG9ydE1ldGFVcmw6IHN0cmluZztcbn0pID0+IHtcbiAgLy8gdGhpcyBpcyBoaWdobHkgZGVwZW5kZW50IG9uIHRoZSBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZVxuICAvLyBhbmQgdGhlIGNvbnRleHQgaW4gd2hpY2ggdGhpcyBmdW5jdGlvbiBpcyBydW4gKGJ1bmRsZWQgY29kZSB2cyB0c3ggLi9zcmMvdHNmaWxlLnRzKVxuICBjb25zdCBfX2ZpbGVOYW1lID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICBjb25zdCBwYXJlbnQgPSBkaXJuYW1lKF9fZmlsZU5hbWUpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IGRpcm5hbWUocGFyZW50KTtcblxuICBjb25zdCBpc0J1bmRsZWRJbkRpc3QgPSAoKSA9PiBwYXJlbnQuZW5kc1dpdGgoc2VwICsgJ2Rpc3QnKTtcbiAgY29uc3QgaXNCdW5kbGVkSW5CaW4gPSAoKSA9PlxuICAgIHBhcmVudC5lbmRzV2l0aChzZXAgKyAnYmluJykgJiYgIXN1cGVyUGFyZW50LmVuZHNXaXRoKHNlcCArICdzcmMnKTtcblxuICBpZiAoaXNCdW5kbGVkSW5EaXN0KCkgfHwgaXNCdW5kbGVkSW5CaW4oKSkge1xuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiAnYnVuZGxlZCcgYXMgY29uc3QsXG4gICAgICBwYXRoOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpLFxuICAgIH07XG4gIH1cblxuICAvLyBydW4gdmlhIHRzeCB0byBidWlsZCB0aGUgQHJlcGthLWtpdC90cyBpdHNlbGZcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnc291cmNlJyBhcyBjb25zdCxcbiAgICBwYXRoOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uLy4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpLFxuICB9O1xufTtcblxuZXhwb3J0IGNvbnN0IG1vZHVsZVJvb3REaXJlY3RvcnkgPSBvbmNlKFxuICAoKSA9PlxuICAgIGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsKHsgaW1wb3J0TWV0YVVybDogaW1wb3J0Lm1ldGEudXJsIH0pXG4gICAgICAucGF0aFxuKTtcbiIsImltcG9ydCB7IHJlYWRGaWxlLCBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBkaXJuYW1lLCBqb2luLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi9tb2R1bGVSb290RGlyZWN0b3J5JztcblxuYXN5bmMgZnVuY3Rpb24gaXNGaWxlKGZpbGVQYXRoOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGF3YWl0IHN0YXQoZmlsZVBhdGgpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gcmVzdWx0LmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uKiBpdGVyYXRlTm9kZU1vZHVsZXMoc3RhcnRXaXRoOiBzdHJpbmcsIHBhdGg6IHN0cmluZykge1xuICBsZXQgY3VycmVudCA9IHN0YXJ0V2l0aDtcbiAgd2hpbGUgKGN1cnJlbnQgIT09IHNlcCAmJiBjdXJyZW50ICE9PSAnfi8nKSB7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gam9pbihjdXJyZW50LCAnbm9kZV9tb2R1bGVzJywgcGF0aCk7XG4gICAgaWYgKGF3YWl0IGlzRmlsZShjYW5kaWRhdGUpKSB7XG4gICAgICB5aWVsZCBjYW5kaWRhdGU7XG4gICAgfVxuICAgIGlmIChjdXJyZW50ID09PSBkaXJuYW1lKGN1cnJlbnQpKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY3VycmVudCA9IGRpcm5hbWUoY3VycmVudCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmluZEJpblNjcmlwdChzdGFydFdpdGg6IHN0cmluZywgYmluU2NyaXB0UGF0aDogc3RyaW5nKSB7XG4gIGZvciBhd2FpdCAoY29uc3QgcGF0aCBvZiBpdGVyYXRlTm9kZU1vZHVsZXMoc3RhcnRXaXRoLCBiaW5TY3JpcHRQYXRoKSkge1xuICAgIHJldHVybiBwYXRoO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBiaW5QYXRoKG9wdHM6IHtcbiAgYmluTmFtZTogc3RyaW5nO1xuICBiaW5TY3JpcHRQYXRoOiBzdHJpbmc7XG59KSB7XG4gIGNvbnN0IHJvb3QgPSBtb2R1bGVSb290RGlyZWN0b3J5KCk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZpbmRCaW5TY3JpcHQocm9vdCwgb3B0cy5iaW5TY3JpcHRQYXRoKTtcbiAgaWYgKHJlc3VsdCkge1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgZmluZCBiaW4gJHtvcHRzLmJpbk5hbWV9YCk7XG59XG5cbmZ1bmN0aW9uIHNjcmlwdEZyb21QYWNrYWdlSnNvbihvcHRzOiB7XG4gIGJpbk5hbWU6IHN0cmluZztcbiAgcGFja2FnZUpzb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufSkge1xuICBjb25zdCBjYW5kaWRhdGUgPSBvcHRzLnBhY2thZ2VKc29uWydiaW4nXTtcbiAgaWYgKHR5cGVvZiBjYW5kaWRhdGUgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgY2FuZGlkYXRlID09PSAnb2JqZWN0JyAmJiBjYW5kaWRhdGUgIT09IG51bGwpIHtcbiAgICBjb25zdCBlbnRyeSA9IChjYW5kaWRhdGUgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPilbb3B0cy5iaW5OYW1lXTtcbiAgICBpZiAodHlwZW9mIGVudHJ5ID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGVudHJ5O1xuICAgIH1cbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGV0ZXJtaW5lQmluU2NyaXB0UGF0aChvcHRzOiB7XG4gIGJpbk5hbWU6IHN0cmluZztcbiAgYmluUGFja2FnZU5hbWU6IHN0cmluZztcbn0pIHtcbiAgZm9yIGF3YWl0IChjb25zdCBwYXRoIG9mIGl0ZXJhdGVOb2RlTW9kdWxlcyhcbiAgICBtb2R1bGVSb290RGlyZWN0b3J5KCksXG4gICAgam9pbihvcHRzLmJpblBhY2thZ2VOYW1lLCAncGFja2FnZS5qc29uJylcbiAgKSkge1xuICAgIGNvbnN0IHBrZyA9IGF3YWl0IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpXG4gICAgICAudGhlbigodGV4dCkgPT4gSlNPTi5wYXJzZSh0ZXh0KSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgIC5jYXRjaCgoKSA9PiBudWxsKTtcbiAgICBpZiAoIXBrZykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc2NyaXB0UGF0aCA9IHNjcmlwdEZyb21QYWNrYWdlSnNvbih7XG4gICAgICBiaW5OYW1lOiBvcHRzLmJpbk5hbWUsXG4gICAgICBwYWNrYWdlSnNvbjogcGtnLFxuICAgIH0pO1xuICAgIGlmICghc2NyaXB0UGF0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgY2FuZGlkYXRlID0gam9pbihkaXJuYW1lKHBhdGgpLCBzY3JpcHRQYXRoKTtcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGNhbmRpZGF0ZSkpIHtcbiAgICAgIC8vIGRlbm9ybWFsaXplIGFuZCBtYWtlIHRoaXMgY29uc2lzdGVudCBvbiBhbGwgcGxhdGZvcm1zXG4gICAgICAvLyBhcyB0aGUgcGF0aCB3aWxsIHdvcmsgYm90aCBmb3Igd2luZG93cyBhbmQgbm9uLXdpbmRvd3NcbiAgICAgIHJldHVybiBqb2luKG9wdHMuYmluUGFja2FnZU5hbWUsIHNjcmlwdFBhdGgpLnJlcGxhY2VBbGwoc2VwLCAnLycpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiaW1wb3J0IHsgcGVyZm9ybWFuY2UgfSBmcm9tICdub2RlOnBlcmZfaG9va3MnO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcblxuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgYmluUGF0aCB9IGZyb20gJy4vdXRpbHMvYmluUGF0aCc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Uc1NjcmlwdChvcHRzOiB7XG4gIGxvY2F0aW9uOiBzdHJpbmc7XG4gIGltcG9ydE1ldGFVcmw/OiBVUkw7XG4gIGFyZ3M/OiBzdHJpbmdbXTtcbn0pIHtcbiAgY29uc3Qgc3RhcnRlZCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICB0cnkge1xuICAgIGNvbnN0IGxvY2F0aW9uID0gb3B0cy5pbXBvcnRNZXRhVXJsXG4gICAgICA/IGZpbGVVUkxUb1BhdGgobmV3IFVSTChvcHRzLmxvY2F0aW9uLCBvcHRzLmltcG9ydE1ldGFVcmwpKVxuICAgICAgOiBvcHRzLmxvY2F0aW9uO1xuXG4gICAgaWYgKGxvZ2dlci5sb2dMZXZlbCAhPT0gJ2RlYnVnJykge1xuICAgICAgbG9nZ2VyLmxvZyhgUnVubmluZyBcIiR7bG9jYXRpb259XCJgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbChcbiAgICAgIHByb2Nlc3MuZXhlY1BhdGgsXG4gICAgICBbXG4gICAgICAgIGF3YWl0IGJpblBhdGgoe1xuICAgICAgICAgIGJpbk5hbWU6ICd0c3gnLFxuICAgICAgICAgIGJpblNjcmlwdFBhdGg6ICd0c3gvZGlzdC9jbGkuanMnLFxuICAgICAgICB9KSxcbiAgICAgICAgbG9jYXRpb24sXG4gICAgICAgIC4uLihvcHRzLmFyZ3MgfHwgW10pLFxuICAgICAgXSxcbiAgICAgIHtcbiAgICAgICAgZXhpdENvZGVzOiBbMF0sXG4gICAgICAgIC4uLihsb2dnZXIubG9nTGV2ZWwgPT09ICdkZWJ1ZycgJiYge1xuICAgICAgICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgICAgICAgb3V0cHV0OiBbXSxcbiAgICAgICAgfSksXG4gICAgICAgIGVudjoge1xuICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgIExPR19MRVZFTDogbG9nZ2VyLmxvZ0xldmVsLFxuICAgICAgICB9LFxuICAgICAgfVxuICAgICk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGxvZ2dlci5sb2dMZXZlbCAhPT0gJ2RlYnVnJykge1xuICAgICAgbG9nZ2VyLmxvZyhcbiAgICAgICAgYEZpbmlzaGVkIGluICR7KChwZXJmb3JtYW5jZS5ub3coKSAtIHN0YXJ0ZWQpIC8gMTAwMCkudG9GaXhlZCgyKX1zYFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcblxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4uL3V0aWxzL21vZHVsZVJvb3REaXJlY3RvcnknO1xuaW1wb3J0IHR5cGUgeyBQYWNrYWdlSnNvbiB9IGZyb20gJy4vcGFja2FnZUpzb24nO1xuXG5jb25zdCBjd2RQYWNrYWdlSnNvblBhdGggPSAoKSA9PiBqb2luKHByb2Nlc3MuY3dkKCksICcuL3BhY2thZ2UuanNvbicpO1xuXG5hc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb25BdChcbiAgcGF0aDogc3RyaW5nLFxuICBkZXBzID0geyByZWFkRmlsZTogKHBhdGg6IHN0cmluZykgPT4gcmVhZEZpbGUocGF0aCwgJ3V0Zi04JykgfVxuKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xuICByZXR1cm4gYXdhaXQgZGVwc1xuICAgIC5yZWFkRmlsZShwYXRoKVxuICAgIC50aGVuKChyZXN1bHQpID0+IEpTT04ucGFyc2UocmVzdWx0KSBhcyBQYWNrYWdlSnNvbik7XG59XG5cbmV4cG9ydCBjb25zdCByZWFkQ3dkUGFja2FnZUpzb24gPSBvbmNlQXN5bmMoKCkgPT5cbiAgcmVhZFBhY2thZ2VKc29uQXQoY3dkUGFja2FnZUpzb25QYXRoKCkpXG4pO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZFBhY2thZ2VKc29uKFxuICBwYXRoOiBzdHJpbmcsXG4gIGRlcHMgPSB7IHJlYWRGaWxlOiAocGF0aDogc3RyaW5nKSA9PiByZWFkRmlsZShwYXRoLCAndXRmLTgnKSB9XG4pOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIC8vIGFzc3VtaW5nIGN1cnJlbnQgZGlyZWN0b3J5IGRvZXNuJ3QgY2hhbmdlIHdoaWxlIGFwcCBpcyBydW5uaW5nXG4gIHJldHVybiBwcm9jZXNzLmN3ZCgpID09PSBjd2RQYWNrYWdlSnNvblBhdGgoKVxuICAgID8gYXdhaXQgcmVhZEN3ZFBhY2thZ2VKc29uKClcbiAgICA6IGF3YWl0IHJlYWRQYWNrYWdlSnNvbkF0KHBhdGgsIGRlcHMpO1xufVxuXG4vKipcbiAqIFJlYWQgcGFja2FnZSBqc29uIG9mIHRoZSBjdXJyZW50IGxpYnJhcnkgKEByZXBrYS1raXQvdHMpXG4gKi9cbmV4cG9ydCBjb25zdCBvdXJQYWNrYWdlSnNvbiA9IG9uY2VBc3luYyhcbiAgYXN5bmMgKFxuICAgIGRlcHMgPSB7XG4gICAgICByZWFkRmlsZTogKHBhdGg6IHN0cmluZykgPT4gcmVhZEZpbGUocGF0aCwgJ3V0Zi04JyksXG4gICAgfVxuICApID0+IHtcbiAgICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSBqb2luKG1vZHVsZVJvb3REaXJlY3RvcnkoKSwgJ3BhY2thZ2UuanNvbicpO1xuICAgIHJldHVybiBhd2FpdCByZWFkUGFja2FnZUpzb25BdChwYWNrYWdlSnNvblBhdGgsIHtcbiAgICAgIHJlYWRGaWxlOiBkZXBzLnJlYWRGaWxlLFxuICAgIH0pO1xuICB9XG4pO1xuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydCc7XG5pbXBvcnQgeyBkaXJuYW1lLCBub3JtYWxpemUsIHNlcCB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IGVzY2FwZVJlZ0V4cCwgaXNUcnV0aHksIG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcblxuY29uc3QgZ2V0UmVwb3NpdG9yeVJvb3RTY2FuQ2FuZGlkYXRlcyA9IChjdXJyZW50RGlyZWN0b3J5OiBzdHJpbmcpID0+IHtcbiAgY29uc3QgZXNjID0gZXNjYXBlUmVnRXhwKHNlcCk7XG4gIC8vIGhhdmluZyAncGFja2FnZXMvKicgaW4gdGhlIHJvb3Qgb2YgYSBtb25vcmVwbyBpcyBzdXBlciBjb21tb25cbiAgY29uc3QgcmVzdWx0ID0gbmV3IFJlZ0V4cChcbiAgICBgKC4qKD89JHtlc2N9cGFja2FnZXMke2VzY30pKXwoLiooPz0ke2VzY31ub2RlX21vZHVsZXMke2VzY30pKXwoLiopYFxuICApLmV4ZWMoY3VycmVudERpcmVjdG9yeSk7XG4gIGFzc2VydCghIXJlc3VsdCk7XG4gIGNvbnN0IFssIHBhY2thZ2VzUm9vdCwgbm9kZU1vZHVsZXNSb290XSA9IHJlc3VsdDtcbiAgcmV0dXJuIFtwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdF0uZmlsdGVyKGlzVHJ1dGh5KTtcbn07XG5cbi8vIHJldHVybnMgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aGljaCBoYXMgbW9ub3JlcG8gbWFya2VycywgbXVsdGlwbGVcbi8vIGRpcmVjdG9yaWVzIGNhbiBoYXZlIHRoZW0gLSB3aGljaGV2ZXIgcmVhZCBmaXJzdCB3aWxsIGJlIHJldHVybmVkXG4vLyBzbyBpZiBvcmRlciBpcyBpbXBvcnRhbnQgLSBzY2FubmluZyBzaG91bGQgYmUgc2VwYXJhdGVkIHRvIG11bHRpcGxlIGpvYnNcbi8vIHZpYSBwcmlvcml0aXplZEhhc01vbm9yZXBvTWFya2Vyc1xuY29uc3QgaGFzUm9vdE1hcmtlcnNGb3IgPSBhc3luYyAoY2FuZGlkYXRlOiBzdHJpbmcpID0+IHtcbiAgY29uc3QgbWFya2VycyA9IFtcbiAgICAnLmdpdCcsXG4gICAgJ3lhcm4ubG9jaycsXG4gICAgJ3BucG0tbG9jay55YW1sJyxcbiAgICAncGFja2FnZS1sb2NrLmpzb24nLFxuICAgICdwbnBtLXdvcmtzcGFjZS55YW1sJyxcbiAgXTtcbiAgY29uc3QgbWFya2Vyc1N0cmVhbSA9IGZnLnN0cmVhbShtYXJrZXJzLCB7XG4gICAgbWFya0RpcmVjdG9yaWVzOiB0cnVlLFxuICAgIG9ubHlGaWxlczogZmFsc2UsXG4gICAgY3dkOiBjYW5kaWRhdGUsXG4gICAgYWJzb2x1dGU6IHRydWUsXG4gIH0pO1xuICBmb3IgYXdhaXQgKGNvbnN0IGVudHJ5IG9mIG1hcmtlcnNTdHJlYW0pIHtcbiAgICBhc3NlcnQodHlwZW9mIGVudHJ5ID09PSAnc3RyaW5nJyk7XG4gICAgcmV0dXJuIGRpcm5hbWUoZW50cnkpO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG5jb25zdCBoYXNSb290TWFya2VycyA9IGFzeW5jIChjYW5kaWRhdGVzOiBzdHJpbmdbXSkgPT4ge1xuICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgY2FuZGlkYXRlcy5tYXAoKGNhbmRpZGF0ZSkgPT4gaGFzUm9vdE1hcmtlcnNGb3IoY2FuZGlkYXRlKSlcbiAgKTtcbiAgcmV0dXJuIHJlc3VsdHMuZmlsdGVyKGlzVHJ1dGh5KVswXTtcbn07XG5cbmNvbnN0IHByaW9yaXRpemVkSGFzTWFya2VycyA9IChqb2JzOiBzdHJpbmdbXVtdKSA9PiB7XG4gIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+KChyZXMpID0+IHtcbiAgICBjb25zdCByZXN1bHRzID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZyB8IHVuZGVmaW5lZD4oKTtcblxuICAgIGNvbnN0IGNoZWNrU2hvdWxkQ29tcGxldGUgPSAoaW5kZXg6IG51bWJlciwgcmVzdWx0OiBzdHJpbmcgfCB1bmRlZmluZWQpID0+IHtcbiAgICAgIHJlc3VsdHMuc2V0KGluZGV4LCByZXN1bHQpO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBqb2JzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGNvbnN0IGhhc1Jlc3VsdCA9IHJlc3VsdHMuaGFzKGkpO1xuICAgICAgICBpZiAoIWhhc1Jlc3VsdCkge1xuICAgICAgICAgIC8vIGlmIGEgam9iIHdpdGggaGlnaGVzdCBwcmlvcml0eSBoYXNuJ3QgZmluaXNoZWQgeWV0XG4gICAgICAgICAgLy8gdGhlbiB3YWl0IGZvciBpdFxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc3VsdHMuZ2V0KGkpO1xuICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgLy8gam9iIGZpbmlzaGVkIGFuZCB3ZSBmb3VuZCBtYXJrZXJzLCBhbHNvIGFsbCBqb2JzXG4gICAgICAgICAgLy8gd2l0aCBoaWdoZXIgcHJpb3JpdHkgZmluaXNoZWQgYW5kIHRoZXkgZG9uJ3QgaGF2ZVxuICAgICAgICAgIC8vIGFueSBtYXJrZXJzIC0gd2UgYXJlIGRvbmVcbiAgICAgICAgICByZXMocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHJlc3VsdHMuc2l6ZSA9PT0gam9icy5sZW5ndGgpIHtcbiAgICAgICAgLy8gYWxsIGpvYnMgZmluaXNoZWQgLSBubyBtYXJrZXJzIGZvdW5kXG4gICAgICAgIHJlcyh1bmRlZmluZWQpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBqb2JzLmZvckVhY2goKGRpcmVjdG9yaWVzLCBpbmRleCkgPT4ge1xuICAgICAgaGFzUm9vdE1hcmtlcnMoZGlyZWN0b3JpZXMpXG4gICAgICAgIC50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgICBjaGVja1Nob3VsZENvbXBsZXRlKGluZGV4LCByZXN1bHQpO1xuICAgICAgICB9KVxuICAgICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgIC8vIGlnbm9yZVxuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufTtcblxuZXhwb3J0IGNvbnN0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4gPSBhc3luYyAoXG4gIGxvb2t1cERpcmVjdG9yeTogc3RyaW5nXG4pID0+IHtcbiAgY29uc3QgdW5pcXVlRGlybmFtZSA9IChwYXRoPzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKCFwYXRoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGRpcm5hbWUocGF0aCk7XG4gICAgaWYgKHJlc3VsdCA9PT0gcGF0aCkge1xuICAgICAgLy8gZS5nLiB0aGUgcGF0aCB3YXMgYWxyZWFkeSBhIHJvb3QgXCIvXCJcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICBjb25zdCBwYXJlbnQgPSB1bmlxdWVEaXJuYW1lKGxvb2t1cERpcmVjdG9yeSk7XG4gIGNvbnN0IHN1cGVyUGFyZW50ID0gdW5pcXVlRGlybmFtZShwYXJlbnQpO1xuXG4gIGNvbnN0IHJlc3VsdCA9XG4gICAgKGF3YWl0IHByaW9yaXRpemVkSGFzTWFya2VycyhcbiAgICAgIC8vIHNjYW4gaW4gbW9zdCBsaWtlbHkgbG9jYXRpb25zIGZpcnN0IHdpdGggY3VycmVudCBsb29rdXAgZGlyZWN0b3J5IHRha2luZyBwcmlvcml0eVxuICAgICAgW1xuICAgICAgICBbbG9va3VwRGlyZWN0b3J5XSxcbiAgICAgICAgZ2V0UmVwb3NpdG9yeVJvb3RTY2FuQ2FuZGlkYXRlcyhsb29rdXBEaXJlY3RvcnkpLFxuICAgICAgICAvLyBzY2FuIDIgZGlyZWN0b3JpZXMgdXB3YXJkc1xuICAgICAgICBbcGFyZW50XSxcbiAgICAgICAgW3N1cGVyUGFyZW50XSxcbiAgICAgIF1cbiAgICAgICAgLm1hcCgoZGlycykgPT4gZGlycy5maWx0ZXIoaXNUcnV0aHkpKVxuICAgICAgICAuZmlsdGVyKChqb2IpID0+IGpvYi5sZW5ndGggPiAwKVxuICAgICkpIHx8IGxvb2t1cERpcmVjdG9yeTsgLyogZmFsbGJhY2sgdG8gY3VycmVudCBkaXJlY3RvcnkgaW4gd29yc2Ugc2NlbmFyaW8gKi9cblxuICByZXR1cm4gbm9ybWFsaXplKHJlc3VsdCk7XG59O1xuXG4vKipcbiAqIERldGVybWluZSByZXBvc2l0b3J5IHJvb3QgcGF0aCBieSBzY2FubmluZyBjdXJyZW50IGFuZCBwYXJlbnQgZGlyZWN0b3JpZXNcbiAqIGFuZCBsb29raW5nIGZvciBtYXJrZXIgZmlsZXMvZGlycyBsaWtlOlxuICpcbiAqIC0gLmdpdFxuICogLSBwYWNrYWdlLWxvY2suanNvblxuICogLSB5YXJuLmxvY2tcbiAqIC0gcG5wbS1sb2NrLnlhbWxcbiAqIC0gcG5wbS13b3Jrc3BhY2UueWFtbFxuICovXG5leHBvcnQgY29uc3QgcmVwb3NpdG9yeVJvb3RQYXRoID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3Qgcm9vdFBhdGggPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuKHByb2Nlc3MuY3dkKCkpO1xuICByZXR1cm4gcm9vdFBhdGg7XG59KTtcbiIsImltcG9ydCB7IHN0YXQgfSBmcm9tICdmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAncGF0aCc7XG5cbmltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zV2l0aEV4dHJhIH0gZnJvbSAnLi9jaGlsZC1wcm9jZXNzJztcbmltcG9ydCB7IHNwYXduT3V0cHV0Q29uZGl0aW9uYWwgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3Mvc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHsgYmluUGF0aCB9IGZyb20gJy4vdXRpbHMvYmluUGF0aCc7XG5pbXBvcnQgdHlwZSB7IENsaUFyZ3MgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IHNldFNjcmlwdCB9IGZyb20gJy4vdXRpbHMvY2xpQXJnc1BpcGUnO1xuaW1wb3J0IHsgY2xpQXJnc1BpcGUgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGluc2VydEFmdGVyQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGluY2x1ZGVzQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuZXhwb3J0IHR5cGUgVGFza1R5cGVzID1cbiAgfCAnbGludCdcbiAgfCAnYnVpbGQnXG4gIHwgJ3Rlc3QnXG4gIHwgJ2RlY2xhcmF0aW9ucydcbiAgfCAnaW50ZWdyYXRpb24nXG4gIHwgJ3NldHVwOmludGVncmF0aW9uJ1xuICB8IChzdHJpbmcgJiB7XG4gICAgICBfYWxsb3dTdHJpbmdzPzogdW5kZWZpbmVkO1xuICAgIH0pO1xuXG5leHBvcnQgY29uc3QgdHVyYm9CaW5QYXRoID0gKCkgPT5cbiAgYmluUGF0aCh7XG4gICAgYmluTmFtZTogJ3R1cmJvJyxcbiAgICBiaW5TY3JpcHRQYXRoOiAndHVyYm8vYmluL3R1cmJvJyxcbiAgfSk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYXNUdXJib0pzb24oKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICByZXR1cm4gYXdhaXQgc3RhdChqb2luKGN3ZCwgJ3R1cmJvLmpzb24nKSlcbiAgICAudGhlbigocmVzKSA9PiByZXMuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhc3NUdXJib0ZvcmNlRW52KGFyZ3M6IHN0cmluZ1tdKSB7XG4gIHJldHVybiBpbmNsdWRlc0FueU9mKGFyZ3MsIFsncnVuJ10pICYmIGluY2x1ZGVzQW55T2YoYXJncywgWyctLWZvcmNlJ10pXG4gICAgPyB7XG4gICAgICAgIFRVUkJPX0ZPUkNFOiAnMScsXG4gICAgICB9XG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbmhlcml0VHVyYm9Gb3JjZUFyZ0Zyb21FbnYoKSB7XG4gIHJldHVybiAoc3RhdGU6IENsaUFyZ3MpID0+ICh7XG4gICAgLi4uc3RhdGUsXG4gICAgaW5wdXRBcmdzOlxuICAgICAgaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsncnVuJ10pICYmXG4gICAgICAhaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsnLS1mb3JjZSddKSAmJlxuICAgICAgcHJvY2Vzcy5lbnZbJ1RVUkJPX0ZPUkNFJ11cbiAgICAgICAgPyBpbnNlcnRBZnRlckFueU9mKHN0YXRlLmlucHV0QXJncywgWyctLWZvcmNlJ10sIFsncnVuJ10pXG4gICAgICAgIDogc3RhdGUuaW5wdXRBcmdzLFxuICB9KTtcbn1cblxuLyoqXG4gKiBSdW4gb25lIG9mIHRoZSBkZXYgcGlwZWxpbmUgdGFza3MgdXNpbmcgVHVyYm8gZm9yIGEgc2luZ2xlIHBhY2thZ2VcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlKG9wdHM6IHtcbiAgdGFza3M6IFtUYXNrVHlwZXMsIC4uLlRhc2tUeXBlc1tdXTtcbiAgcGFja2FnZURpcj86IHN0cmluZztcbiAgc3Bhd25PcHRzOiBPbWl0PFNwYXduT3B0aW9uc1dpdGhFeHRyYTxTcGF3blJlc3VsdE9wdHM+LCAnY3dkJz47XG59KSB7XG4gIGNvbnN0IHJvb3REaXIgPSBvcHRzLnBhY2thZ2VEaXIgPz8gcHJvY2Vzcy5jd2QoKTtcbiAgY29uc3QgY3dkID0gYXdhaXQgcmVwb3NpdG9yeVJvb3RQYXRoKCk7XG4gIHJldHVybiBhd2FpdCBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAgIHByb2Nlc3MuZXhlY1BhdGgsXG4gICAgY2xpQXJnc1BpcGUoXG4gICAgICBbc2V0U2NyaXB0KGF3YWl0IHR1cmJvQmluUGF0aCgpKSwgaW5oZXJpdFR1cmJvRm9yY2VBcmdGcm9tRW52KCldLFxuICAgICAgW1xuICAgICAgICAncnVuJyxcbiAgICAgICAgLi4ub3B0cy50YXNrcyxcbiAgICAgICAgJy0tZmlsdGVyPScgKyByb290RGlyLnJlcGxhY2UoY3dkLCAnLicpLFxuICAgICAgICAnLS1vdXRwdXQtbG9ncz1uZXctb25seScsXG4gICAgICAgICctLWNvbG9yJyxcbiAgICAgIF1cbiAgICApLFxuICAgIHtcbiAgICAgIC4uLm9wdHMuc3Bhd25PcHRzLFxuICAgICAgY3dkLFxuICAgIH1cbiAgKTtcbn1cbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcbmltcG9ydCB7IGxvYWQgfSBmcm9tICdqcy15YW1sJztcblxuaW1wb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiB0cnlSZWFkaW5nUG5wbVdvcmtzcGFjZVlhbWwobW9ub3JlcG9Sb290OiBzdHJpbmcpIHtcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHJlYWRGaWxlKFxuICAgIGpvaW4obW9ub3JlcG9Sb290LCAncG5wbS13b3Jrc3BhY2UueWFtbCcpLFxuICAgICd1dGYtOCdcbiAgKTtcbiAgY29uc3Qgcm9vdFBhdGggPSBsb2FkKHRleHQpIGFzIHtcbiAgICBwYWNrYWdlcz86IHN0cmluZ1tdO1xuICB9O1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShyb290UGF0aC5wYWNrYWdlcykgJiYgcm9vdFBhdGgucGFja2FnZXMubGVuZ3RoID4gMFxuICAgID8gcm9vdFBhdGgucGFja2FnZXNcbiAgICA6IHVuZGVmaW5lZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdHJ5UmVhZGluZ1BhY2thZ2VKc29uV29ya3NwYWNlcyhtb25vcmVwb1Jvb3Q6IHN0cmluZykge1xuICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVhZEZpbGUoam9pbihtb25vcmVwb1Jvb3QsICdwYWNrYWdlLmpzb24nKSwgJ3V0Zi04Jyk7XG4gIGNvbnN0IHBhY2thZ2VKc29uID0gSlNPTi5wYXJzZSh0ZXh0KSBhcyB7XG4gICAgd29ya3NwYWNlcz86IHN0cmluZ1tdO1xuICB9O1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShwYWNrYWdlSnNvbi53b3Jrc3BhY2VzKSAmJlxuICAgIHBhY2thZ2VKc29uLndvcmtzcGFjZXMubGVuZ3RoID4gMFxuICAgID8gcGFja2FnZUpzb24ud29ya3NwYWNlc1xuICAgIDogdW5kZWZpbmVkO1xufVxuXG5jb25zdCByZWFkUGFja2FnZXNHbG9ic0F0ID0gYXN5bmMgKG1vbm9yZXBvUm9vdDogc3RyaW5nKSA9PiB7XG4gIGNvbnN0IFtwbnBtV29ya3NwYWNlcywgcGFja2FnZUpzb25Xb3Jrc3BhY2VzXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICB0cnlSZWFkaW5nUG5wbVdvcmtzcGFjZVlhbWwobW9ub3JlcG9Sb290KS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpLFxuICAgIHRyeVJlYWRpbmdQYWNrYWdlSnNvbldvcmtzcGFjZXMobW9ub3JlcG9Sb290KS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpLFxuICBdKTtcbiAgcmV0dXJuIHBucG1Xb3Jrc3BhY2VzIHx8IHBhY2thZ2VKc29uV29ya3NwYWNlcyB8fCBbXTtcbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIG1vbm9yZXBvIHBhY2thZ2VzIGdsb2IgYnkgcmVhZGluZyBvbmUgb2YgdGhlIHN1cHBvcnRlZFxuICogZmlsZXNcbiAqXG4gKiBOT1RFOiBvbmx5IHBucG0gaXMgc3VwcG9ydGVkIGF0IHRoZSBtb21lbnRcbiAqL1xuZXhwb3J0IGNvbnN0IHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMgPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290ID0gYXdhaXQgcmVwb3NpdG9yeVJvb3RQYXRoKCk7XG4gIGNvbnN0IHBhY2thZ2VzR2xvYnMgPSBhd2FpdCByZWFkUGFja2FnZXNHbG9ic0F0KHJvb3QpO1xuICByZXR1cm4ge1xuICAgIHJvb3QsXG4gICAgcGFja2FnZXNHbG9icyxcbiAgfTtcbn0pO1xuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCBmZyBmcm9tICdmYXN0LWdsb2InO1xuXG5pbXBvcnQgeyBoYXNUdXJib0pzb24gfSBmcm9tICcuLi90dXJibyc7XG5pbXBvcnQgeyByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzIH0gZnJvbSAnLi9yZWFkUGFja2FnZXNHbG9icyc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24oKSB7XG4gIGNvbnN0IFt7IHJvb3QsIHBhY2thZ2VzR2xvYnMgfSwgaGFzVHVyYm9dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMoKSxcbiAgICBoYXNUdXJib0pzb24oKSxcbiAgXSk7XG4gIGlmIChwYWNrYWdlc0dsb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB7XG4gICAgICByb290LFxuICAgICAgcGFja2FnZXNHbG9icyxcbiAgICAgIHBhY2thZ2VMb2NhdGlvbnM6IFtdLFxuICAgICAgaGFzVHVyYm8sXG4gICAgICB0eXBlOiAnc2luZ2xlLXBhY2thZ2UnIGFzIGNvbnN0LFxuICAgIH07XG4gIH1cbiAgY29uc3QgcGFja2FnZUxvY2F0aW9ucyA9IGF3YWl0IGZnKFxuICAgIHBhY2thZ2VzR2xvYnMubWFwKChnbG9iKSA9PiBgJHtnbG9ifS9wYWNrYWdlLmpzb25gKSxcbiAgICB7XG4gICAgICBjd2Q6IHJvb3QsXG4gICAgfVxuICApO1xuICByZXR1cm4ge1xuICAgIHJvb3QsXG4gICAgcGFja2FnZXNHbG9icyxcbiAgICBwYWNrYWdlTG9jYXRpb25zOiBwYWNrYWdlTG9jYXRpb25zLm1hcCgobG9jYXRpb24pID0+IGRpcm5hbWUobG9jYXRpb24pKSxcbiAgICBoYXNUdXJibyxcbiAgICB0eXBlOiAnbXVsdGlwbGUtcGFja2FnZXMnIGFzIGNvbnN0LFxuICB9O1xufVxuIiwiaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB0eXBlIHsgQ29uZmlnIH0gZnJvbSAnamVzdCc7XG5pbXBvcnQgeyBkZWZhdWx0cyB9IGZyb20gJ2plc3QtY29uZmlnJztcblxuZXhwb3J0IGNvbnN0IGV4dGVuc2lvbnMgPSBbXG4gICdqcycsXG4gICdjanMnLFxuICAnbWpzJyxcbiAgJ2pzeCcsXG4gICd0cycsXG4gICdjdHMnLFxuICAnbXRzJyxcbiAgJ3RzeCcsXG5dO1xuXG5leHBvcnQgY29uc3QgaWdub3JlRGlycyA9IFsnL25vZGVfbW9kdWxlcy8nLCAnL2Rpc3QvJywgJy8udHNjLW91dC8nXTtcblxuZXhwb3J0IGNvbnN0IGplc3RUcmFuc2Zvcm1Db25maWdQcm9wID0gKFxuICBqZXN0UGx1Z2luUm9vdD86IHN0cmluZ1xuKTogUGljazxDb25maWcsICd0cmFuc2Zvcm0nPiA9PiB7XG4gIGNvbnN0IGVzYnVpbGQgPSBqZXN0UGx1Z2luUm9vdFxuICAgID8gam9pbihqZXN0UGx1Z2luUm9vdCwgJ2VzYnVpbGQtamVzdCcpXG4gICAgOiAnZXNidWlsZC1qZXN0JztcblxuICBjb25zdCBlc2J1aWxkRGVmYXVsdE9wdHMgPSB7XG4gICAgdGFyZ2V0OiBgbm9kZSR7cHJvY2Vzcy52ZXJzaW9ucy5ub2RlfWAsXG4gICAgc291cmNlbWFwOiB0cnVlLFxuICB9O1xuXG4gIGNvbnN0IGxvYWRlckJ5RXh0ID0ge1xuICAgIHRzOiB7IGxvYWRlcjogJ3RzJywgZm9ybWF0OiAnZXNtJyB9LFxuICAgIGN0czogeyBsb2FkZXI6ICd0cycsIGZvcm1hdDogJ2NqcycgfSxcbiAgICBtdHM6IHsgbG9hZGVyOiAndHMnLCBmb3JtYXQ6ICdlc20nIH0sXG4gICAgY3RzeDogeyBsb2FkZXI6ICd0c3gnLCBmb3JtYXQ6ICdjanMnIH0sXG4gICAgbXRzeDogeyBsb2FkZXI6ICd0c3gnLCBmb3JtYXQ6ICdlc20nIH0sXG4gICAgdHN4OiB7IGxvYWRlcjogJ3RzeCcsIGZvcm1hdDogJ2VzbScgfSxcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIHRyYW5zZm9ybTogT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgT2JqZWN0LmVudHJpZXMobG9hZGVyQnlFeHQpLm1hcCgoW2V4dCwgb3B0c10pID0+IFtcbiAgICAgICAgYF4uK1xcXFwuJHtleHR9JGAsXG4gICAgICAgIFtcbiAgICAgICAgICBlc2J1aWxkLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIC4uLmVzYnVpbGREZWZhdWx0T3B0cyxcbiAgICAgICAgICAgIGZvcm1hdDogb3B0cy5mb3JtYXQsXG4gICAgICAgICAgICBsb2FkZXJzOiB7XG4gICAgICAgICAgICAgIFtgLiR7ZXh0fWBdOiBvcHRzLmxvYWRlcixcbiAgICAgICAgICAgICAgW2AudGVzdC4ke2V4dH1gXTogb3B0cy5sb2FkZXIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICBdKVxuICAgICksXG4gIH07XG59O1xuXG5leHBvcnQgY29uc3QgY29tbW9uRGVmYXVsdHM6IENvbmZpZyA9IHtcbiAgY2FjaGVEaXJlY3Rvcnk6ICdub2RlX21vZHVsZXMvLmplc3QtY2FjaGUnLFxuICB0ZXN0UGF0aElnbm9yZVBhdHRlcm5zOiBbXG4gICAgLi4uaWdub3JlRGlycy5tYXAoKGRpcikgPT4gYDxyb290RGlyPiR7ZGlyfWApLFxuICAgICc8cm9vdERpcj4vLiovdGVzdC1jYXNlcy8nLFxuICBdLFxuICB0cmFuc2Zvcm1JZ25vcmVQYXR0ZXJuczogWy4uLmlnbm9yZURpcnMubWFwKChkaXIpID0+IGA8cm9vdERpcj4ke2Rpcn1gKV0sXG4gIGNvdmVyYWdlUGF0aElnbm9yZVBhdHRlcm5zOiBbLi4uaWdub3JlRGlycy5tYXAoKGRpcikgPT4gYDxyb290RGlyPiR7ZGlyfWApXSxcbiAgbW9kdWxlUGF0aElnbm9yZVBhdHRlcm5zOiBbLi4uaWdub3JlRGlycy5tYXAoKGRpcikgPT4gYDxyb290RGlyPiR7ZGlyfWApXSxcbiAgbW9kdWxlRmlsZUV4dGVuc2lvbnM6IFtcbiAgICAuLi5uZXcgU2V0KFsuLi5kZWZhdWx0cy5tb2R1bGVGaWxlRXh0ZW5zaW9ucywgLi4uZXh0ZW5zaW9uc10pLFxuICBdLFxuICBleHRlbnNpb25zVG9UcmVhdEFzRXNtOiBbJy5qc3gnLCAnLnRzJywgJy5tdHMnLCAnLnRzeCddLFxuICByb290RGlyOiBwcm9jZXNzLmN3ZCgpLFxufTtcblxuY29uc3QgZmxhdm9yUmVnZXggPSAvXFx3Ky87XG5cbmV4cG9ydCBmdW5jdGlvbiBjdXN0b21GbGF2b3JUZXN0RGVmYXVsdHMoZmxhdm9yOiBzdHJpbmcpOiBDb25maWcge1xuICBpZiAoZmxhdm9yID09PSAndW5pdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZsYXZvciBjYW5ub3QgYmUgdW5pdCcpO1xuICB9XG4gIGlmICghZmxhdm9yUmVnZXgudGVzdChmbGF2b3IpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBGbGF2b3Igc2hvdWxkIG1hdGNoIC8ke2ZsYXZvclJlZ2V4LnNvdXJjZX0vYCk7XG4gIH1cbiAgY29uc3Qgcm9vdHMgPSBbJzxyb290RGlyPicsICc8cm9vdERpcj4vc3JjJ107XG4gIGNvbnN0IGZsYXZvclRlc3RHbG9icyA9IFtgX18ke2ZsYXZvcn1fXy8qKmBdO1xuICBjb25zdCBleHRzID0gZXh0ZW5zaW9ucy5qb2luKCcsJyk7XG4gIGNvbnN0IGZsYXZvclRlc3RNYXRjaCA9IGZsYXZvclRlc3RHbG9ic1xuICAgIC5mbGF0TWFwKChnbG9iKSA9PlxuICAgICAgcm9vdHMubWFwKChyb290KSA9PiBbcm9vdCwgZ2xvYl0uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJy8nKSlcbiAgICApXG4gICAgLm1hcCgoZ2xvYikgPT4gW2dsb2IsIGAqLnRlc3QueyR7ZXh0c319YF0uam9pbignLycpKTtcblxuICByZXR1cm4ge1xuICAgIHRlc3RNYXRjaDogZmxhdm9yVGVzdE1hdGNoLFxuICAgIHRlc3RUaW1lb3V0OiA0NV8wMDAsXG4gICAgc2xvd1Rlc3RUaHJlc2hvbGQ6IDMwXzAwMCxcbiAgICBjb3ZlcmFnZURpcmVjdG9yeTogYG5vZGVfbW9kdWxlcy8uY292ZXJhZ2UtJHtmbGF2b3J9YCxcbiAgICAuLi5jb21tb25EZWZhdWx0cyxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVuaXRUZXN0RGVmYXVsdHMoKTogQ29uZmlnIHtcbiAgY29uc3Qgcm9vdHMgPSBbJzxyb290RGlyPiddO1xuICBjb25zdCB1bml0VGVzdEdsb2JzID0gWycqKi9fX3Rlc3RzX18vKionLCAnKionXTtcbiAgY29uc3QgZXh0cyA9IGV4dGVuc2lvbnMuam9pbignLCcpO1xuICBjb25zdCB1bml0VGVzdE1hdGNoID0gdW5pdFRlc3RHbG9ic1xuICAgIC5mbGF0TWFwKChnbG9iKSA9PlxuICAgICAgcm9vdHMubWFwKChyb290KSA9PiBbcm9vdCwgZ2xvYl0uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJy8nKSlcbiAgICApXG4gICAgLm1hcCgoZ2xvYikgPT4gW2dsb2IsIGAqLnRlc3QueyR7ZXh0c319YF0uam9pbignLycpKTtcblxuICByZXR1cm4ge1xuICAgIHRlc3RNYXRjaDogdW5pdFRlc3RNYXRjaCxcbiAgICBjb3ZlcmFnZURpcmVjdG9yeTogJ25vZGVfbW9kdWxlcy8uY292ZXJhZ2UtdW5pdCcsXG4gICAgLi4uY29tbW9uRGVmYXVsdHMsXG4gICAgdGVzdFBhdGhJZ25vcmVQYXR0ZXJuczogW1xuICAgICAgLi4uKGNvbW1vbkRlZmF1bHRzLnRlc3RQYXRoSWdub3JlUGF0dGVybnMgfHwgW10pLFxuICAgICAgYDxyb290RGlyPi8oPyFfX3Rlc3RzX18pKF9fW2EtekEtWjAtOV0rX18pL2AsXG4gICAgICBgPHJvb3REaXI+L3NyYy8oPyFfX3Rlc3RzX18pKF9fW2EtekEtWjAtOV0rX18pL2AsXG4gICAgXSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgeyBta2Rpciwgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyB0bXBkaXIgfSBmcm9tICdub2RlOm9zJztcbmltcG9ydCB7IGpvaW4sIHJlc29sdmUsIHNlcCB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCBmZyBmcm9tICdmYXN0LWdsb2InO1xuXG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi4vdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZW5lcmF0ZVNjcmlwdChvcHRzOiB7XG4gIHNjcmlwdDogJ3NldHVwJyB8ICd0ZWFyZG93bic7XG4gIGZsYXZvcjogc3RyaW5nO1xuICByb290RGlyOiBzdHJpbmc7XG59KSB7XG4gIGNvbnN0IHsgZmxhdm9yLCBzY3JpcHQsIHJvb3REaXIgfSA9IG9wdHM7XG5cbiAgY29uc3Qgc3RyZWFtID0gZmcuc3RyZWFtKFxuICAgIFtgX18ke2ZsYXZvcn1fXy8ke3NjcmlwdH0udHNgLCBgc3JjL19fJHtmbGF2b3J9X18vJHtzY3JpcHR9LnRzYF0sXG4gICAge1xuICAgICAgY3dkOiByb290RGlyLFxuICAgIH1cbiAgKSBhcyBBc3luY0l0ZXJhYmxlPHN0cmluZz47XG5cbiAgZm9yIGF3YWl0IChjb25zdCBzY3JpcHRMb2Mgb2Ygc3RyZWFtKSB7XG4gICAgaWYgKHNjcmlwdExvYykge1xuICAgICAgY29uc3Qgcm9vdCA9IG1vZHVsZVJvb3REaXJlY3RvcnkoKTtcbiAgICAgIGNvbnN0IGxvY2F0aW9uID0gcmVzb2x2ZShqb2luKHJvb3REaXIsIHNjcmlwdExvYykpO1xuXG4gICAgICBjb25zdCBtb2R1bGVQYXRoID0gKGlucHV0OiBzdHJpbmcpID0+XG4gICAgICAgIHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMidcbiAgICAgICAgICA/IGBmaWxlOi8vJHtpbnB1dC5yZXBsYWNlQWxsKHNlcCwgJy8nKX1gXG4gICAgICAgICAgOiBpbnB1dDtcblxuICAgICAgY29uc3Qgc2NyaXB0ID0gYGltcG9ydCB7IHJ1blRzU2NyaXB0IH0gZnJvbSAke0pTT04uc3RyaW5naWZ5KFxuICAgICAgICBtb2R1bGVQYXRoKGpvaW4ocm9vdCwgJ2NvbmZpZ3MvamVzdC9qZXN0Q29uZmlnSGVscGVycy5nZW4ubWpzJykpXG4gICAgICApfTtcblxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKCkgPT4ge1xuYXdhaXQgcnVuVHNTY3JpcHQoe1xuICBsb2NhdGlvbjogJHtKU09OLnN0cmluZ2lmeShsb2NhdGlvbil9XG59KVxufWA7XG5cbiAgICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKCdzaGExJylcbiAgICAgICAgLnVwZGF0ZShyb290RGlyKVxuICAgICAgICAudXBkYXRlKGZsYXZvcilcbiAgICAgICAgLnVwZGF0ZShzY3JpcHQpXG4gICAgICAgIC5kaWdlc3QoKVxuICAgICAgICAudG9TdHJpbmcoJ2hleCcpO1xuXG4gICAgICBjb25zdCBkaXIgPSBqb2luKHRtcGRpcigpLCAnamVzdC1zY3JpcHRzJyk7XG4gICAgICBjb25zdCBmaWxlID0gam9pbihkaXIsIGAke2hhc2h9Lm1qc2ApO1xuXG4gICAgICBhd2FpdCBta2RpcihkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuXG4gICAgICBhd2FpdCB3cml0ZUZpbGUoZmlsZSwgc2NyaXB0KTtcblxuICAgICAgcmV0dXJuIGZpbGU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cbiIsImltcG9ydCB7IHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGlzRGlyZWN0b3J5KHBhdGg6IHN0cmluZykge1xuICByZXR1cm4gc3RhdChwYXRoKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0RpcmVjdG9yeSgpKVxuICAgIC5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xufVxuIiwiaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG50eXBlIFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzID0ge1xuICBzdGFydDogc3RyaW5nO1xuICBzdG9wcz86IHN0cmluZ1tdO1xuICBhcHBlbmRQYXRoPzogc3RyaW5nO1xuICB0ZXN0OiAocGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPGJvb2xlYW4gfCBzdHJpbmcgfCB1bmRlZmluZWQ+O1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uKiB1cHdhcmREaXJlY3RvcnlXYWxrKG9wdHM6IFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzKSB7XG4gIGxldCBjdXJyZW50ID0gb3B0cy5zdGFydDtcbiAgd2hpbGUgKFxuICAgIGN1cnJlbnQgIT09ICcvJyAmJlxuICAgIGN1cnJlbnQgIT09ICd+LycgJiZcbiAgICAhKG9wdHMuc3RvcHM/LmluY2x1ZGVzKGN1cnJlbnQpID8/IGZhbHNlKVxuICApIHtcbiAgICBjb25zdCBwYXRoID0gb3B0cy5hcHBlbmRQYXRoID8gam9pbihjdXJyZW50LCBvcHRzLmFwcGVuZFBhdGgpIDogY3VycmVudDtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBhd2FpdCBvcHRzLnRlc3QocGF0aCk7XG4gICAgaWYgKGNhbmRpZGF0ZSkge1xuICAgICAgeWllbGQgdHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ3N0cmluZycgPyBjYW5kaWRhdGUgOiBwYXRoO1xuICAgIH1cbiAgICBjdXJyZW50ID0gZGlybmFtZShjdXJyZW50KTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXB3YXJkRGlyZWN0b3J5U2VhcmNoKG9wdHM6IFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzKSB7XG4gIGNvbnN0IHdhbGsgPSB1cHdhcmREaXJlY3RvcnlXYWxrKG9wdHMpO1xuICBmb3IgYXdhaXQgKGNvbnN0IGRpciBvZiB3YWxrKSB7XG4gICAgcmV0dXJuIGRpcjtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IGlzRGlyZWN0b3J5IH0gZnJvbSAnLi9pc0RpcmVjdG9yeSc7XG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi9tb2R1bGVSb290RGlyZWN0b3J5JztcbmltcG9ydCB7IHVwd2FyZERpcmVjdG9yeVNlYXJjaCB9IGZyb20gJy4vdXB3YXJkRGlyZWN0b3J5U2VhcmNoJztcblxuZXhwb3J0IHsgcmVhZFBhY2thZ2VKc29uIH0gZnJvbSAnLi4vcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbic7XG5leHBvcnQgeyBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24gfSBmcm9tICcuL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbic7XG5leHBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3JlcG9zaXRvcnlSb290UGF0aCc7XG5cbmFzeW5jIGZ1bmN0aW9uIGxvb2t1cChvcHRzOiB7IHBhdGg6IHN0cmluZzsgbG9va3VwUGFja2FnZU5hbWU6IHN0cmluZyB9KSB7XG4gIHJldHVybiBhd2FpdCB1cHdhcmREaXJlY3RvcnlTZWFyY2goe1xuICAgIHN0YXJ0OiBtb2R1bGVSb290RGlyZWN0b3J5KCksXG4gICAgYXBwZW5kUGF0aDogam9pbignbm9kZV9tb2R1bGVzJywgb3B0cy5sb29rdXBQYWNrYWdlTmFtZSksXG4gICAgdGVzdDogaXNEaXJlY3RvcnksXG4gIH0pO1xufVxuXG4vKipcbiAqIExvb2t1cCBsb2NhdGlvbiBmb3IgZGV2RGVwZW5kZW5jaWVzIG9mIFwiQHJlcGthLWtpdC90c1wiIC0gdGhpcyBmdW5jdGlvbiB3aWxsXG4gKiBsb29rdXAgZm9yIFwib3B0cy5sb29rdXBQYWNrYWdlTmFtZVwiXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmaW5kRGV2RGVwZW5kZW5jeShvcHRzOiB7IGxvb2t1cFBhY2thZ2VOYW1lOiBzdHJpbmcgfSkge1xuICBjb25zdCBsb29rdXBQYWNrYWdlTmFtZSA9IG9wdHMubG9va3VwUGFja2FnZU5hbWU7XG5cbiAgcmV0dXJuIGF3YWl0IGxvb2t1cCh7XG4gICAgcGF0aDogbW9kdWxlUm9vdERpcmVjdG9yeSgpLFxuICAgIGxvb2t1cFBhY2thZ2VOYW1lLFxuICB9KTtcbn1cbiIsImltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICdAdXRpbHMvdHMnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IGZpbmREZXZEZXBlbmRlbmN5IH0gZnJvbSAnLi4vdXRpbHMvZmluZERldkRlcGVuZGVuY3knO1xuXG5leHBvcnQgY29uc3QgamVzdFBsdWdpblJvb3QgPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBmaW5kRGV2RGVwZW5kZW5jeSh7XG4gICAgbG9va3VwUGFja2FnZU5hbWU6ICdlc2J1aWxkLWplc3QnLFxuICB9KTtcbiAgaWYgKCFyZXN1bHQpIHtcbiAgICBsb2dnZXIud2FybihcbiAgICAgICdKZXN0IHBsdWdpbnMgcm9vdCBjYW5ub3QgYmUgZGV0ZXJtaW5lZC4gRG8geW91IGhhdmUgXCJAcmVwa2Eta2l0L3RzXCIgaW4gZGV2RGVwZW5kZW5jaWVzIGF0IHRoZSBtb25vcmVwbyByb290IG9yIGF0IHRoZSBsb2NhbCBwYWNrYWdlPydcbiAgICApO1xuICB9IGVsc2Uge1xuICAgIGlmIChsb2dnZXIubG9nTGV2ZWwgPT09ICdkZWJ1ZycpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnRm91bmQgamVzdCBwbHVnaW5zIHJvb3QgYXQnLCBkaXJuYW1lKHJlc3VsdCkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0ID8gZGlybmFtZShyZXN1bHQpIDogJy4nO1xufSk7XG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBDb25maWcgfSBmcm9tICdqZXN0JztcbmltcG9ydCB7IHJlYWRJbml0aWFsT3B0aW9ucyB9IGZyb20gJ2plc3QtY29uZmlnJztcblxuaW1wb3J0IHsgcmVhZFBhY2thZ2VKc29uIH0gZnJvbSAnLi4vcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbic7XG5pbXBvcnQgeyBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24gfSBmcm9tICcuLi91dGlscy9sb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24nO1xuaW1wb3J0IHtcbiAgY3VzdG9tRmxhdm9yVGVzdERlZmF1bHRzLFxuICBqZXN0VHJhbnNmb3JtQ29uZmlnUHJvcCxcbiAgdW5pdFRlc3REZWZhdWx0cyxcbn0gZnJvbSAnLi9jb25maWdCdWlsZGluZ0Jsb2Nrcyc7XG5pbXBvcnQgeyBnZW5lcmF0ZVNjcmlwdCB9IGZyb20gJy4vZ2VuZXJhdGVTY3JpcHQnO1xuaW1wb3J0IHsgamVzdFBsdWdpblJvb3QgfSBmcm9tICcuL2plc3RQbHVnaW5Sb290JztcblxuZXhwb3J0IHR5cGUgVGVzdEZsYXZvciA9XG4gIHwgJ3VuaXQnXG4gIHwgJ2ludGVncmF0aW9uJ1xuICB8IChzdHJpbmcgJiB7XG4gICAgICAkJGN1c3RvbTogbmV2ZXI7XG4gICAgfSk7XG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNvbmZpZyhcbiAgZmxhdm9yOiBUZXN0Rmxhdm9yLFxuICByb290RGlyOiBzdHJpbmcsXG4gIHBhcmVudFJvb3REaXI/OiBzdHJpbmdcbikge1xuICBjb25zdCBwbHVnaW5Sb290ID0gamVzdFBsdWdpblJvb3QoKTtcblxuICBjb25zdCBiYXNlQ29uZmlnID1cbiAgICBmbGF2b3IgPT09ICd1bml0JyA/IHVuaXRUZXN0RGVmYXVsdHMoKSA6IGN1c3RvbUZsYXZvclRlc3REZWZhdWx0cyhmbGF2b3IpO1xuXG4gIGNvbnN0IGdsb2JhbFNldHVwID0gZ2VuZXJhdGVTY3JpcHQoe1xuICAgIHNjcmlwdDogJ3NldHVwJyxcbiAgICBmbGF2b3IsXG4gICAgcm9vdERpcixcbiAgfSk7XG5cbiAgY29uc3QgZ2xvYmFsVGVhcmRvd24gPSBnZW5lcmF0ZVNjcmlwdCh7XG4gICAgc2NyaXB0OiAndGVhcmRvd24nLFxuICAgIGZsYXZvcixcbiAgICByb290RGlyLFxuICB9KTtcblxuICBwcm9jZXNzLmVudlsnVEVTVF9GTEFWT1InXSA9IGZsYXZvcjtcblxuICBjb25zdCBqZXN0Q29uZmlnID0gcmVhZEluaXRpYWxPcHRpb25zKHVuZGVmaW5lZCwge1xuICAgIHBhY2thZ2VSb290T3JDb25maWc6IHJvb3REaXIsXG4gICAgcGFyZW50Q29uZmlnRGlybmFtZTogcGFyZW50Um9vdERpcixcbiAgICByZWFkRnJvbUN3ZDogZmFsc2UsXG4gICAgc2tpcE11bHRpcGxlQ29uZmlnRXJyb3I6IHRydWUsXG4gIH0pO1xuXG4gIGNvbnN0IHJlc29sdmVkQ29uZmlnID0gKGF3YWl0IGplc3RDb25maWcpLmNvbmZpZztcblxuICBjb25zdCBjb25maWcgPSB7XG4gICAgLi4uYmFzZUNvbmZpZyxcbiAgICAuLi5qZXN0VHJhbnNmb3JtQ29uZmlnUHJvcChhd2FpdCBwbHVnaW5Sb290KSxcbiAgICAuLi5yZXNvbHZlZENvbmZpZyxcbiAgICBnbG9iYWxTZXR1cDogYXdhaXQgZ2xvYmFsU2V0dXAsXG4gICAgZ2xvYmFsVGVhcmRvd246IGF3YWl0IGdsb2JhbFRlYXJkb3duLFxuICB9O1xuXG4gIHJldHVybiBjb25maWc7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVKZXN0Q29uZmlnRm9yU2luZ2xlUGFja2FnZSh7XG4gIGZsYXZvciA9ICd1bml0JyxcbiAgcm9vdERpciA9IHByb2Nlc3MuY3dkKCksXG59OiB7XG4gIGZsYXZvcjogVGVzdEZsYXZvcjtcbiAgcm9vdERpcj86IHN0cmluZztcbn0pOiBQcm9taXNlPENvbmZpZz4ge1xuICByZXR1cm4gYXdhaXQgY3JlYXRlQ29uZmlnKGZsYXZvciwgcm9vdERpcik7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVKZXN0Q29uZmlnRm9yTW9ub3JlcG8oe1xuICBmbGF2b3IgPSAndW5pdCcsXG4gIGN3ZCA9IHByb2Nlc3MuY3dkKCksXG59OiB7XG4gIGZsYXZvcjogVGVzdEZsYXZvcjtcbiAgY3dkOiBzdHJpbmc7XG59KTogUHJvbWlzZTxDb25maWc+IHtcbiAgY29uc3QgcmVwb0NvbmZpZyA9IGF3YWl0IGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbigpO1xuXG4gIGlmIChyZXBvQ29uZmlnLnR5cGUgPT09ICdzaW5nbGUtcGFja2FnZScpIHtcbiAgICByZXR1cm4gY3JlYXRlSmVzdENvbmZpZ0ZvclNpbmdsZVBhY2thZ2Uoe1xuICAgICAgZmxhdm9yLFxuICAgICAgcm9vdERpcjogcmVwb0NvbmZpZy5yb290LFxuICAgIH0pO1xuICB9XG5cbiAgaWYgKHJlcG9Db25maWcucm9vdCAhPT0gY3dkKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUplc3RDb25maWdGb3JTaW5nbGVQYWNrYWdlKHsgZmxhdm9yLCByb290RGlyOiBjd2QgfSk7XG4gIH1cblxuICBjb25zdCBwcm9qZWN0cyA9IChcbiAgICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgIHJlcG9Db25maWcucGFja2FnZUxvY2F0aW9ucy5tYXAoYXN5bmMgKGxvY2F0aW9uKSA9PiB7XG4gICAgICAgIGNvbnN0IGJhc2VDb25maWcgPSBjcmVhdGVDb25maWcoZmxhdm9yLCBsb2NhdGlvbiwgY3dkKTtcbiAgICAgICAgY29uc3QgcGFja2FnZUpzb24gPSByZWFkUGFja2FnZUpzb24oam9pbihsb2NhdGlvbiwgJ3BhY2thZ2UuanNvbicpKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAuLi4oYXdhaXQgYmFzZUNvbmZpZyksXG4gICAgICAgICAgcm9vdERpcjogbG9jYXRpb24sXG4gICAgICAgICAgZGlzcGxheU5hbWU6IChhd2FpdCBwYWNrYWdlSnNvbikubmFtZSxcbiAgICAgICAgfTtcbiAgICAgIH0pXG4gICAgKVxuICApLmZpbHRlcihCb29sZWFuKTtcblxuICBjb25zdCB0ZXN0VGltZW91dCA9IHByb2plY3RzLnJlZHVjZShcbiAgICAoYWNjLCBwcm9qZWN0KSA9PlxuICAgICAgTWF0aC5tYXgoXG4gICAgICAgIGFjYyxcbiAgICAgICAgdHlwZW9mIHByb2plY3QudGVzdFRpbWVvdXQgPT09ICdudW1iZXInID8gcHJvamVjdC50ZXN0VGltZW91dCA6IDBcbiAgICAgICksXG4gICAgMFxuICApO1xuXG4gIHJldHVybiB7XG4gICAgLi4uKHRlc3RUaW1lb3V0ICE9PSAwICYmIHtcbiAgICAgIHRlc3RUaW1lb3V0LFxuICAgIH0pLFxuICAgIHByb2plY3RzOiBwcm9qZWN0cy5tYXAoXG4gICAgICAoeyBjb3ZlcmFnZURpcmVjdG9yeSwgdGVzdFRpbWVvdXQsIC4uLnByb2plY3QgfSkgPT4gcHJvamVjdFxuICAgICksXG4gIH07XG59XG4iXSwibmFtZXMiOlsicGF0aCIsInJlc3VsdCIsInNjcmlwdCIsInRlc3RUaW1lb3V0Il0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7O0FBQ08sU0FBUyxhQUFhLEdBQXFCLEVBQUE7QUFDaEQsRUFBTyxPQUFBLEdBQUEsQ0FBSSxPQUFRLENBQUEscUJBQUEsRUFBdUIsTUFBTSxDQUFBLENBQUE7QUFDbEQ7O0FDSE8sU0FBUyxTQUNkLEtBQ3lCLEVBQUE7QUFDekIsRUFBQSxPQUFPLFFBQVEsS0FBSyxDQUFBLENBQUE7QUFDdEI7O0FDSk8sU0FBUyxLQUFRLEVBQXNCLEVBQUE7QUFDNUMsRUFBSSxJQUFBLEtBQUEsQ0FBQTtBQUNKLEVBQUEsSUFBSSxVQUFhLEdBQUEsS0FBQSxDQUFBO0FBQ2pCLEVBQUEsT0FBTyxNQUFTO0FBQ2QsSUFBQSxJQUFJLFVBQVksRUFBQTtBQUNkLE1BQU8sT0FBQSxLQUFBLENBQUE7QUFBQSxLQUNUO0FBQ0EsSUFBQSxLQUFBLEdBQVEsRUFBRyxFQUFBLENBQUE7QUFDWCxJQUFhLFVBQUEsR0FBQSxJQUFBLENBQUE7QUFDYixJQUFPLE9BQUEsS0FBQSxDQUFBO0FBQUEsR0FDVCxDQUFBO0FBQ0Y7O0FDWE8sU0FBUyxVQUFhLEVBQTRDLEVBQUE7QUFDdkUsRUFBSSxJQUFBLEtBQUEsQ0FBQTtBQUNKLEVBQUksSUFBQSxRQUFBLENBQUE7QUFDSixFQUFBLElBQUksVUFBYSxHQUFBLEtBQUEsQ0FBQTtBQUNqQixFQUFBLE9BQU8sWUFBd0I7QUFDN0IsSUFBQSxJQUFJLFVBQVksRUFBQTtBQUNkLE1BQU8sT0FBQSxLQUFBLENBQUE7QUFBQSxLQUNUO0FBQ0EsSUFBQSxJQUFJLFFBQVUsRUFBQTtBQUNaLE1BQU8sT0FBQSxRQUFBLENBQUE7QUFBQSxLQUNUO0FBQ0EsSUFBVyxRQUFBLEdBQUEsT0FBQSxDQUFRLE9BQVEsQ0FBQSxFQUFBLEVBQUksQ0FBQSxDQUFBO0FBQy9CLElBQUEsS0FBQSxHQUFRLE1BQU0sUUFBQSxD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
