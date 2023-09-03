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
    return fileURLToPath(new URL(`../`, opts.importMetaUrl));
  }
  return fileURLToPath(new URL(`../../`, opts.importMetaUrl));
};
const moduleRootDirectory = once(
  () => getModuleRootDirectoryForImportMetaUrl({ importMetaUrl: import.meta.url })
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
  const useShortcut = opts.useShortcut ?? process.platform !== "win32";
  const root = moduleRootDirectory();
  if (useShortcut) {
    const bestGuess = join(root, "node_modules", ".bin", opts.binName);
    if (await isFile(bestGuess)) {
      return bestGuess;
    }
  }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL2VzY2FwZVJlZ0V4cC50cyIsIi4uLy4uLy4uLy4uL3V0aWxzL3RzL3NyYy9pc1RydXRoeS50cyIsIi4uLy4uLy4uLy4uL3V0aWxzL3RzL3NyYy9vbmNlLnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL29uY2VBc3luYy50cyIsIi4uLy4uL3NyYy9sb2dnZXIvbG9nZ2VyLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3N0YWNrVHJhY2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blRvUHJvbWlzZS50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduUmVzdWx0LnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25PdXRwdXQudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeS50cyIsIi4uLy4uL3NyYy91dGlscy9iaW5QYXRoLnRzIiwiLi4vLi4vc3JjL3J1blRzU2NyaXB0LnRzIiwiLi4vLi4vc3JjL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24udHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoLnRzIiwiLi4vLi4vc3JjL3R1cmJvLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy9qZXN0L2NvbmZpZ0J1aWxkaW5nQmxvY2tzLnRzIiwiLi4vLi4vc3JjL2plc3QvZ2VuZXJhdGVTY3JpcHQudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNEaXJlY3RvcnkudHMiLCIuLi8uLi9zcmMvdXRpbHMvdXB3YXJkRGlyZWN0b3J5U2VhcmNoLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2ZpbmREZXZEZXBlbmRlbmN5LnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdFBsdWdpblJvb3QudHMiLCIuLi8uLi9zcmMvamVzdC9jcmVhdGVKZXN0Q29uZmlnLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIGh0dHBzOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzM0NDYxNzAvZXNjYXBlLXN0cmluZy1mb3ItdXNlLWluLWphdmFzY3JpcHQtcmVnZXhcclxuZXhwb3J0IGZ1bmN0aW9uIGVzY2FwZVJlZ0V4cChzdHI6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xyXG59XHJcbiIsImV4cG9ydCBmdW5jdGlvbiBpc1RydXRoeTxUPihcclxuICB2YWx1ZTogTm9uTnVsbGFibGU8VD4gfCBmYWxzZSB8IG51bGwgfCB1bmRlZmluZWQgfCAnJyB8IDBcclxuKTogdmFsdWUgaXMgTm9uTnVsbGFibGU8VD4ge1xyXG4gIHJldHVybiBCb29sZWFuKHZhbHVlKTtcclxufVxyXG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZTxUPihmbjogKCkgPT4gVCk6ICgpID0+IFQge1xyXG4gIGxldCB2YWx1ZTogVDtcclxuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xyXG4gIHJldHVybiAoKTogVCA9PiB7XHJcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xyXG4gICAgICByZXR1cm4gdmFsdWU7XHJcbiAgICB9XHJcbiAgICB2YWx1ZSA9IGZuKCk7XHJcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcclxuICAgIHJldHVybiB2YWx1ZTtcclxuICB9O1xyXG59XHJcbiIsImV4cG9ydCBmdW5jdGlvbiBvbmNlQXN5bmM8VD4oZm46ICgpID0+IFQgfCBQcm9taXNlPFQ+KTogKCkgPT4gUHJvbWlzZTxUPiB7XHJcbiAgbGV0IHZhbHVlOiBUO1xyXG4gIGxldCBpbkZsaWdodDogUHJvbWlzZTxUPiB8IG51bGw7XHJcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcclxuICByZXR1cm4gYXN5bmMgKCk6IFByb21pc2U8VD4gPT4ge1xyXG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcclxuICAgICAgcmV0dXJuIHZhbHVlO1xyXG4gICAgfVxyXG4gICAgaWYgKGluRmxpZ2h0KSB7XHJcbiAgICAgIHJldHVybiBpbkZsaWdodDtcclxuICAgIH1cclxuICAgIGluRmxpZ2h0ID0gUHJvbWlzZS5yZXNvbHZlKGZuKCkpO1xyXG4gICAgdmFsdWUgPSBhd2FpdCBpbkZsaWdodDtcclxuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xyXG4gICAgaW5GbGlnaHQgPSBudWxsO1xyXG4gICAgcmV0dXJuIHZhbHVlO1xyXG4gIH07XHJcbn1cclxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XHJcblxyXG5jb25zdCBsZXZlbHMgPSBbJ2RlYnVnJywgJ2luZm8nLCAnd2FybicsICdlcnJvcicsICdmYXRhbCddIGFzIGNvbnN0O1xyXG5cclxudHlwZSBMb2dMZXZlbCA9IHR5cGVvZiBsZXZlbHNbbnVtYmVyXTtcclxuXHJcbnR5cGUgUGFyYW1zID0gUGFyYW1ldGVyczx0eXBlb2YgY29uc29sZS5sb2c+O1xyXG5cclxudHlwZSBMb2dnZXIgPSB7XHJcbiAgbG9nTGV2ZWw6IExvZ0xldmVsO1xyXG4gIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcclxuICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcclxuICAvLyBhbGlhcyBmb3IgaW5mb1xyXG4gIGxvZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XHJcbiAgLy8gc3BlY2lhbCB0cmVhdG1lbnQsIGRpc2FibGVkIG9uIENJL1RUWVxyXG4gIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XHJcbiAgd2FybiguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XHJcbiAgZXJyb3IoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xyXG4gIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcclxufTtcclxuXHJcbmNvbnN0IGVuYWJsZWRMZXZlbHNBZnRlciA9IChsZXZlbDogTG9nTGV2ZWwgfCAnb2ZmJykgPT4ge1xyXG4gIGlmIChsZXZlbCA9PT0gJ29mZicpIHtcclxuICAgIHJldHVybiBbXTtcclxuICB9XHJcbiAgY29uc3QgaW5kZXggPSBsZXZlbHMuZmluZEluZGV4KChpdGVtKSA9PiBpdGVtID09PSBsZXZlbCk7XHJcbiAgaWYgKGluZGV4ID09PSAtMSkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxldmVsJyk7XHJcbiAgfVxyXG4gIHJldHVybiBsZXZlbHMuc2xpY2UoaW5kZXgpO1xyXG59O1xyXG5cclxuY29uc3QgaXNMZXZlbCA9IChsZXZlbD86IHN0cmluZyk6IGxldmVsIGlzIExvZ0xldmVsID0+IHtcclxuICByZXR1cm4gbGV2ZWxzLmluY2x1ZGVzKGxldmVsIGFzIExvZ0xldmVsKTtcclxufTtcclxuXHJcbmNvbnN0IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncyA9IChcclxuICBhcmdzID0gcHJvY2Vzcy5hcmd2XHJcbik6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xyXG4gIGNvbnN0IGluZGV4ID0gYXJncy5maW5kSW5kZXgoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gJy0tbG9nLWxldmVsJyk7XHJcbiAgaWYgKGluZGV4ID09PSAtMSkge1xyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICB9XHJcbiAgY29uc3QgbGV2ZWwgPSBhcmdzW2luZGV4ICsgMV07XHJcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcclxuICAgIHJldHVybiAnb2ZmJztcclxuICB9XHJcbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICB9XHJcbiAgcmV0dXJuIGxldmVsO1xyXG59O1xyXG5cclxuY29uc3QgdmVyYm9zaXR5RnJvbUVudiA9ICgpOiBMb2dMZXZlbCB8ICdvZmYnIHwgdW5kZWZpbmVkID0+IHtcclxuICBjb25zdCBsZXZlbCA9IHByb2Nlc3MuZW52WydMT0dfTEVWRUwnXTtcclxuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xyXG4gICAgcmV0dXJuICdvZmYnO1xyXG4gIH1cclxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gIH1cclxuICByZXR1cm4gbGV2ZWw7XHJcbn07XHJcblxyXG5jb25zdCBnZXRWZXJib3NpdHlDb25maWcgPSAoKSA9PiB7XHJcbiAgY29uc3QgYXJnc0xldmVsID0gdmVyYm9zaXR5RnJvbVByb2Nlc3NBcmdzKCk7XHJcbiAgY29uc3QgZW52TGV2ZWwgPSB2ZXJib3NpdHlGcm9tRW52KCk7XHJcbiAgcmV0dXJuIGFyZ3NMZXZlbCA/PyBlbnZMZXZlbCA/PyAnaW5mbyc7XHJcbn07XHJcblxyXG5jb25zdCBub29wID0gKC4uLl9hcmdzOiBQYXJhbXMpID0+IHtcclxuICByZXR1cm47XHJcbn07XHJcblxyXG5jb25zdCBsb2cgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XHJcbiAgY29uc29sZS5sb2coLi4uYXJncyk7XHJcbn07XHJcblxyXG5jb25zdCBlcnJvciA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcclxuICBjb25zb2xlLmVycm9yKC4uLmFyZ3MpO1xyXG59O1xyXG5cclxuY29uc3Qgc2hvdWxkRW5hYmxlVGlwID0gKCkgPT4gIXByb2Nlc3MuZW52WydDSSddICYmICFwcm9jZXNzLnN0ZG91dC5pc1RUWTtcclxuXHJcbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoXHJcbiAgZGVwcyA9IHsgZ2V0VmVyYm9zaXR5Q29uZmlnLCBsb2csIGVycm9yLCBzaG91bGRFbmFibGVUaXAgfVxyXG4pID0+IHtcclxuICBjb25zdCBsb2dMZXZlbCA9IGRlcHMuZ2V0VmVyYm9zaXR5Q29uZmlnKCk7XHJcbiAgY29uc3QgZW5hYmxlZCA9IGVuYWJsZWRMZXZlbHNBZnRlcihsb2dMZXZlbCk7XHJcbiAgcmV0dXJuIGxldmVscy5yZWR1Y2UoXHJcbiAgICAoYWNjLCBsdmwpID0+IHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICAuLi5hY2MsXHJcbiAgICAgICAgW2x2bF06IGVuYWJsZWQuaW5jbHVkZXMobHZsKVxyXG4gICAgICAgICAgPyBbJ2ZhdGFsJywgJ2Vycm9yJ10uaW5jbHVkZXMobHZsKVxyXG4gICAgICAgICAgICA/IGRlcHMuZXJyb3JcclxuICAgICAgICAgICAgOiBkZXBzLmxvZ1xyXG4gICAgICAgICAgOiBub29wLFxyXG4gICAgICB9O1xyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgbG9nTGV2ZWwsXHJcbiAgICAgIGxvZzogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpID8gZGVwcy5sb2cgOiBub29wLFxyXG4gICAgICB0aXA6IGVuYWJsZWQuaW5jbHVkZXMoJ2luZm8nKSAmJiBkZXBzLnNob3VsZEVuYWJsZVRpcCgpID8gZGVwcy5sb2cgOiBub29wLFxyXG4gICAgfSBhcyBMb2dnZXJcclxuICApO1xyXG59O1xyXG5cclxuY29uc3QgY3JlYXRlRGVsZWdhdGluZ0xvZ2dlciA9IChvcHRzOiB7IHBhcmVudDogTG9nZ2VyIH0pOiBMb2dnZXIgPT5cclxuICBPYmplY3QuZnJlZXplKHtcclxuICAgIGdldCBsb2dMZXZlbCgpIHtcclxuICAgICAgcmV0dXJuIG9wdHMucGFyZW50LmxvZ0xldmVsO1xyXG4gICAgfSxcclxuICAgIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XHJcbiAgICAgIG9wdHMucGFyZW50LmRlYnVnKC4uLnBhcmFtcyk7XHJcbiAgICB9LFxyXG4gICAgaW5mbyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xyXG4gICAgICBvcHRzLnBhcmVudC5pbmZvKC4uLnBhcmFtcyk7XHJcbiAgICB9LFxyXG4gICAgbG9nKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XHJcbiAgICAgIG9wdHMucGFyZW50LmxvZyguLi5wYXJhbXMpO1xyXG4gICAgfSxcclxuICAgIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xyXG4gICAgICBvcHRzLnBhcmVudC50aXAoLi4ucGFyYW1zKTtcclxuICAgIH0sXHJcbiAgICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XHJcbiAgICAgIG9wdHMucGFyZW50Lndhcm4oLi4ucGFyYW1zKTtcclxuICAgIH0sXHJcbiAgICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xyXG4gICAgICBvcHRzLnBhcmVudC5lcnJvciguLi5wYXJhbXMpO1xyXG4gICAgfSxcclxuICAgIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XHJcbiAgICAgIG9wdHMucGFyZW50LmZhdGFsKC4uLnBhcmFtcyk7XHJcbiAgICB9LFxyXG4gIH0pO1xyXG5cclxubGV0IGRlZmF1bHRMb2dnZXJGYWN0b3J5OiAoKCkgPT4gTG9nZ2VyKSB8IG51bGw7XHJcblxyXG5leHBvcnQgY29uc3QgY29uZmlndXJlRGVmYXVsdExvZ2dlciA9IChmYWN0b3J5OiAoKSA9PiBMb2dnZXIpID0+IHtcclxuICBpZiAoZGVmYXVsdExvZ2dlckZhY3RvcnkpIHtcclxuICAgIGNvbnN0IGVycm9yID0ge1xyXG4gICAgICBzdGFjazogJycsXHJcbiAgICB9O1xyXG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UoZXJyb3IpO1xyXG4gICAgbG9nZ2VyLmRlYnVnKCdDYW5ub3Qgb3ZlcnJpZGUgZGVmYXVsdCBsb2dnZXIgbXVsdGlwbGUgdGltZXMnLCBlcnJvci5zdGFjayk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGRlZmF1bHRMb2dnZXJGYWN0b3J5ID0gZmFjdG9yeTtcclxufTtcclxuXHJcbmNvbnN0IGRlZmF1bHRMb2dnZXIgPSBvbmNlKCgpID0+IHtcclxuICBsZXQgZmFjdG9yeSA9IGRlZmF1bHRMb2dnZXJGYWN0b3J5O1xyXG4gIGlmICghZmFjdG9yeSkge1xyXG4gICAgZmFjdG9yeSA9ICgpID0+IGNyZWF0ZUxvZ2dlcigpO1xyXG4gIH1cclxuICByZXR1cm4gZmFjdG9yeSgpO1xyXG59KTtcclxuXHJcbi8qKlxyXG4gKiBEZWZhdWx0IGxvZ2dlciBpbnN0YW5jZSBjYW4gYmUgY29uZmlndXJlZCBvbmNlIGF0IHN0YXJ0dXBcclxuICovXHJcbmV4cG9ydCBjb25zdCBsb2dnZXI6IExvZ2dlciA9IGNyZWF0ZURlbGVnYXRpbmdMb2dnZXIoe1xyXG4gIGdldCBwYXJlbnQoKSB7XHJcbiAgICByZXR1cm4gZGVmYXVsdExvZ2dlcigpO1xyXG4gIH0sXHJcbn0pO1xyXG4iLCIvKipcclxuICogQ2FwdHVyZSB0aGUgc3RhY2sgdHJhY2UgYW5kIGFsbG93IHRvIGVucmljaCBleGNlcHRpb25zIHRocm93biBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2tzXHJcbiAqIHdpdGggYWRkaXRpb25hbCBzdGFjayBpbmZvcm1hdGlvbiBjYXB0dXJlZCBhdCB0aGUgbW9tZW50IG9mIHRoZSBjYWxsIG9mIHRoaXMgZnVuY3Rpb25cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjYXB0dXJlU3RhY2tUcmFjZShyZW1vdmUgPSAwKSB7XHJcbiAgY29uc3Qgc3RhY2tDb250YWluZXIgPSB7XHJcbiAgICBzdGFjazogJycsXHJcbiAgfTtcclxuICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShzdGFja0NvbnRhaW5lcik7XHJcbiAgY29uc3Qgc3RhY2tUcmFjZSA9IHN0YWNrQ29udGFpbmVyLnN0YWNrXHJcbiAgICAuc3BsaXQoJ1xcbicpXHJcbiAgICAuc2xpY2UoNiArIHJlbW92ZSlcclxuICAgIC5qb2luKCdcXG4nKTtcclxuICByZXR1cm4ge1xyXG4gICAgLyoqXHJcbiAgICAgKiBDYXB0dXJlZCBzdGFjayB0cmFjZSBpbmZvcm1hdGlvblxyXG4gICAgICovXHJcbiAgICBzdGFja1RyYWNlLFxyXG4gICAgLyoqXHJcbiAgICAgKiBDYW4gYmUgY2FsbGVkIGluIGFzeW5jaHJvbm91cyBjYWxsYmFjayB0byBlbnJpY2ggZXhjZXB0aW9ucyB3aXRoIGFkZGl0aW9uYWwgaW5mb3JtYXRpb25cclxuICAgICAqIEBwYXJhbSBlcnIgRXhjZXB0aW9uIHRvIGVucmljaCAtIGl0IGlzIGdvaW5nIHRvIGhhdmUgaXRzIGAuc3RhY2tgIHByb3AgbXV0YXRlZFxyXG4gICAgICogQHJldHVybnMgU2FtZSBleGNlcHRpb25cclxuICAgICAqL1xyXG4gICAgcHJlcGFyZUZvclJldGhyb3c6IChlcnI6IEVycm9yKSA9PiB7XHJcbiAgICAgIGNvbnN0IG9sZFN0YWNrVHJhY2UgPSBlcnIuc3RhY2sgPz8gJycuc3BsaXQoJ1xcbicpLnNsaWNlKDEpLmpvaW4oJ1xcbicpO1xyXG4gICAgICBlcnIuc3RhY2sgPSBgJHtlcnIubmFtZSB8fCAnRXJyb3InfTogJHtcclxuICAgICAgICBlcnIubWVzc2FnZVxyXG4gICAgICB9XFxuJHtvbGRTdGFja1RyYWNlfVxcbiR7c3RhY2tUcmFjZX1gO1xyXG4gICAgICByZXR1cm4gZXJyO1xyXG4gICAgfSxcclxuICB9O1xyXG59XHJcbiIsImltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XHJcbmltcG9ydCB7IENoaWxkUHJvY2VzcyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xyXG5pbXBvcnQgeyBzcGF3biB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xyXG5pbXBvcnQgdHlwZSB7IEFzc2lnbiB9IGZyb20gJ3V0aWxpdHktdHlwZXMnO1xyXG5cclxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XHJcbmltcG9ydCB7IGNhcHR1cmVTdGFja1RyYWNlIH0gZnJvbSAnLi4vdXRpbHMvc3RhY2tUcmFjZSc7XHJcblxyXG5leHBvcnQgdHlwZSBTcGF3blRvUHJvbWlzZU9wdHMgPSB7XHJcbiAgLyoqXHJcbiAgICogU3BlY2lmeSBleGl0IGNvZGVzIHdoaWNoIHNob3VsZCBub3QgcmVzdWx0IGluIHRocm93aW5nIGFuIGVycm9yIHdoZW5cclxuICAgKiB0aGUgcHJvY2VzcyBoYXMgZmluaXNoZWQsIGUuZy4gc3BlY2lmeWluZyBgWzBdYCBtZWFucyBpZiBwcm9jZXNzIGZpbmlzaGVkXHJcbiAgICogd2l0aCB6ZXJvIGV4aXQgY29kZSB0aGVuIHRoZSBwcm9taXNlIHdpbGwgcmVzb2x2ZSBpbnN0ZWFkIG9mIHJlamVjdGluZy5cclxuICAgKlxyXG4gICAqIEFsdGVybmF0aXZlbHksIHNwZWNpZnkgYGluaGVyaXRgIHRvIHNhdmUgc3RhdHVzIGNvZGUgdG8gdGhlIGN1cnJlbnQgYHByb2Nlc3MuZXhpdENvZGVgXHJcbiAgICpcclxuICAgKiBBbHRlcm5hdGl2ZWx5LCBjb21wbGV0ZWx5IGlnbm9yZSB0aGUgZXhpdCBjb2RlIChlLmcuIHlvdSBmb2xsb3cgdXAgYW5kIGludGVycm9nYXRlXHJcbiAgICogdGhlIHByb2Nlc3MgY29kZSBtYW51YWxseSBhZnRlcndhcmRzKVxyXG4gICAqL1xyXG4gIGV4aXRDb2RlczogbnVtYmVyW10gfCAnaW5oZXJpdCcgfCAnYW55JztcclxufTtcclxuXHJcbnR5cGUgU2hhcmVkT3B0cyA9IFBpY2s8U3Bhd25PcHRpb25zLCAnY3dkJz47XHJcblxyXG50eXBlIFNwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PiA9IFtcclxuICBjb21tYW5kOiBzdHJpbmcsXHJcbiAgYXJnczogUmVhZG9ubHlBcnJheTxzdHJpbmc+LFxyXG4gIG9wdGlvbnM6IEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+XHJcbl07XHJcblxyXG5leHBvcnQgdHlwZSBTcGF3bk9wdGlvbnNXaXRoRXh0cmE8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxyXG4gIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+O1xyXG5cclxuZXhwb3J0IHR5cGUgU3Bhd25QYXJhbWV0ZXJNaXg8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxyXG4gIHwgW2NwOiBDaGlsZFByb2Nlc3MsIGV4dHJhT3B0czogQXNzaWduPEUsIFNoYXJlZE9wdHM+XVxyXG4gIHwgU3Bhd25BcmdzPEU+O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzU3Bhd25BcmdzPEUgZXh0ZW5kcyBvYmplY3Q+KFxyXG4gIGFyZ3M6IFNwYXduUGFyYW1ldGVyTWl4PEU+XHJcbik6IGFyZ3MgaXMgU3Bhd25BcmdzPEU+IHtcclxuICByZXR1cm4gIShhcmdzWzBdIGluc3RhbmNlb2YgQ2hpbGRQcm9jZXNzKSAmJiB0eXBlb2YgYXJnc1swXSA9PT0gJ3N0cmluZyc7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnM8RSBleHRlbmRzIG9iamVjdD4oXHJcbiAgcGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cclxuKSB7XHJcbiAgY29uc3QgW2NoaWxkLCBbY29tbWFuZCwgYXJncywgb3B0c11dID0gaXNTcGF3bkFyZ3MocGFyYW1ldGVycylcclxuICAgID8gW1xyXG4gICAgICAgIHNwYXduKC4uLihwYXJhbWV0ZXJzIGFzIHVua25vd24gYXMgUGFyYW1ldGVyczx0eXBlb2Ygc3Bhd24+KSksXHJcbiAgICAgICAgcGFyYW1ldGVycyxcclxuICAgICAgXVxyXG4gICAgOiBbXHJcbiAgICAgICAgcGFyYW1ldGVyc1swXSxcclxuICAgICAgICBbXHJcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduZmlsZSxcclxuICAgICAgICAgIHBhcmFtZXRlcnNbMF0uc3Bhd25hcmdzLnNsaWNlKDEpLFxyXG4gICAgICAgICAgcGFyYW1ldGVyc1sxXSBhcyBBc3NpZ248U3Bhd25PcHRpb25zLCBFPixcclxuICAgICAgICBdLFxyXG4gICAgICBdO1xyXG4gIHJldHVybiB7XHJcbiAgICBjaGlsZCxcclxuICAgIGNvbW1hbmQsXHJcbiAgICBhcmdzLFxyXG4gICAgb3B0cyxcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25Ub1Byb21pc2UoXHJcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXhcclxuKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgeyBjaGlsZCwgY29tbWFuZCwgYXJncywgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xyXG4gIGNvbnN0IHsgcHJlcGFyZUZvclJldGhyb3cgfSA9IGNhcHR1cmVTdGFja1RyYWNlKCk7XHJcblxyXG4gIGNvbnN0IGV4aXRDb2RlcyA9IG9wdHMuZXhpdENvZGVzO1xyXG5cclxuICBjb25zdCBjd2QgPSBvcHRzLmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XHJcblxyXG4gIGNvbnN0IGNtZCA9ICgpID0+IFtjb21tYW5kLCAuLi5hcmdzXS5qb2luKCcgJyk7XHJcblxyXG4gIGxvZ2dlci5kZWJ1ZyhbJz4nLCBjbWQoKV0uam9pbignICcpLCAuLi4oY3dkID8gW2BpbiAke2N3ZH1gXSA6IFtdKSk7XHJcblxyXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMsIHJlaikgPT5cclxuICAgIGNoaWxkXHJcbiAgICAgIC5vbignY2xvc2UnLCAoY29kZSwgc2lnbmFsKSA9PiB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJykge1xyXG4gICAgICAgICAgaWYgKFxyXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdpbmhlcml0JyAmJlxyXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdhbnknICYmXHJcbiAgICAgICAgICAgICFleGl0Q29kZXMuaW5jbHVkZXMoY29kZSlcclxuICAgICAgICAgICkge1xyXG4gICAgICAgICAgICByZWooXHJcbiAgICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3coXHJcbiAgICAgICAgICAgICAgICBuZXcgRXJyb3IoYENvbW1hbmQgXCIke2NtZCgpfVwiIGhhcyBmYWlsZWQgd2l0aCBjb2RlICR7Y29kZX1gKVxyXG4gICAgICAgICAgICAgIClcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlcygpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSBpZiAoc2lnbmFsKSB7XHJcbiAgICAgICAgICByZWooXHJcbiAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxyXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihgRmFpbGVkIHRvIGV4ZWN1dGUgY29tbWFuZCBcIiR7Y21kKCl9XCIgLSAke3NpZ25hbH1gKVxyXG4gICAgICAgICAgICApXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xyXG4gICAgICAgIH1cclxuICAgICAgfSlcclxuICAgICAgLm9uKCdlcnJvcicsIHJlailcclxuICApO1xyXG4gIC8vIGluaGVyaXQgZXhpdCBjb2RlXHJcbiAgaWYgKGV4aXRDb2RlcyA9PT0gJ2luaGVyaXQnKSB7XHJcbiAgICBpZiAoXHJcbiAgICAgIHR5cGVvZiBjaGlsZC5leGl0Q29kZSA9PT0gJ251bWJlcicgJiZcclxuICAgICAgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJyB8fCBwcm9jZXNzLmV4aXRDb2RlID09PSAwKVxyXG4gICAgKSB7XHJcbiAgICAgIHByb2Nlc3MuZXhpdENvZGUgPSBjaGlsZC5leGl0Q29kZTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xyXG5cclxuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCwgU3Bhd25Ub1Byb21pc2VPcHRzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XHJcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xyXG5pbXBvcnQgeyBzcGF3blRvUHJvbWlzZSB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xyXG5cclxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRPcHRzID0ge1xyXG4gIG91dHB1dD86XHJcbiAgICB8IEFycmF5PCdzdGRvdXQnIHwgJ3N0ZGVycic+XHJcbiAgICB8IFsnc3Rkb3V0JyB8ICdzdGRlcnInLCAuLi5BcnJheTwnc3Rkb3V0JyB8ICdzdGRlcnInPl07XHJcbiAgYnVmZmVycz86IHtcclxuICAgIGNvbWJpbmVkPzogc3RyaW5nW107XHJcbiAgICBzdGRvdXQ/OiBzdHJpbmdbXTtcclxuICAgIHN0ZGVycj86IHN0cmluZ1tdO1xyXG4gIH07XHJcbn0gJiBTcGF3blRvUHJvbWlzZU9wdHM7XHJcblxyXG5leHBvcnQgdHlwZSBTcGF3blJlc3VsdFJldHVybiA9IHtcclxuICBwaWQ/OiBudW1iZXI7XHJcbiAgb3V0cHV0OiBzdHJpbmdbXTtcclxuICBzdGRvdXQ6IHN0cmluZztcclxuICBzdGRlcnI6IHN0cmluZztcclxuICBzdGF0dXM6IG51bWJlciB8IG51bGw7XHJcbiAgc2lnbmFsOiBOb2RlSlMuU2lnbmFscyB8IG51bGw7XHJcbiAgZXJyb3I/OiBFcnJvciB8IHVuZGVmaW5lZDtcclxufTtcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blJlc3VsdChcclxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxTcGF3blJlc3VsdE9wdHM+XHJcbik6IFByb21pc2U8U3Bhd25SZXN1bHRSZXR1cm4+IHtcclxuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XHJcbiAgY29uc3QgY29tYmluZWREYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uY29tYmluZWQgPz8gW107XHJcbiAgY29uc3Qgc3Rkb3V0RGF0YTogc3RyaW5nW10gPSBvcHRzLmJ1ZmZlcnM/LnN0ZG91dCA/PyBbXTtcclxuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3RkZXJyID8/IFtdO1xyXG4gIGNvbnN0IG91dHB1dCA9IG9wdHMub3V0cHV0ID8/IFsnc3Rkb3V0JywgJ3N0ZGVyciddO1xyXG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZG91dCcpKSB7XHJcbiAgICBhc3NlcnQoXHJcbiAgICAgICEhY2hpbGQuc3Rkb3V0LFxyXG4gICAgICAnRXhwZWN0ZWQgXCIuc3Rkb3V0XCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xyXG4gICAgKTtcclxuICAgIGNoaWxkLnN0ZG91dC5zZXRFbmNvZGluZygndXRmLTgnKTtcclxuICAgIGNoaWxkLnN0ZG91dC5vbignZGF0YScsIChkYXRhOiBzdHJpbmcpID0+IHtcclxuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XHJcbiAgICAgIHN0ZG91dERhdGEucHVzaChkYXRhKTtcclxuICAgIH0pO1xyXG4gIH1cclxuICBpZiAob3V0cHV0LmluY2x1ZGVzKCdzdGRlcnInKSkge1xyXG4gICAgYXNzZXJ0KFxyXG4gICAgICAhIWNoaWxkLnN0ZGVycixcclxuICAgICAgJ0V4cGVjdGVkIFwiLnN0ZGVyclwiIHRvIGJlIGRlZmluZWQsIHdoaWNoIHdpbGwgb25seSBiZSBkZWZpbmVkIGlmIGNoaWxkIHByb2Nlc3MgaXMgc3Bhd25lZCB3aXRoIGNvcnJlY3QgcGFyYW1ldGVycydcclxuICAgICk7XHJcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XHJcbiAgICBjaGlsZC5zdGRlcnIub24oJ2RhdGEnLCAoZGF0YTogc3RyaW5nKSA9PiB7XHJcbiAgICAgIGNvbWJpbmVkRGF0YS5wdXNoKGRhdGEpO1xyXG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XHJcbiAgICB9KTtcclxuICB9XHJcbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3NwYXduVG9Qcm9taXNlKGNoaWxkLCBvcHRzKV0pO1xyXG4gIHJldHVybiB7XHJcbiAgICBwaWQ6IGNoaWxkLnBpZCxcclxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcclxuICAgIHN0YXR1czogY2hpbGQuZXhpdENvZGUsXHJcbiAgICBnZXQgb3V0cHV0KCkge1xyXG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xyXG4gICAgfSxcclxuICAgIGdldCBzdGRlcnIoKSB7XHJcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xyXG4gICAgfSxcclxuICAgIGdldCBzdGRvdXQoKSB7XHJcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xyXG4gICAgfSxcclxuICAgIGdldCBlcnJvcigpIHtcclxuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcclxuICAgICAgICA/IChyZXN1bHQucmVhc29uIGFzIEVycm9yKVxyXG4gICAgICAgIDogdW5kZWZpbmVkO1xyXG4gICAgfSxcclxuICB9O1xyXG59XHJcbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xyXG5pbXBvcnQgdHlwZSB7IFNwYXduUmVzdWx0T3B0cywgU3Bhd25SZXN1bHRSZXR1cm4gfSBmcm9tICcuL3NwYXduUmVzdWx0JztcclxuaW1wb3J0IHsgc3Bhd25SZXN1bHQgfSBmcm9tICcuL3NwYXduUmVzdWx0JztcclxuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xyXG5pbXBvcnQgeyBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dChcclxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxTcGF3blJlc3VsdE9wdHM+XHJcbik6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xyXG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcclxuICByZXR1cm4gcmVzdWx0Lm91dHB1dC5qb2luKCcnKTtcclxufVxyXG5cclxuY29uc3QgZGVmYXVsdFNob3VsZE91dHB1dCA9IChyZXN1bHQ6IFNwYXduUmVzdWx0UmV0dXJuKSA9PiB7XHJcbiAgcmV0dXJuIHJlc3VsdC5lcnJvciB8fCByZXN1bHQuc3RhdHVzICE9PSAwIHx8IGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJztcclxufTtcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxyXG4gIC4uLnBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4PFxyXG4gICAgU3Bhd25SZXN1bHRPcHRzICYge1xyXG4gICAgICAvKipcclxuICAgICAgICogQnkgZGVmYXVsdCB3aWxsIG91dHB1dCB0byBgc3RkZXJyYCB3aGVuIHNwYXduIHJlc3VsdCBmYWlsZWQgd2l0aCBhbiBlcnJvciwgd2hlblxyXG4gICAgICAgKiBzdGF0dXMgY29kZSBpcyBub3QgemVybyBvciB3aGVuIGBMb2dnZXIubG9nTGV2ZWxgIGlzIGBkZWJ1Z2BcclxuICAgICAgICovXHJcbiAgICAgIHNob3VsZE91dHB1dD86IChyZXN1bHQ6IFNwYXduUmVzdWx0UmV0dXJuKSA9PiBib29sZWFuO1xyXG4gICAgfVxyXG4gID5cclxuKSB7XHJcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xyXG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcclxuICBjb25zdCBzaG91bGRPdXRwdXQgPSBvcHRzLnNob3VsZE91dHB1dCA/PyBkZWZhdWx0U2hvdWxkT3V0cHV0O1xyXG4gIGlmIChzaG91bGRPdXRwdXQocmVzdWx0KSkge1xyXG4gICAgbG9nZ2VyLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xyXG4gIH1cclxuICBpZiAocmVzdWx0LmVycm9yKSB7XHJcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcclxuICB9XHJcbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXN1bHQpO1xyXG59XHJcbiIsImltcG9ydCB7IGRpcm5hbWUsIHNlcCB9IGZyb20gJ25vZGU6cGF0aCc7XHJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XHJcblxyXG5pbXBvcnQgeyBvbmNlIH0gZnJvbSAnQHV0aWxzL3RzJztcclxuXHJcbmV4cG9ydCBjb25zdCBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCA9IChvcHRzOiB7XHJcbiAgaW1wb3J0TWV0YVVybDogc3RyaW5nO1xyXG59KSA9PiB7XHJcbiAgLy8gdGhpcyBpcyBoaWdobHkgZGVwZW5kZW50IG9uIHRoZSBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZVxyXG4gIC8vIGFuZCB0aGUgY29udGV4dCBpbiB3aGljaCB0aGlzIGZ1bmN0aW9uIGlzIHJ1biAoYnVuZGxlZCBjb2RlIHZzIHRzeCAuL3NyYy90c2ZpbGUudHMpXHJcbiAgY29uc3QgX19maWxlTmFtZSA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChvcHRzLmltcG9ydE1ldGFVcmwpKTtcclxuICBjb25zdCBwYXJlbnQgPSBkaXJuYW1lKF9fZmlsZU5hbWUpO1xyXG4gIGNvbnN0IHN1cGVyUGFyZW50ID0gZGlybmFtZShwYXJlbnQpO1xyXG5cclxuICBjb25zdCBpc0J1bmRsZWRJbkRpc3QgPSAoKSA9PiBwYXJlbnQuZW5kc1dpdGgoc2VwICsgJ2Rpc3QnKTtcclxuICBjb25zdCBpc0J1bmRsZWRJbkJpbiA9ICgpID0+XHJcbiAgICBwYXJlbnQuZW5kc1dpdGgoc2VwICsgJ2JpbicpICYmICFzdXBlclBhcmVudC5lbmRzV2l0aChzZXAgKyAnc3JjJyk7XHJcblxyXG4gIGlmIChpc0J1bmRsZWRJbkRpc3QoKSB8fCBpc0J1bmRsZWRJbkJpbigpKSB7XHJcbiAgICByZXR1cm4gZmlsZVVSTFRvUGF0aChuZXcgVVJMKGAuLi9gLCBvcHRzLmltcG9ydE1ldGFVcmwpKTtcclxuICB9XHJcblxyXG4gIC8vIHJ1biB2aWEgdHN4IHRvIGJ1aWxkIHRoZSBAcmVwa2Eta2l0L3RzIGl0c2VsZlxyXG4gIHJldHVybiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uLy4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpO1xyXG59O1xyXG5cclxuZXhwb3J0IGNvbnN0IG1vZHVsZVJvb3REaXJlY3RvcnkgPSBvbmNlKCgpID0+XHJcbiAgZ2V0TW9kdWxlUm9vdERpcmVjdG9yeUZvckltcG9ydE1ldGFVcmwoeyBpbXBvcnRNZXRhVXJsOiBpbXBvcnQubWV0YS51cmwgfSlcclxuKTtcclxuIiwiaW1wb3J0IHsgcmVhZEZpbGUsIHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcclxuaW1wb3J0IHsgZGlybmFtZSwgam9pbiwgc2VwIH0gZnJvbSAnbm9kZTpwYXRoJztcclxuXHJcbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuL21vZHVsZVJvb3REaXJlY3RvcnknO1xyXG5cclxuYXN5bmMgZnVuY3Rpb24gaXNGaWxlKGZpbGVQYXRoOiBzdHJpbmcpIHtcclxuICByZXR1cm4gYXdhaXQgc3RhdChmaWxlUGF0aClcclxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcclxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uKiBpdGVyYXRlTm9kZU1vZHVsZXMoc3RhcnRXaXRoOiBzdHJpbmcsIHBhdGg6IHN0cmluZykge1xyXG4gIGxldCBjdXJyZW50ID0gc3RhcnRXaXRoO1xyXG4gIHdoaWxlIChjdXJyZW50ICE9PSBzZXAgJiYgY3VycmVudCAhPT0gJ34vJykge1xyXG4gICAgY29uc3QgY2FuZGlkYXRlID0gam9pbihjdXJyZW50LCAnbm9kZV9tb2R1bGVzJywgcGF0aCk7XHJcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGNhbmRpZGF0ZSkpIHtcclxuICAgICAgeWllbGQgY2FuZGlkYXRlO1xyXG4gICAgfVxyXG4gICAgaWYgKGN1cnJlbnQgPT09IGRpcm5hbWUoY3VycmVudCkpIHtcclxuICAgICAgYnJlYWs7XHJcbiAgICB9XHJcbiAgICBjdXJyZW50ID0gZGlybmFtZShjdXJyZW50KTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGZpbmRCaW5TY3JpcHQoc3RhcnRXaXRoOiBzdHJpbmcsIGJpblNjcmlwdFBhdGg6IHN0cmluZykge1xyXG4gIGZvciBhd2FpdCAoY29uc3QgcGF0aCBvZiBpdGVyYXRlTm9kZU1vZHVsZXMoc3RhcnRXaXRoLCBiaW5TY3JpcHRQYXRoKSkge1xyXG4gICAgcmV0dXJuIHBhdGg7XHJcbiAgfVxyXG4gIHJldHVybiB1bmRlZmluZWQ7XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBiaW5QYXRoKG9wdHM6IHtcclxuICBiaW5OYW1lOiBzdHJpbmc7XHJcbiAgYmluU2NyaXB0UGF0aDogc3RyaW5nO1xyXG4gIHVzZVNob3J0Y3V0PzogYm9vbGVhbjtcclxufSkge1xyXG4gIGNvbnN0IHVzZVNob3J0Y3V0ID0gb3B0cy51c2VTaG9ydGN1dCA/PyBwcm9jZXNzLnBsYXRmb3JtICE9PSAnd2luMzInO1xyXG4gIGNvbnN0IHJvb3QgPSBtb2R1bGVSb290RGlyZWN0b3J5KCk7XHJcbiAgaWYgKHVzZVNob3J0Y3V0KSB7XHJcbiAgICBjb25zdCBiZXN0R3Vlc3MgPSBqb2luKHJvb3QsICdub2RlX21vZHVsZXMnLCAnLmJpbicsIG9wdHMuYmluTmFtZSk7XHJcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGJlc3RHdWVzcykpIHtcclxuICAgICAgcmV0dXJuIGJlc3RHdWVzcztcclxuICAgIH1cclxuICB9XHJcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmluZEJpblNjcmlwdChyb290LCBvcHRzLmJpblNjcmlwdFBhdGgpO1xyXG4gIGlmIChyZXN1bHQpIHtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG4gIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGZpbmQgYmluICR7b3B0cy5iaW5OYW1lfWApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzY3JpcHRGcm9tUGFja2FnZUpzb24ob3B0czoge1xyXG4gIGJpbk5hbWU6IHN0cmluZztcclxuICBwYWNrYWdlSnNvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcbn0pIHtcclxuICBjb25zdCBjYW5kaWRhdGUgPSBvcHRzLnBhY2thZ2VKc29uWydiaW4nXTtcclxuICBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ3N0cmluZycpIHtcclxuICAgIHJldHVybiBjYW5kaWRhdGU7XHJcbiAgfSBlbHNlIGlmICh0eXBlb2YgY2FuZGlkYXRlID09PSAnb2JqZWN0JyAmJiBjYW5kaWRhdGUgIT09IG51bGwpIHtcclxuICAgIGNvbnN0IGVudHJ5ID0gKGNhbmRpZGF0ZSBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KVtvcHRzLmJpbk5hbWVdO1xyXG4gICAgaWYgKHR5cGVvZiBlbnRyeSA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgcmV0dXJuIGVudHJ5O1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gdW5kZWZpbmVkO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGV0ZXJtaW5lQmluU2NyaXB0UGF0aChvcHRzOiB7XHJcbiAgYmluTmFtZTogc3RyaW5nO1xyXG4gIGJpblBhY2thZ2VOYW1lOiBzdHJpbmc7XHJcbn0pIHtcclxuICBmb3IgYXdhaXQgKGNvbnN0IHBhdGggb2YgaXRlcmF0ZU5vZGVNb2R1bGVzKFxyXG4gICAgbW9kdWxlUm9vdERpcmVjdG9yeSgpLFxyXG4gICAgam9pbihvcHRzLmJpblBhY2thZ2VOYW1lLCAncGFja2FnZS5qc29uJylcclxuICApKSB7XHJcbiAgICBjb25zdCBwa2cgPSBhd2FpdCByZWFkRmlsZShwYXRoLCAndXRmLTgnKVxyXG4gICAgICAudGhlbigodGV4dCkgPT4gSlNPTi5wYXJzZSh0ZXh0KSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcclxuICAgICAgLmNhdGNoKCgpID0+IG51bGwpO1xyXG4gICAgaWYgKCFwa2cpIHtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc2NyaXB0UGF0aCA9IHNjcmlwdEZyb21QYWNrYWdlSnNvbih7XHJcbiAgICAgIGJpbk5hbWU6IG9wdHMuYmluTmFtZSxcclxuICAgICAgcGFja2FnZUpzb246IHBrZyxcclxuICAgIH0pO1xyXG4gICAgaWYgKCFzY3JpcHRQYXRoKSB7XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGpvaW4oZGlybmFtZShwYXRoKSwgc2NyaXB0UGF0aCk7XHJcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGNhbmRpZGF0ZSkpIHtcclxuICAgICAgLy8gZGVub3JtYWxpemUgYW5kIG1ha2UgdGhpcyBjb25zaXN0ZW50IG9uIGFsbCBwbGF0Zm9ybXNcclxuICAgICAgLy8gYXMgdGhlIHBhdGggd2lsbCB3b3JrIGJvdGggZm9yIHdpbmRvd3MgYW5kIG5vbi13aW5kb3dzXHJcbiAgICAgIHJldHVybiBqb2luKG9wdHMuYmluUGFja2FnZU5hbWUsIHNjcmlwdFBhdGgpLnJlcGxhY2VBbGwoc2VwLCAnLycpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gdW5kZWZpbmVkO1xyXG59XHJcbiIsImltcG9ydCB7IHBlcmZvcm1hbmNlIH0gZnJvbSAnbm9kZTpwZXJmX2hvb2tzJztcclxuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcclxuXHJcbmltcG9ydCB7IHNwYXduT3V0cHV0Q29uZGl0aW9uYWwgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xyXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuL2xvZ2dlci9sb2dnZXInO1xyXG5pbXBvcnQgeyBiaW5QYXRoIH0gZnJvbSAnLi91dGlscy9iaW5QYXRoJztcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Uc1NjcmlwdChvcHRzOiB7XHJcbiAgbG9jYXRpb246IHN0cmluZztcclxuICBpbXBvcnRNZXRhVXJsPzogVVJMO1xyXG4gIGFyZ3M/OiBzdHJpbmdbXTtcclxufSkge1xyXG4gIGNvbnN0IHN0YXJ0ZWQgPSBwZXJmb3JtYW5jZS5ub3coKTtcclxuICB0cnkge1xyXG4gICAgY29uc3QgbG9jYXRpb24gPSBvcHRzLmltcG9ydE1ldGFVcmxcclxuICAgICAgPyBmaWxlVVJMVG9QYXRoKG5ldyBVUkwob3B0cy5sb2NhdGlvbiwgb3B0cy5pbXBvcnRNZXRhVXJsKSlcclxuICAgICAgOiBvcHRzLmxvY2F0aW9uO1xyXG5cclxuICAgIGlmIChsb2dnZXIubG9nTGV2ZWwgIT09ICdkZWJ1ZycpIHtcclxuICAgICAgbG9nZ2VyLmxvZyhgUnVubmluZyBcIiR7bG9jYXRpb259XCJgKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbChcclxuICAgICAgcHJvY2Vzcy5leGVjUGF0aCxcclxuICAgICAgW1xyXG4gICAgICAgIGF3YWl0IGJpblBhdGgoe1xyXG4gICAgICAgICAgYmluTmFtZTogJ3RzeCcsXHJcbiAgICAgICAgICBiaW5TY3JpcHRQYXRoOiAndHN4L2Rpc3QvY2xpLmpzJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBsb2NhdGlvbixcclxuICAgICAgICAuLi4ob3B0cy5hcmdzIHx8IFtdKSxcclxuICAgICAgXSxcclxuICAgICAge1xyXG4gICAgICAgIGV4aXRDb2RlczogWzBdLFxyXG4gICAgICAgIC4uLihsb2dnZXIubG9nTGV2ZWwgPT09ICdkZWJ1ZycgJiYge1xyXG4gICAgICAgICAgc3RkaW86ICdpbmhlcml0JyxcclxuICAgICAgICAgIG91dHB1dDogW10sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgZW52OiB7XHJcbiAgICAgICAgICAuLi5wcm9jZXNzLmVudixcclxuICAgICAgICAgIExPR19MRVZFTDogbG9nZ2VyLmxvZ0xldmVsLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH1cclxuICAgICk7XHJcbiAgfSBmaW5hbGx5IHtcclxuICAgIGlmIChsb2dnZXIubG9nTGV2ZWwgIT09ICdkZWJ1ZycpIHtcclxuICAgICAgbG9nZ2VyLmxvZyhcclxuICAgICAgICBgRmluaXNoZWQgaW4gJHsoKHBlcmZvcm1hbmNlLm5vdygpIC0gc3RhcnRlZCkgLyAxMDAwKS50b0ZpeGVkKDIpfXNgXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XHJcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xyXG5cclxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcclxuXHJcbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuLi91dGlscy9tb2R1bGVSb290RGlyZWN0b3J5JztcclxuaW1wb3J0IHR5cGUgeyBQYWNrYWdlSnNvbiB9IGZyb20gJy4vcGFja2FnZUpzb24nO1xyXG5cclxuY29uc3QgY3dkUGFja2FnZUpzb25QYXRoID0gKCkgPT4gam9pbihwcm9jZXNzLmN3ZCgpLCAnLi9wYWNrYWdlLmpzb24nKTtcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbkF0KFxyXG4gIHBhdGg6IHN0cmluZyxcclxuICBkZXBzID0geyByZWFkRmlsZTogKHBhdGg6IHN0cmluZykgPT4gcmVhZEZpbGUocGF0aCwgJ3V0Zi04JykgfVxyXG4pOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XHJcbiAgcmV0dXJuIGF3YWl0IGRlcHNcclxuICAgIC5yZWFkRmlsZShwYXRoKVxyXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gSlNPTi5wYXJzZShyZXN1bHQpIGFzIFBhY2thZ2VKc29uKTtcclxufVxyXG5cclxuZXhwb3J0IGNvbnN0IHJlYWRDd2RQYWNrYWdlSnNvbiA9IG9uY2VBc3luYygoKSA9PlxyXG4gIHJlYWRQYWNrYWdlSnNvbkF0KGN3ZFBhY2thZ2VKc29uUGF0aCgpKVxyXG4pO1xyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbihcclxuICBwYXRoOiBzdHJpbmcsXHJcbiAgZGVwcyA9IHsgcmVhZEZpbGU6IChwYXRoOiBzdHJpbmcpID0+IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpIH1cclxuKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xyXG4gIC8vIGFzc3VtaW5nIGN1cnJlbnQgZGlyZWN0b3J5IGRvZXNuJ3QgY2hhbmdlIHdoaWxlIGFwcCBpcyBydW5uaW5nXHJcbiAgcmV0dXJuIHByb2Nlc3MuY3dkKCkgPT09IGN3ZFBhY2thZ2VKc29uUGF0aCgpXHJcbiAgICA/IGF3YWl0IHJlYWRDd2RQYWNrYWdlSnNvbigpXHJcbiAgICA6IGF3YWl0IHJlYWRQYWNrYWdlSnNvbkF0KHBhdGgsIGRlcHMpO1xyXG59XHJcblxyXG4vKipcclxuICogUmVhZCBwYWNrYWdlIGpzb24gb2YgdGhlIGN1cnJlbnQgbGlicmFyeSAoQHJlcGthLWtpdC90cylcclxuICovXHJcbmV4cG9ydCBjb25zdCBvdXJQYWNrYWdlSnNvbiA9IG9uY2VBc3luYyhcclxuICBhc3luYyAoXHJcbiAgICBkZXBzID0ge1xyXG4gICAgICByZWFkRmlsZTogKHBhdGg6IHN0cmluZykgPT4gcmVhZEZpbGUocGF0aCwgJ3V0Zi04JyksXHJcbiAgICB9XHJcbiAgKSA9PiB7XHJcbiAgICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSBqb2luKG1vZHVsZVJvb3REaXJlY3RvcnkoKSwgJ3BhY2thZ2UuanNvbicpO1xyXG4gICAgcmV0dXJuIGF3YWl0IHJlYWRQYWNrYWdlSnNvbkF0KHBhY2thZ2VKc29uUGF0aCwge1xyXG4gICAgICByZWFkRmlsZTogZGVwcy5yZWFkRmlsZSxcclxuICAgIH0pO1xyXG4gIH1cclxuKTtcclxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydCc7XHJcbmltcG9ydCB7IGRpcm5hbWUsIG5vcm1hbGl6ZSwgc2VwIH0gZnJvbSAnbm9kZTpwYXRoJztcclxuXHJcbmltcG9ydCB7IGVzY2FwZVJlZ0V4cCwgaXNUcnV0aHksIG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XHJcbmltcG9ydCBmZyBmcm9tICdmYXN0LWdsb2InO1xyXG5cclxuY29uc3QgZ2V0UmVwb3NpdG9yeVJvb3RTY2FuQ2FuZGlkYXRlcyA9IChjdXJyZW50RGlyZWN0b3J5OiBzdHJpbmcpID0+IHtcclxuICBjb25zdCBlc2MgPSBlc2NhcGVSZWdFeHAoc2VwKTtcclxuICAvLyBoYXZpbmcgJ3BhY2thZ2VzLyonIGluIHRoZSByb290IG9mIGEgbW9ub3JlcG8gaXMgc3VwZXIgY29tbW9uXHJcbiAgY29uc3QgcmVzdWx0ID0gbmV3IFJlZ0V4cChcclxuICAgIGAoLiooPz0ke2VzY31wYWNrYWdlcyR7ZXNjfSkpfCguKig/PSR7ZXNjfW5vZGVfbW9kdWxlcyR7ZXNjfSkpfCguKilgXHJcbiAgKS5leGVjKGN1cnJlbnREaXJlY3RvcnkpO1xyXG4gIGFzc2VydCghIXJlc3VsdCk7XHJcbiAgY29uc3QgWywgcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdID0gcmVzdWx0O1xyXG4gIHJldHVybiBbcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdLmZpbHRlcihpc1RydXRoeSk7XHJcbn07XHJcblxyXG4vLyByZXR1cm5zIHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2hpY2ggaGFzIG1vbm9yZXBvIG1hcmtlcnMsIG11bHRpcGxlXHJcbi8vIGRpcmVjdG9yaWVzIGNhbiBoYXZlIHRoZW0gLSB3aGljaGV2ZXIgcmVhZCBmaXJzdCB3aWxsIGJlIHJldHVybmVkXHJcbi8vIHNvIGlmIG9yZGVyIGlzIGltcG9ydGFudCAtIHNjYW5uaW5nIHNob3VsZCBiZSBzZXBhcmF0ZWQgdG8gbXVsdGlwbGUgam9ic1xyXG4vLyB2aWEgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnNcclxuY29uc3QgaGFzUm9vdE1hcmtlcnNGb3IgPSBhc3luYyAoY2FuZGlkYXRlOiBzdHJpbmcpID0+IHtcclxuICBjb25zdCBtYXJrZXJzID0gW1xyXG4gICAgJy5naXQnLFxyXG4gICAgJ3lhcm4ubG9jaycsXHJcbiAgICAncG5wbS1sb2NrLnlhbWwnLFxyXG4gICAgJ3BhY2thZ2UtbG9jay5qc29uJyxcclxuICAgICdwbnBtLXdvcmtzcGFjZS55YW1sJyxcclxuICBdO1xyXG4gIGNvbnN0IG1hcmtlcnNTdHJlYW0gPSBmZy5zdHJlYW0obWFya2Vycywge1xyXG4gICAgbWFya0RpcmVjdG9yaWVzOiB0cnVlLFxyXG4gICAgb25seUZpbGVzOiBmYWxzZSxcclxuICAgIGN3ZDogY2FuZGlkYXRlLFxyXG4gICAgYWJzb2x1dGU6IHRydWUsXHJcbiAgfSk7XHJcbiAgZm9yIGF3YWl0IChjb25zdCBlbnRyeSBvZiBtYXJrZXJzU3RyZWFtKSB7XHJcbiAgICBhc3NlcnQodHlwZW9mIGVudHJ5ID09PSAnc3RyaW5nJyk7XHJcbiAgICByZXR1cm4gZGlybmFtZShlbnRyeSk7XHJcbiAgfVxyXG4gIHJldHVybiB1bmRlZmluZWQ7XHJcbn07XHJcblxyXG5jb25zdCBoYXNSb290TWFya2VycyA9IGFzeW5jIChjYW5kaWRhdGVzOiBzdHJpbmdbXSkgPT4ge1xyXG4gIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChcclxuICAgIGNhbmRpZGF0ZXMubWFwKChjYW5kaWRhdGUpID0+IGhhc1Jvb3RNYXJrZXJzRm9yKGNhbmRpZGF0ZSkpXHJcbiAgKTtcclxuICByZXR1cm4gcmVzdWx0cy5maWx0ZXIoaXNUcnV0aHkpWzBdO1xyXG59O1xyXG5cclxuY29uc3QgcHJpb3JpdGl6ZWRIYXNNYXJrZXJzID0gKGpvYnM6IHN0cmluZ1tdW10pID0+IHtcclxuICBpZiAoam9icy5sZW5ndGggPT09IDApIHtcclxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBuZXcgUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+KChyZXMpID0+IHtcclxuICAgIGNvbnN0IHJlc3VsdHMgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nIHwgdW5kZWZpbmVkPigpO1xyXG5cclxuICAgIGNvbnN0IGNoZWNrU2hvdWxkQ29tcGxldGUgPSAoaW5kZXg6IG51bWJlciwgcmVzdWx0OiBzdHJpbmcgfCB1bmRlZmluZWQpID0+IHtcclxuICAgICAgcmVzdWx0cy5zZXQoaW5kZXgsIHJlc3VsdCk7XHJcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgam9icy5sZW5ndGg7IGkgKz0gMSkge1xyXG4gICAgICAgIGNvbnN0IGhhc1Jlc3VsdCA9IHJlc3VsdHMuaGFzKGkpO1xyXG4gICAgICAgIGlmICghaGFzUmVzdWx0KSB7XHJcbiAgICAgICAgICAvLyBpZiBhIGpvYiB3aXRoIGhpZ2hlc3QgcHJpb3JpdHkgaGFzbid0IGZpbmlzaGVkIHlldFxyXG4gICAgICAgICAgLy8gdGhlbiB3YWl0IGZvciBpdFxyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc3VsdHMuZ2V0KGkpO1xyXG4gICAgICAgIGlmIChyZXN1bHQpIHtcclxuICAgICAgICAgIC8vIGpvYiBmaW5pc2hlZCBhbmQgd2UgZm91bmQgbWFya2VycywgYWxzbyBhbGwgam9ic1xyXG4gICAgICAgICAgLy8gd2l0aCBoaWdoZXIgcHJpb3JpdHkgZmluaXNoZWQgYW5kIHRoZXkgZG9uJ3QgaGF2ZVxyXG4gICAgICAgICAgLy8gYW55IG1hcmtlcnMgLSB3ZSBhcmUgZG9uZVxyXG4gICAgICAgICAgcmVzKHJlc3VsdCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChyZXN1bHRzLnNpemUgPT09IGpvYnMubGVuZ3RoKSB7XHJcbiAgICAgICAgLy8gYWxsIGpvYnMgZmluaXNoZWQgLSBubyBtYXJrZXJzIGZvdW5kXHJcbiAgICAgICAgcmVzKHVuZGVmaW5lZCk7XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgam9icy5mb3JFYWNoKChkaXJlY3RvcmllcywgaW5kZXgpID0+IHtcclxuICAgICAgaGFzUm9vdE1hcmtlcnMoZGlyZWN0b3JpZXMpXHJcbiAgICAgICAgLnRoZW4oKHJlc3VsdCkgPT4ge1xyXG4gICAgICAgICAgY2hlY2tTaG91bGRDb21wbGV0ZShpbmRleCwgcmVzdWx0KTtcclxuICAgICAgICB9KVxyXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XHJcbiAgICAgICAgICAvLyBpZ25vcmVcclxuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcclxuICAgICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG59O1xyXG5cclxuZXhwb3J0IGNvbnN0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4gPSBhc3luYyAoXHJcbiAgbG9va3VwRGlyZWN0b3J5OiBzdHJpbmdcclxuKSA9PiB7XHJcbiAgY29uc3QgdW5pcXVlRGlybmFtZSA9IChwYXRoPzogc3RyaW5nKSA9PiB7XHJcbiAgICBpZiAoIXBhdGgpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgcmVzdWx0ID0gZGlybmFtZShwYXRoKTtcclxuICAgIGlmIChyZXN1bHQgPT09IHBhdGgpIHtcclxuICAgICAgLy8gZS5nLiB0aGUgcGF0aCB3YXMgYWxyZWFkeSBhIHJvb3QgXCIvXCJcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9O1xyXG5cclxuICBjb25zdCBwYXJlbnQgPSB1bmlxdWVEaXJuYW1lKGxvb2t1cERpcmVjdG9yeSk7XHJcbiAgY29uc3Qgc3VwZXJQYXJlbnQgPSB1bmlxdWVEaXJuYW1lKHBhcmVudCk7XHJcblxyXG4gIGNvbnN0IHJlc3VsdCA9XHJcbiAgICAoYXdhaXQgcHJpb3JpdGl6ZWRIYXNNYXJrZXJzKFxyXG4gICAgICAvLyBzY2FuIGluIG1vc3QgbGlrZWx5IGxvY2F0aW9ucyBmaXJzdCB3aXRoIGN1cnJlbnQgbG9va3VwIGRpcmVjdG9yeSB0YWtpbmcgcHJpb3JpdHlcclxuICAgICAgW1xyXG4gICAgICAgIFtsb29rdXBEaXJlY3RvcnldLFxyXG4gICAgICAgIGdldFJlcG9zaXRvcnlSb290U2NhbkNhbmRpZGF0ZXMobG9va3VwRGlyZWN0b3J5KSxcclxuICAgICAgICAvLyBzY2FuIDIgZGlyZWN0b3JpZXMgdXB3YXJkc1xyXG4gICAgICAgIFtwYXJlbnRdLFxyXG4gICAgICAgIFtzdXBlclBhcmVudF0sXHJcbiAgICAgIF1cclxuICAgICAgICAubWFwKChkaXJzKSA9PiBkaXJzLmZpbHRlcihpc1RydXRoeSkpXHJcbiAgICAgICAgLmZpbHRlcigoam9iKSA9PiBqb2IubGVuZ3RoID4gMClcclxuICAgICkpIHx8IGxvb2t1cERpcmVjdG9yeTsgLyogZmFsbGJhY2sgdG8gY3VycmVudCBkaXJlY3RvcnkgaW4gd29yc2Ugc2NlbmFyaW8gKi9cclxuXHJcbiAgcmV0dXJuIG5vcm1hbGl6ZShyZXN1bHQpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIERldGVybWluZSByZXBvc2l0b3J5IHJvb3QgcGF0aCBieSBzY2FubmluZyBjdXJyZW50IGFuZCBwYXJlbnQgZGlyZWN0b3JpZXNcclxuICogYW5kIGxvb2tpbmcgZm9yIG1hcmtlciBmaWxlcy9kaXJzIGxpa2U6XHJcbiAqXHJcbiAqIC0gLmdpdFxyXG4gKiAtIHBhY2thZ2UtbG9jay5qc29uXHJcbiAqIC0geWFybi5sb2NrXHJcbiAqIC0gcG5wbS1sb2NrLnlhbWxcclxuICogLSBwbnBtLXdvcmtzcGFjZS55YW1sXHJcbiAqL1xyXG5leHBvcnQgY29uc3QgcmVwb3NpdG9yeVJvb3RQYXRoID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcclxuICBjb25zdCByb290UGF0aCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4ocHJvY2Vzcy5jd2QoKSk7XHJcbiAgcmV0dXJuIHJvb3RQYXRoO1xyXG59KTtcclxuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcclxuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xyXG5cclxuaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnNXaXRoRXh0cmEgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xyXG5pbXBvcnQgeyBzcGF3bk91dHB1dENvbmRpdGlvbmFsIH0gZnJvbSAnLi9jaGlsZC1wcm9jZXNzJztcclxuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3Mvc3Bhd25SZXN1bHQnO1xyXG5pbXBvcnQgeyBiaW5QYXRoIH0gZnJvbSAnLi91dGlscy9iaW5QYXRoJztcclxuaW1wb3J0IHR5cGUgeyBDbGlBcmdzIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XHJcbmltcG9ydCB7IHNldFNjcmlwdCB9IGZyb20gJy4vdXRpbHMvY2xpQXJnc1BpcGUnO1xyXG5pbXBvcnQgeyBjbGlBcmdzUGlwZSB9IGZyb20gJy4vdXRpbHMvY2xpQXJnc1BpcGUnO1xyXG5pbXBvcnQgeyBpbnNlcnRBZnRlckFueU9mIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XHJcbmltcG9ydCB7IGluY2x1ZGVzQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcclxuaW1wb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi91dGlscy9yZXBvc2l0b3J5Um9vdFBhdGgnO1xyXG5cclxuZXhwb3J0IHR5cGUgVGFza1R5cGVzID1cclxuICB8ICdsaW50J1xyXG4gIHwgJ2J1aWxkJ1xyXG4gIHwgJ3Rlc3QnXHJcbiAgfCAnZGVjbGFyYXRpb25zJ1xyXG4gIHwgJ2ludGVncmF0aW9uJ1xyXG4gIHwgJ3NldHVwOmludGVncmF0aW9uJ1xyXG4gIHwgKHN0cmluZyAmIHtcclxuICAgICAgX2FsbG93U3RyaW5ncz86IHVuZGVmaW5lZDtcclxuICAgIH0pO1xyXG5cclxuZXhwb3J0IGNvbnN0IHR1cmJvQmluUGF0aCA9ICgpID0+XHJcbiAgYmluUGF0aCh7XHJcbiAgICBiaW5OYW1lOiAndHVyYm8nLFxyXG4gICAgYmluU2NyaXB0UGF0aDogJ3R1cmJvL2Jpbi90dXJibycsXHJcbiAgfSk7XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFzVHVyYm9Kc29uKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xyXG4gIHJldHVybiBhd2FpdCBzdGF0KGpvaW4oY3dkLCAndHVyYm8uanNvbicpKVxyXG4gICAgLnRoZW4oKHJlcykgPT4gcmVzLmlzRmlsZSgpKVxyXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhc3NUdXJib0ZvcmNlRW52KGFyZ3M6IHN0cmluZ1tdKSB7XHJcbiAgcmV0dXJuIGluY2x1ZGVzQW55T2YoYXJncywgWydydW4nXSkgJiYgaW5jbHVkZXNBbnlPZihhcmdzLCBbJy0tZm9yY2UnXSlcclxuICAgID8ge1xyXG4gICAgICAgIFRVUkJPX0ZPUkNFOiAnMScsXHJcbiAgICAgIH1cclxuICAgIDogdW5kZWZpbmVkO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gaW5oZXJpdFR1cmJvRm9yY2VBcmdGcm9tRW52KCkge1xyXG4gIHJldHVybiAoc3RhdGU6IENsaUFyZ3MpID0+ICh7XHJcbiAgICAuLi5zdGF0ZSxcclxuICAgIGlucHV0QXJnczpcclxuICAgICAgaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsncnVuJ10pICYmXHJcbiAgICAgICFpbmNsdWRlc0FueU9mKHN0YXRlLmlucHV0QXJncywgWyctLWZvcmNlJ10pICYmXHJcbiAgICAgIHByb2Nlc3MuZW52WydUVVJCT19GT1JDRSddXHJcbiAgICAgICAgPyBpbnNlcnRBZnRlckFueU9mKHN0YXRlLmlucHV0QXJncywgWyctLWZvcmNlJ10sIFsncnVuJ10pXHJcbiAgICAgICAgOiBzdGF0ZS5pbnB1dEFyZ3MsXHJcbiAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBSdW4gb25lIG9mIHRoZSBkZXYgcGlwZWxpbmUgdGFza3MgdXNpbmcgVHVyYm8gZm9yIGEgc2luZ2xlIHBhY2thZ2VcclxuICovXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5UdXJib1Rhc2tzRm9yU2luZ2xlUGFja2FnZShvcHRzOiB7XHJcbiAgdGFza3M6IFtUYXNrVHlwZXMsIC4uLlRhc2tUeXBlc1tdXTtcclxuICBwYWNrYWdlRGlyPzogc3RyaW5nO1xyXG4gIHNwYXduT3B0czogT21pdDxTcGF3bk9wdGlvbnNXaXRoRXh0cmE8U3Bhd25SZXN1bHRPcHRzPiwgJ2N3ZCc+O1xyXG59KSB7XHJcbiAgY29uc3Qgcm9vdERpciA9IG9wdHMucGFja2FnZURpciA/PyBwcm9jZXNzLmN3ZCgpO1xyXG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xyXG4gIHJldHVybiBhd2FpdCBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxyXG4gICAgcHJvY2Vzcy5leGVjUGF0aCxcclxuICAgIGNsaUFyZ3NQaXBlKFxyXG4gICAgICBbc2V0U2NyaXB0KGF3YWl0IHR1cmJvQmluUGF0aCgpKSwgaW5oZXJpdFR1cmJvRm9yY2VBcmdGcm9tRW52KCldLFxyXG4gICAgICBbXHJcbiAgICAgICAgJ3J1bicsXHJcbiAgICAgICAgLi4ub3B0cy50YXNrcyxcclxuICAgICAgICAnLS1maWx0ZXI9JyArIHJvb3REaXIucmVwbGFjZShjd2QsICcuJyksXHJcbiAgICAgICAgJy0tb3V0cHV0LWxvZ3M9bmV3LW9ubHknLFxyXG4gICAgICAgICctLWNvbG9yJyxcclxuICAgICAgXVxyXG4gICAgKSxcclxuICAgIHtcclxuICAgICAgLi4ub3B0cy5zcGF3bk9wdHMsXHJcbiAgICAgIGN3ZCxcclxuICAgIH1cclxuICApO1xyXG59XHJcbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XHJcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xyXG5cclxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcclxuaW1wb3J0IHsgbG9hZCB9IGZyb20gJ2pzLXlhbWwnO1xyXG5cclxuaW1wb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xyXG5cclxuYXN5bmMgZnVuY3Rpb24gdHJ5UmVhZGluZ1BucG1Xb3Jrc3BhY2VZYW1sKG1vbm9yZXBvUm9vdDogc3RyaW5nKSB7XHJcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHJlYWRGaWxlKFxyXG4gICAgam9pbihtb25vcmVwb1Jvb3QsICdwbnBtLXdvcmtzcGFjZS55YW1sJyksXHJcbiAgICAndXRmLTgnXHJcbiAgKTtcclxuICBjb25zdCByb290UGF0aCA9IGxvYWQodGV4dCkgYXMge1xyXG4gICAgcGFja2FnZXM/OiBzdHJpbmdbXTtcclxuICB9O1xyXG4gIHJldHVybiBBcnJheS5pc0FycmF5KHJvb3RQYXRoLnBhY2thZ2VzKSAmJiByb290UGF0aC5wYWNrYWdlcy5sZW5ndGggPiAwXHJcbiAgICA/IHJvb3RQYXRoLnBhY2thZ2VzXHJcbiAgICA6IHVuZGVmaW5lZDtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gdHJ5UmVhZGluZ1BhY2thZ2VKc29uV29ya3NwYWNlcyhtb25vcmVwb1Jvb3Q6IHN0cmluZykge1xyXG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShqb2luKG1vbm9yZXBvUm9vdCwgJ3BhY2thZ2UuanNvbicpLCAndXRmLTgnKTtcclxuICBjb25zdCBwYWNrYWdlSnNvbiA9IEpTT04ucGFyc2UodGV4dCkgYXMge1xyXG4gICAgd29ya3NwYWNlcz86IHN0cmluZ1tdO1xyXG4gIH07XHJcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkocGFja2FnZUpzb24ud29ya3NwYWNlcykgJiZcclxuICAgIHBhY2thZ2VKc29uLndvcmtzcGFjZXMubGVuZ3RoID4gMFxyXG4gICAgPyBwYWNrYWdlSnNvbi53b3Jrc3BhY2VzXHJcbiAgICA6IHVuZGVmaW5lZDtcclxufVxyXG5cclxuY29uc3QgcmVhZFBhY2thZ2VzR2xvYnNBdCA9IGFzeW5jIChtb25vcmVwb1Jvb3Q6IHN0cmluZykgPT4ge1xyXG4gIGNvbnN0IFtwbnBtV29ya3NwYWNlcywgcGFja2FnZUpzb25Xb3Jrc3BhY2VzXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcclxuICAgIHRyeVJlYWRpbmdQbnBtV29ya3NwYWNlWWFtbChtb25vcmVwb1Jvb3QpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCksXHJcbiAgICB0cnlSZWFkaW5nUGFja2FnZUpzb25Xb3Jrc3BhY2VzKG1vbm9yZXBvUm9vdCkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKSxcclxuICBdKTtcclxuICByZXR1cm4gcG5wbVdvcmtzcGFjZXMgfHwgcGFja2FnZUpzb25Xb3Jrc3BhY2VzIHx8IFtdO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIERldGVybWluZSBtb25vcmVwbyBwYWNrYWdlcyBnbG9iIGJ5IHJlYWRpbmcgb25lIG9mIHRoZSBzdXBwb3J0ZWRcclxuICogZmlsZXNcclxuICpcclxuICogTk9URTogb25seSBwbnBtIGlzIHN1cHBvcnRlZCBhdCB0aGUgbW9tZW50XHJcbiAqL1xyXG5leHBvcnQgY29uc3QgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XHJcbiAgY29uc3Qgcm9vdCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xyXG4gIGNvbnN0IHBhY2thZ2VzR2xvYnMgPSBhd2FpdCByZWFkUGFja2FnZXNHbG9ic0F0KHJvb3QpO1xyXG4gIHJldHVybiB7XHJcbiAgICByb290LFxyXG4gICAgcGFja2FnZXNHbG9icyxcclxuICB9O1xyXG59KTtcclxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XHJcblxyXG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcclxuXHJcbmltcG9ydCB7IGhhc1R1cmJvSnNvbiB9IGZyb20gJy4uL3R1cmJvJztcclxuaW1wb3J0IHsgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyB9IGZyb20gJy4vcmVhZFBhY2thZ2VzR2xvYnMnO1xyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbigpIHtcclxuICBjb25zdCBbeyByb290LCBwYWNrYWdlc0dsb2JzIH0sIGhhc1R1cmJvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcclxuICAgIHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMoKSxcclxuICAgIGhhc1R1cmJvSnNvbigpLFxyXG4gIF0pO1xyXG4gIGlmIChwYWNrYWdlc0dsb2JzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgcm9vdCxcclxuICAgICAgcGFja2FnZXNHbG9icyxcclxuICAgICAgcGFja2FnZUxvY2F0aW9uczogW10sXHJcbiAgICAgIGhhc1R1cmJvLFxyXG4gICAgICB0eXBlOiAnc2luZ2xlLXBhY2thZ2UnIGFzIGNvbnN0LFxyXG4gICAgfTtcclxuICB9XHJcbiAgY29uc3QgcGFja2FnZUxvY2F0aW9ucyA9IGF3YWl0IGZnKFxyXG4gICAgcGFja2FnZXNHbG9icy5tYXAoKGdsb2IpID0+IGAke2dsb2J9L3BhY2thZ2UuanNvbmApLFxyXG4gICAge1xyXG4gICAgICBjd2Q6IHJvb3QsXHJcbiAgICB9XHJcbiAgKTtcclxuICByZXR1cm4ge1xyXG4gICAgcm9vdCxcclxuICAgIHBhY2thZ2VzR2xvYnMsXHJcbiAgICBwYWNrYWdlTG9jYXRpb25zOiBwYWNrYWdlTG9jYXRpb25zLm1hcCgobG9jYXRpb24pID0+IGRpcm5hbWUobG9jYXRpb24pKSxcclxuICAgIGhhc1R1cmJvLFxyXG4gICAgdHlwZTogJ211bHRpcGxlLXBhY2thZ2VzJyBhcyBjb25zdCxcclxuICB9O1xyXG59XHJcbiIsImltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xyXG5cclxuaW1wb3J0IHR5cGUgeyBDb25maWcgfSBmcm9tICdqZXN0JztcclxuaW1wb3J0IHsgZGVmYXVsdHMgfSBmcm9tICdqZXN0LWNvbmZpZyc7XHJcblxyXG5leHBvcnQgY29uc3QgZXh0ZW5zaW9ucyA9IFtcclxuICAnanMnLFxyXG4gICdjanMnLFxyXG4gICdtanMnLFxyXG4gICdqc3gnLFxyXG4gICd0cycsXHJcbiAgJ2N0cycsXHJcbiAgJ210cycsXHJcbiAgJ3RzeCcsXHJcbl07XHJcblxyXG5leHBvcnQgY29uc3QgaWdub3JlRGlycyA9IFsnL25vZGVfbW9kdWxlcy8nLCAnL2Rpc3QvJywgJy8udHNjLW91dC8nXTtcclxuXHJcbmV4cG9ydCBjb25zdCBqZXN0VHJhbnNmb3JtQ29uZmlnUHJvcCA9IChcclxuICBqZXN0UGx1Z2luUm9vdD86IHN0cmluZ1xyXG4pOiBQaWNrPENvbmZpZywgJ3RyYW5zZm9ybSc+ID0+IHtcclxuICBjb25zdCBlc2J1aWxkID0gamVzdFBsdWdpblJvb3RcclxuICAgID8gam9pbihqZXN0UGx1Z2luUm9vdCwgJ2VzYnVpbGQtamVzdCcpXHJcbiAgICA6ICdlc2J1aWxkLWplc3QnO1xyXG5cclxuICBjb25zdCBlc2J1aWxkRGVmYXVsdE9wdHMgPSB7XHJcbiAgICB0YXJnZXQ6IGBub2RlJHtwcm9jZXNzLnZlcnNpb25zLm5vZGV9YCxcclxuICAgIHNvdXJjZW1hcDogdHJ1ZSxcclxuICB9O1xyXG5cclxuICBjb25zdCBsb2FkZXJCeUV4dCA9IHtcclxuICAgIHRzOiB7IGxvYWRlcjogJ3RzJywgZm9ybWF0OiAnZXNtJyB9LFxyXG4gICAgY3RzOiB7IGxvYWRlcjogJ3RzJywgZm9ybWF0OiAnY2pzJyB9LFxyXG4gICAgbXRzOiB7IGxvYWRlcjogJ3RzJywgZm9ybWF0OiAnZXNtJyB9LFxyXG4gICAgY3RzeDogeyBsb2FkZXI6ICd0c3gnLCBmb3JtYXQ6ICdjanMnIH0sXHJcbiAgICBtdHN4OiB7IGxvYWRlcjogJ3RzeCcsIGZvcm1hdDogJ2VzbScgfSxcclxuICAgIHRzeDogeyBsb2FkZXI6ICd0c3gnLCBmb3JtYXQ6ICdlc20nIH0sXHJcbiAgfTtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIHRyYW5zZm9ybTogT2JqZWN0LmZyb21FbnRyaWVzKFxyXG4gICAgICBPYmplY3QuZW50cmllcyhsb2FkZXJCeUV4dCkubWFwKChbZXh0LCBvcHRzXSkgPT4gW1xyXG4gICAgICAgIGBeLitcXFxcLiR7ZXh0fSRgLFxyXG4gICAgICAgIFtcclxuICAgICAgICAgIGVzYnVpbGQsXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIC4uLmVzYnVpbGREZWZhdWx0T3B0cyxcclxuICAgICAgICAgICAgZm9ybWF0OiBvcHRzLmZvcm1hdCxcclxuICAgICAgICAgICAgbG9hZGVyczoge1xyXG4gICAgICAgICAgICAgIFtgLiR7ZXh0fWBdOiBvcHRzLmxvYWRlcixcclxuICAgICAgICAgICAgICBbYC50ZXN0LiR7ZXh0fWBdOiBvcHRzLmxvYWRlcixcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgXSlcclxuICAgICksXHJcbiAgfTtcclxufTtcclxuXHJcbmV4cG9ydCBjb25zdCBjb21tb25EZWZhdWx0czogQ29uZmlnID0ge1xyXG4gIGNhY2hlRGlyZWN0b3J5OiAnbm9kZV9tb2R1bGVzLy5qZXN0LWNhY2hlJyxcclxuICB0ZXN0UGF0aElnbm9yZVBhdHRlcm5zOiBbXHJcbiAgICAuLi5pZ25vcmVEaXJzLm1hcCgoZGlyKSA9PiBgPHJvb3REaXI+JHtkaXJ9YCksXHJcbiAgICAnPHJvb3REaXI+Ly4qL3Rlc3QtY2FzZXMvJyxcclxuICBdLFxyXG4gIHRyYW5zZm9ybUlnbm9yZVBhdHRlcm5zOiBbLi4uaWdub3JlRGlycy5tYXAoKGRpcikgPT4gYDxyb290RGlyPiR7ZGlyfWApXSxcclxuICBjb3ZlcmFnZVBhdGhJZ25vcmVQYXR0ZXJuczogWy4uLmlnbm9yZURpcnMubWFwKChkaXIpID0+IGA8cm9vdERpcj4ke2Rpcn1gKV0sXHJcbiAgbW9kdWxlUGF0aElnbm9yZVBhdHRlcm5zOiBbLi4uaWdub3JlRGlycy5tYXAoKGRpcikgPT4gYDxyb290RGlyPiR7ZGlyfWApXSxcclxuICBtb2R1bGVGaWxlRXh0ZW5zaW9uczogW1xyXG4gICAgLi4ubmV3IFNldChbLi4uZGVmYXVsdHMubW9kdWxlRmlsZUV4dGVuc2lvbnMsIC4uLmV4dGVuc2lvbnNdKSxcclxuICBdLFxyXG4gIGV4dGVuc2lvbnNUb1RyZWF0QXNFc206IFsnLmpzeCcsICcudHMnLCAnLm10cycsICcudHN4J10sXHJcbiAgcm9vdERpcjogcHJvY2Vzcy5jd2QoKSxcclxufTtcclxuXHJcbmNvbnN0IGZsYXZvclJlZ2V4ID0gL1xcdysvO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGN1c3RvbUZsYXZvclRlc3REZWZhdWx0cyhmbGF2b3I6IHN0cmluZyk6IENvbmZpZyB7XHJcbiAgaWYgKGZsYXZvciA9PT0gJ3VuaXQnKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZsYXZvciBjYW5ub3QgYmUgdW5pdCcpO1xyXG4gIH1cclxuICBpZiAoIWZsYXZvclJlZ2V4LnRlc3QoZmxhdm9yKSkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKGBGbGF2b3Igc2hvdWxkIG1hdGNoIC8ke2ZsYXZvclJlZ2V4LnNvdXJjZX0vYCk7XHJcbiAgfVxyXG4gIGNvbnN0IHJvb3RzID0gWyc8cm9vdERpcj4nLCAnPHJvb3REaXI+L3NyYyddO1xyXG4gIGNvbnN0IGZsYXZvclRlc3RHbG9icyA9IFtgX18ke2ZsYXZvcn1fXy8qKmBdO1xyXG4gIGNvbnN0IGV4dHMgPSBleHRlbnNpb25zLmpvaW4oJywnKTtcclxuICBjb25zdCBmbGF2b3JUZXN0TWF0Y2ggPSBmbGF2b3JUZXN0R2xvYnNcclxuICAgIC5mbGF0TWFwKChnbG9iKSA9PlxyXG4gICAgICByb290cy5tYXAoKHJvb3QpID0+IFtyb290LCBnbG9iXS5maWx0ZXIoQm9vbGVhbikuam9pbignLycpKVxyXG4gICAgKVxyXG4gICAgLm1hcCgoZ2xvYikgPT4gW2dsb2IsIGAqLnRlc3QueyR7ZXh0c319YF0uam9pbignLycpKTtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIHRlc3RNYXRjaDogZmxhdm9yVGVzdE1hdGNoLFxyXG4gICAgdGVzdFRpbWVvdXQ6IDQ1XzAwMCxcclxuICAgIHNsb3dUZXN0VGhyZXNob2xkOiAzMF8wMDAsXHJcbiAgICBjb3ZlcmFnZURpcmVjdG9yeTogYG5vZGVfbW9kdWxlcy8uY292ZXJhZ2UtJHtmbGF2b3J9YCxcclxuICAgIC4uLmNvbW1vbkRlZmF1bHRzLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiB1bml0VGVzdERlZmF1bHRzKCk6IENvbmZpZyB7XHJcbiAgY29uc3Qgcm9vdHMgPSBbJzxyb290RGlyPiddO1xyXG4gIGNvbnN0IHVuaXRUZXN0R2xvYnMgPSBbJyoqL19fdGVzdHNfXy8qKicsICcqKiddO1xyXG4gIGNvbnN0IGV4dHMgPSBleHRlbnNpb25zLmpvaW4oJywnKTtcclxuICBjb25zdCB1bml0VGVzdE1hdGNoID0gdW5pdFRlc3RHbG9ic1xyXG4gICAgLmZsYXRNYXAoKGdsb2IpID0+XHJcbiAgICAgIHJvb3RzLm1hcCgocm9vdCkgPT4gW3Jvb3QsIGdsb2JdLmZpbHRlcihCb29sZWFuKS5qb2luKCcvJykpXHJcbiAgICApXHJcbiAgICAubWFwKChnbG9iKSA9PiBbZ2xvYiwgYCoudGVzdC57JHtleHRzfX1gXS5qb2luKCcvJykpO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgdGVzdE1hdGNoOiB1bml0VGVzdE1hdGNoLFxyXG4gICAgY292ZXJhZ2VEaXJlY3Rvcnk6ICdub2RlX21vZHVsZXMvLmNvdmVyYWdlLXVuaXQnLFxyXG4gICAgLi4uY29tbW9uRGVmYXVsdHMsXHJcbiAgICB0ZXN0UGF0aElnbm9yZVBhdHRlcm5zOiBbXHJcbiAgICAgIC4uLihjb21tb25EZWZhdWx0cy50ZXN0UGF0aElnbm9yZVBhdHRlcm5zIHx8IFtdKSxcclxuICAgICAgYDxyb290RGlyPi8oPyFfX3Rlc3RzX18pKF9fW2EtekEtWjAtOV0rX18pL2AsXHJcbiAgICAgIGA8cm9vdERpcj4vc3JjLyg/IV9fdGVzdHNfXykoX19bYS16QS1aMC05XStfXykvYCxcclxuICAgIF0sXHJcbiAgfTtcclxufVxyXG4iLCJpbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnbm9kZTpjcnlwdG8nO1xyXG5pbXBvcnQgeyBta2Rpciwgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XHJcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gJ25vZGU6b3MnO1xyXG5pbXBvcnQgeyBqb2luLCByZXNvbHZlLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnO1xyXG5cclxuaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XHJcblxyXG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi4vdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeSc7XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVTY3JpcHQob3B0czoge1xyXG4gIHNjcmlwdDogJ3NldHVwJyB8ICd0ZWFyZG93bic7XHJcbiAgZmxhdm9yOiBzdHJpbmc7XHJcbiAgcm9vdERpcjogc3RyaW5nO1xyXG59KSB7XHJcbiAgY29uc3QgeyBmbGF2b3IsIHNjcmlwdCwgcm9vdERpciB9ID0gb3B0cztcclxuXHJcbiAgY29uc3Qgc3RyZWFtID0gZmcuc3RyZWFtKFxyXG4gICAgW2BfXyR7Zmxhdm9yfV9fLyR7c2NyaXB0fS50c2AsIGBzcmMvX18ke2ZsYXZvcn1fXy8ke3NjcmlwdH0udHNgXSxcclxuICAgIHtcclxuICAgICAgY3dkOiByb290RGlyLFxyXG4gICAgfVxyXG4gICkgYXMgQXN5bmNJdGVyYWJsZTxzdHJpbmc+O1xyXG5cclxuICBmb3IgYXdhaXQgKGNvbnN0IHNjcmlwdExvYyBvZiBzdHJlYW0pIHtcclxuICAgIGlmIChzY3JpcHRMb2MpIHtcclxuICAgICAgY29uc3Qgcm9vdCA9IG1vZHVsZVJvb3REaXJlY3RvcnkoKTtcclxuICAgICAgY29uc3QgbG9jYXRpb24gPSByZXNvbHZlKGpvaW4ocm9vdERpciwgc2NyaXB0TG9jKSk7XHJcblxyXG4gICAgICBjb25zdCBtb2R1bGVQYXRoID0gKGlucHV0OiBzdHJpbmcpID0+XHJcbiAgICAgICAgcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJ1xyXG4gICAgICAgICAgPyBgZmlsZTovLyR7aW5wdXQucmVwbGFjZUFsbChzZXAsICcvJyl9YFxyXG4gICAgICAgICAgOiBpbnB1dDtcclxuXHJcbiAgICAgIGNvbnN0IHNjcmlwdCA9IGBpbXBvcnQgeyBydW5Uc1NjcmlwdCB9IGZyb20gJHtKU09OLnN0cmluZ2lmeShcclxuICAgICAgICBtb2R1bGVQYXRoKGpvaW4ocm9vdCwgJ2NvbmZpZ3MvamVzdC9qZXN0Q29uZmlnSGVscGVycy5nZW4ubWpzJykpXHJcbiAgICAgICl9O1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKCkgPT4ge1xyXG5hd2FpdCBydW5Uc1NjcmlwdCh7XHJcbiAgbG9jYXRpb246ICR7SlNPTi5zdHJpbmdpZnkobG9jYXRpb24pfVxyXG59KVxyXG59YDtcclxuXHJcbiAgICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKCdzaGExJylcclxuICAgICAgICAudXBkYXRlKHJvb3REaXIpXHJcbiAgICAgICAgLnVwZGF0ZShmbGF2b3IpXHJcbiAgICAgICAgLnVwZGF0ZShzY3JpcHQpXHJcbiAgICAgICAgLmRpZ2VzdCgpXHJcbiAgICAgICAgLnRvU3RyaW5nKCdoZXgnKTtcclxuXHJcbiAgICAgIGNvbnN0IGRpciA9IGpvaW4odG1wZGlyKCksICdqZXN0LXNjcmlwdHMnKTtcclxuICAgICAgY29uc3QgZmlsZSA9IGpvaW4oZGlyLCBgJHtoYXNofS5tanNgKTtcclxuXHJcbiAgICAgIGF3YWl0IG1rZGlyKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XHJcblxyXG4gICAgICBhd2FpdCB3cml0ZUZpbGUoZmlsZSwgc2NyaXB0KTtcclxuXHJcbiAgICAgIHJldHVybiBmaWxlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHVuZGVmaW5lZDtcclxufVxyXG4iLCJpbXBvcnQgeyBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaXNEaXJlY3RvcnkocGF0aDogc3RyaW5nKSB7XHJcbiAgcmV0dXJuIHN0YXQocGF0aClcclxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0RpcmVjdG9yeSgpKVxyXG4gICAgLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XHJcbn1cclxuIiwiaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ3BhdGgnO1xyXG5cclxudHlwZSBVcHdhcmREaXJlY3RvcnlXYWxrT3B0cyA9IHtcclxuICBzdGFydDogc3RyaW5nO1xyXG4gIHN0b3BzPzogc3RyaW5nW107XHJcbiAgYXBwZW5kUGF0aD86IHN0cmluZztcclxuICB0ZXN0OiAocGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPGJvb2xlYW4gfCBzdHJpbmcgfCB1bmRlZmluZWQ+O1xyXG59O1xyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uKiB1cHdhcmREaXJlY3RvcnlXYWxrKG9wdHM6IFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzKSB7XHJcbiAgbGV0IGN1cnJlbnQgPSBvcHRzLnN0YXJ0O1xyXG4gIHdoaWxlIChcclxuICAgIGN1cnJlbnQgIT09ICcvJyAmJlxyXG4gICAgY3VycmVudCAhPT0gJ34vJyAmJlxyXG4gICAgIShvcHRzLnN0b3BzPy5pbmNsdWRlcyhjdXJyZW50KSA/PyBmYWxzZSlcclxuICApIHtcclxuICAgIGNvbnN0IHBhdGggPSBvcHRzLmFwcGVuZFBhdGggPyBqb2luKGN1cnJlbnQsIG9wdHMuYXBwZW5kUGF0aCkgOiBjdXJyZW50O1xyXG4gICAgY29uc3QgY2FuZGlkYXRlID0gYXdhaXQgb3B0cy50ZXN0KHBhdGgpO1xyXG4gICAgaWYgKGNhbmRpZGF0ZSkge1xyXG4gICAgICB5aWVsZCB0eXBlb2YgY2FuZGlkYXRlID09PSAnc3RyaW5nJyA/IGNhbmRpZGF0ZSA6IHBhdGg7XHJcbiAgICB9XHJcbiAgICBjdXJyZW50ID0gZGlybmFtZShjdXJyZW50KTtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cHdhcmREaXJlY3RvcnlTZWFyY2gob3B0czogVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMpIHtcclxuICBjb25zdCB3YWxrID0gdXB3YXJkRGlyZWN0b3J5V2FsayhvcHRzKTtcclxuICBmb3IgYXdhaXQgKGNvbnN0IGRpciBvZiB3YWxrKSB7XHJcbiAgICByZXR1cm4gZGlyO1xyXG4gIH1cclxuICByZXR1cm4gdW5kZWZpbmVkO1xyXG59XHJcbiIsImltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xyXG5cclxuaW1wb3J0IHsgaXNEaXJlY3RvcnkgfSBmcm9tICcuL2lzRGlyZWN0b3J5JztcclxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4vbW9kdWxlUm9vdERpcmVjdG9yeSc7XHJcbmltcG9ydCB7IHVwd2FyZERpcmVjdG9yeVNlYXJjaCB9IGZyb20gJy4vdXB3YXJkRGlyZWN0b3J5U2VhcmNoJztcclxuXHJcbmV4cG9ydCB7IHJlYWRQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xyXG5leHBvcnQgeyBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24gfSBmcm9tICcuL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbic7XHJcbmV4cG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vcmVwb3NpdG9yeVJvb3RQYXRoJztcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGxvb2t1cChvcHRzOiB7IHBhdGg6IHN0cmluZzsgbG9va3VwUGFja2FnZU5hbWU6IHN0cmluZyB9KSB7XHJcbiAgcmV0dXJuIGF3YWl0IHVwd2FyZERpcmVjdG9yeVNlYXJjaCh7XHJcbiAgICBzdGFydDogbW9kdWxlUm9vdERpcmVjdG9yeSgpLFxyXG4gICAgYXBwZW5kUGF0aDogam9pbignbm9kZV9tb2R1bGVzJywgb3B0cy5sb29rdXBQYWNrYWdlTmFtZSksXHJcbiAgICB0ZXN0OiBpc0RpcmVjdG9yeSxcclxuICB9KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIExvb2t1cCBsb2NhdGlvbiBmb3IgZGV2RGVwZW5kZW5jaWVzIG9mIFwiQHJlcGthLWtpdC90c1wiIC0gdGhpcyBmdW5jdGlvbiB3aWxsXHJcbiAqIGxvb2t1cCBmb3IgXCJvcHRzLmxvb2t1cFBhY2thZ2VOYW1lXCJcclxuICovXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmaW5kRGV2RGVwZW5kZW5jeShvcHRzOiB7IGxvb2t1cFBhY2thZ2VOYW1lOiBzdHJpbmcgfSkge1xyXG4gIGNvbnN0IGxvb2t1cFBhY2thZ2VOYW1lID0gb3B0cy5sb29rdXBQYWNrYWdlTmFtZTtcclxuXHJcbiAgcmV0dXJuIGF3YWl0IGxvb2t1cCh7XHJcbiAgICBwYXRoOiBtb2R1bGVSb290RGlyZWN0b3J5KCksXHJcbiAgICBsb29rdXBQYWNrYWdlTmFtZSxcclxuICB9KTtcclxufVxyXG4iLCJpbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcclxuXHJcbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XHJcblxyXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcclxuaW1wb3J0IHsgZmluZERldkRlcGVuZGVuY3kgfSBmcm9tICcuLi91dGlscy9maW5kRGV2RGVwZW5kZW5jeSc7XHJcblxyXG5leHBvcnQgY29uc3QgamVzdFBsdWdpblJvb3QgPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xyXG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZpbmREZXZEZXBlbmRlbmN5KHtcclxuICAgIGxvb2t1cFBhY2thZ2VOYW1lOiAnZXNidWlsZC1qZXN0JyxcclxuICB9KTtcclxuICBpZiAoIXJlc3VsdCkge1xyXG4gICAgbG9nZ2VyLndhcm4oXHJcbiAgICAgICdKZXN0IHBsdWdpbnMgcm9vdCBjYW5ub3QgYmUgZGV0ZXJtaW5lZC4gRG8geW91IGhhdmUgXCJAcmVwa2Eta2l0L3RzXCIgaW4gZGV2RGVwZW5kZW5jaWVzIGF0IHRoZSBtb25vcmVwbyByb290IG9yIGF0IHRoZSBsb2NhbCBwYWNrYWdlPydcclxuICAgICk7XHJcbiAgfSBlbHNlIHtcclxuICAgIGlmIChsb2dnZXIubG9nTGV2ZWwgPT09ICdkZWJ1ZycpIHtcclxuICAgICAgbG9nZ2VyLmRlYnVnKCdGb3VuZCBqZXN0IHBsdWdpbnMgcm9vdCBhdCcsIGRpcm5hbWUocmVzdWx0KSk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiByZXN1bHQgPyBkaXJuYW1lKHJlc3VsdCkgOiAnLic7XHJcbn0pO1xyXG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcclxuXHJcbmltcG9ydCB0eXBlIHsgQ29uZmlnIH0gZnJvbSAnamVzdCc7XHJcbmltcG9ydCB7IHJlYWRJbml0aWFsT3B0aW9ucyB9IGZyb20gJ2plc3QtY29uZmlnJztcclxuXHJcbmltcG9ydCB7IHJlYWRQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xyXG5pbXBvcnQgeyBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24gfSBmcm9tICcuLi91dGlscy9sb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24nO1xyXG5pbXBvcnQge1xyXG4gIGN1c3RvbUZsYXZvclRlc3REZWZhdWx0cyxcclxuICBqZXN0VHJhbnNmb3JtQ29uZmlnUHJvcCxcclxuICB1bml0VGVzdERlZmF1bHRzLFxyXG59IGZyb20gJy4vY29uZmlnQnVpbGRpbmdCbG9ja3MnO1xyXG5pbXBvcnQgeyBnZW5lcmF0ZVNjcmlwdCB9IGZyb20gJy4vZ2VuZXJhdGVTY3JpcHQnO1xyXG5pbXBvcnQgeyBqZXN0UGx1Z2luUm9vdCB9IGZyb20gJy4vamVzdFBsdWdpblJvb3QnO1xyXG5cclxuZXhwb3J0IHR5cGUgVGVzdEZsYXZvciA9XHJcbiAgfCAndW5pdCdcclxuICB8ICdpbnRlZ3JhdGlvbidcclxuICB8IChzdHJpbmcgJiB7XHJcbiAgICAgICQkY3VzdG9tOiBuZXZlcjtcclxuICAgIH0pO1xyXG5cclxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQ29uZmlnKFxyXG4gIGZsYXZvcjogVGVzdEZsYXZvcixcclxuICByb290RGlyOiBzdHJpbmcsXHJcbiAgcGFyZW50Um9vdERpcj86IHN0cmluZ1xyXG4pIHtcclxuICBjb25zdCBwbHVnaW5Sb290ID0gamVzdFBsdWdpblJvb3QoKTtcclxuXHJcbiAgY29uc3QgYmFzZUNvbmZpZyA9XHJcbiAgICBmbGF2b3IgPT09ICd1bml0JyA/IHVuaXRUZXN0RGVmYXVsdHMoKSA6IGN1c3RvbUZsYXZvclRlc3REZWZhdWx0cyhmbGF2b3IpO1xyXG5cclxuICBjb25zdCBnbG9iYWxTZXR1cCA9IGdlbmVyYXRlU2NyaXB0KHtcclxuICAgIHNjcmlwdDogJ3NldHVwJyxcclxuICAgIGZsYXZvcixcclxuICAgIHJvb3REaXIsXHJcbiAgfSk7XHJcblxyXG4gIGNvbnN0IGdsb2JhbFRlYXJkb3duID0gZ2VuZXJhdGVTY3JpcHQoe1xyXG4gICAgc2NyaXB0OiAndGVhcmRvd24nLFxyXG4gICAgZmxhdm9yLFxyXG4gICAgcm9vdERpcixcclxuICB9KTtcclxuXHJcbiAgcHJvY2Vzcy5lbnZbJ1RFU1RfRkxBVk9SJ10gPSBmbGF2b3I7XHJcblxyXG4gIGNvbnN0IGplc3RDb25maWcgPSByZWFkSW5pdGlhbE9wdGlvbnModW5kZWZpbmVkLCB7XHJcbiAgICBwYWNrYWdlUm9vdE9yQ29uZmlnOiByb290RGlyLFxyXG4gICAgcGFyZW50Q29uZmlnRGlybmFtZTogcGFyZW50Um9vdERpcixcclxuICAgIHJlYWRGcm9tQ3dkOiBmYWxzZSxcclxuICAgIHNraXBNdWx0aXBsZUNvbmZpZ0Vycm9yOiB0cnVlLFxyXG4gIH0pO1xyXG5cclxuICBjb25zdCByZXNvbHZlZENvbmZpZyA9IChhd2FpdCBqZXN0Q29uZmlnKS5jb25maWc7XHJcblxyXG4gIGNvbnN0IGNvbmZpZyA9IHtcclxuICAgIC4uLmJhc2VDb25maWcsXHJcbiAgICAuLi5qZXN0VHJhbnNmb3JtQ29uZmlnUHJvcChhd2FpdCBwbHVnaW5Sb290KSxcclxuICAgIC4uLnJlc29sdmVkQ29uZmlnLFxyXG4gICAgZ2xvYmFsU2V0dXA6IGF3YWl0IGdsb2JhbFNldHVwLFxyXG4gICAgZ2xvYmFsVGVhcmRvd246IGF3YWl0IGdsb2JhbFRlYXJkb3duLFxyXG4gIH07XHJcblxyXG4gIHJldHVybiBjb25maWc7XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVKZXN0Q29uZmlnRm9yU2luZ2xlUGFja2FnZSh7XHJcbiAgZmxhdm9yID0gJ3VuaXQnLFxyXG4gIHJvb3REaXIgPSBwcm9jZXNzLmN3ZCgpLFxyXG59OiB7XHJcbiAgZmxhdm9yOiBUZXN0Rmxhdm9yO1xyXG4gIHJvb3REaXI/OiBzdHJpbmc7XHJcbn0pOiBQcm9taXNlPENvbmZpZz4ge1xyXG4gIHJldHVybiBhd2FpdCBjcmVhdGVDb25maWcoZmxhdm9yLCByb290RGlyKTtcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUplc3RDb25maWdGb3JNb25vcmVwbyh7XHJcbiAgZmxhdm9yID0gJ3VuaXQnLFxyXG4gIGN3ZCA9IHByb2Nlc3MuY3dkKCksXHJcbn06IHtcclxuICBmbGF2b3I6IFRlc3RGbGF2b3I7XHJcbiAgY3dkOiBzdHJpbmc7XHJcbn0pOiBQcm9taXNlPENvbmZpZz4ge1xyXG4gIGNvbnN0IHJlcG9Db25maWcgPSBhd2FpdCBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24oKTtcclxuXHJcbiAgaWYgKHJlcG9Db25maWcudHlwZSA9PT0gJ3NpbmdsZS1wYWNrYWdlJykge1xyXG4gICAgcmV0dXJuIGNyZWF0ZUplc3RDb25maWdGb3JTaW5nbGVQYWNrYWdlKHtcclxuICAgICAgZmxhdm9yLFxyXG4gICAgICByb290RGlyOiByZXBvQ29uZmlnLnJvb3QsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGlmIChyZXBvQ29uZmlnLnJvb3QgIT09IGN3ZCkge1xyXG4gICAgcmV0dXJuIGNyZWF0ZUplc3RDb25maWdGb3JTaW5nbGVQYWNrYWdlKHsgZmxhdm9yLCByb290RGlyOiBjd2QgfSk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBwcm9qZWN0cyA9IChcclxuICAgIGF3YWl0IFByb21pc2UuYWxsKFxyXG4gICAgICByZXBvQ29uZmlnLnBhY2thZ2VMb2NhdGlvbnMubWFwKGFzeW5jIChsb2NhdGlvbikgPT4ge1xyXG4gICAgICAgIGNvbnN0IGJhc2VDb25maWcgPSBjcmVhdGVDb25maWcoZmxhdm9yLCBsb2NhdGlvbiwgY3dkKTtcclxuICAgICAgICBjb25zdCBwYWNrYWdlSnNvbiA9IHJlYWRQYWNrYWdlSnNvbihqb2luKGxvY2F0aW9uLCAncGFja2FnZS5qc29uJykpO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAuLi4oYXdhaXQgYmFzZUNvbmZpZyksXHJcbiAgICAgICAgICByb290RGlyOiBsb2NhdGlvbixcclxuICAgICAgICAgIGRpc3BsYXlOYW1lOiAoYXdhaXQgcGFja2FnZUpzb24pLm5hbWUsXHJcbiAgICAgICAgfTtcclxuICAgICAgfSlcclxuICAgIClcclxuICApLmZpbHRlcihCb29sZWFuKTtcclxuXHJcbiAgY29uc3QgdGVzdFRpbWVvdXQgPSBwcm9qZWN0cy5yZWR1Y2UoXHJcbiAgICAoYWNjLCBwcm9qZWN0KSA9PlxyXG4gICAgICBNYXRoLm1heChcclxuICAgICAgICBhY2MsXHJcbiAgICAgICAgdHlwZW9mIHByb2plY3QudGVzdFRpbWVvdXQgPT09ICdudW1iZXInID8gcHJvamVjdC50ZXN0VGltZW91dCA6IDBcclxuICAgICAgKSxcclxuICAgIDBcclxuICApO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgLi4uKHRlc3RUaW1lb3V0ICE9PSAwICYmIHtcclxuICAgICAgdGVzdFRpbWVvdXQsXHJcbiAgICB9KSxcclxuICAgIHByb2plY3RzOiBwcm9qZWN0cy5tYXAoXHJcbiAgICAgICh7IGNvdmVyYWdlRGlyZWN0b3J5LCB0ZXN0VGltZW91dCwgLi4ucHJvamVjdCB9KSA9PiBwcm9qZWN0XHJcbiAgICApLFxyXG4gIH07XHJcbn1cclxuIl0sIm5hbWVzIjpbInBhdGgiLCJyZXN1bHQiLCJzY3JpcHQiLCJ0ZXN0VGltZW91dCJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7OztBQUNPLFNBQVMsYUFBYSxHQUFxQixFQUFBO0FBQ2hELEVBQU8sT0FBQSxHQUFBLENBQUksT0FBUSxDQUFBLHFCQUFBLEVBQXVCLE1BQU0sQ0FBQSxDQUFBO0FBQ2xEOztBQ0hPLFNBQVMsU0FDZCxLQUN5QixFQUFBO0FBQ3pCLEVBQUEsT0FBTyxRQUFRLEtBQUssQ0FBQSxDQUFBO0FBQ3RCOztBQ0pPLFNBQVMsS0FBUSxFQUFzQixFQUFBO0FBQzVDLEVBQUksSUFBQSxLQUFBLENBQUE7QUFDSixFQUFBLElBQUksVUFBYSxHQUFBLEtBQUEsQ0FBQTtBQUNqQixFQUFBLE9BQU8sTUFBUztBQUNkLElBQUEsSUFBSSxVQUFZLEVBQUE7QUFDZCxNQUFPLE9BQUEsS0FBQSxDQUFBO0FBQUEsS0FDVDtBQUNBLElBQUEsS0FBQSxHQUFRLEVBQUcsRUFBQSxDQUFBO0FBQ1gsSUFBYSxVQUFBLEdBQUEsSUFBQSxDQUFBO0FBQ2IsSUFBTyxPQUFBLEtBQUEsQ0FBQTtBQUFBLEdBQ1QsQ0FBQTtBQUNGOztBQ1hPLFNBQVMsVUFBYSxFQUE0QyxFQUFBO0FBQ3ZFLEVBQUksSUFBQSxLQUFBLENBQUE7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
