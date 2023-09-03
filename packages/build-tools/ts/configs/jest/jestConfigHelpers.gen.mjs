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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL2VzY2FwZVJlZ0V4cC50cyIsIi4uLy4uLy4uLy4uL3V0aWxzL3RzL3NyYy9pc1RydXRoeS50cyIsIi4uLy4uLy4uLy4uL3V0aWxzL3RzL3NyYy9vbmNlLnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL29uY2VBc3luYy50cyIsIi4uLy4uL3NyYy9sb2dnZXIvbG9nZ2VyLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3N0YWNrVHJhY2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blRvUHJvbWlzZS50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduUmVzdWx0LnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25PdXRwdXQudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeS50cyIsIi4uLy4uL3NyYy91dGlscy9iaW5QYXRoLnRzIiwiLi4vLi4vc3JjL3J1blRzU2NyaXB0LnRzIiwiLi4vLi4vc3JjL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24udHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoLnRzIiwiLi4vLi4vc3JjL3R1cmJvLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy9qZXN0L2NvbmZpZ0J1aWxkaW5nQmxvY2tzLnRzIiwiLi4vLi4vc3JjL2plc3QvZ2VuZXJhdGVTY3JpcHQudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNEaXJlY3RvcnkudHMiLCIuLi8uLi9zcmMvdXRpbHMvdXB3YXJkRGlyZWN0b3J5U2VhcmNoLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2ZpbmREZXZEZXBlbmRlbmN5LnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdFBsdWdpblJvb3QudHMiLCIuLi8uLi9zcmMvamVzdC9jcmVhdGVKZXN0Q29uZmlnLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIGh0dHBzOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzM0NDYxNzAvZXNjYXBlLXN0cmluZy1mb3ItdXNlLWluLWphdmFzY3JpcHQtcmVnZXhcclxuZXhwb3J0IGZ1bmN0aW9uIGVzY2FwZVJlZ0V4cChzdHI6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xyXG59XHJcbiIsImV4cG9ydCBmdW5jdGlvbiBpc1RydXRoeTxUPihcclxuICB2YWx1ZTogTm9uTnVsbGFibGU8VD4gfCBmYWxzZSB8IG51bGwgfCB1bmRlZmluZWQgfCAnJyB8IDBcclxuKTogdmFsdWUgaXMgTm9uTnVsbGFibGU8VD4ge1xyXG4gIHJldHVybiBCb29sZWFuKHZhbHVlKTtcclxufVxyXG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZTxUPihmbjogKCkgPT4gVCk6ICgpID0+IFQge1xyXG4gIGxldCB2YWx1ZTogVDtcclxuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xyXG4gIHJldHVybiAoKTogVCA9PiB7XHJcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xyXG4gICAgICByZXR1cm4gdmFsdWU7XHJcbiAgICB9XHJcbiAgICB2YWx1ZSA9IGZuKCk7XHJcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcclxuICAgIHJldHVybiB2YWx1ZTtcclxuICB9O1xyXG59XHJcbiIsImV4cG9ydCBmdW5jdGlvbiBvbmNlQXN5bmM8VD4oZm46ICgpID0+IFQgfCBQcm9taXNlPFQ+KTogKCkgPT4gUHJvbWlzZTxUPiB7XHJcbiAgbGV0IHZhbHVlOiBUO1xyXG4gIGxldCBpbkZsaWdodDogUHJvbWlzZTxUPiB8IG51bGw7XHJcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcclxuICByZXR1cm4gYXN5bmMgKCk6IFByb21pc2U8VD4gPT4ge1xyXG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcclxuICAgICAgcmV0dXJuIHZhbHVlO1xyXG4gICAgfVxyXG4gICAgaWYgKGluRmxpZ2h0KSB7XHJcbiAgICAgIHJldHVybiBpbkZsaWdodDtcclxuICAgIH1cclxuICAgIGluRmxpZ2h0ID0gUHJvbWlzZS5yZXNvbHZlKGZuKCkpO1xyXG4gICAgdmFsdWUgPSBhd2FpdCBpbkZsaWdodDtcclxuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xyXG4gICAgaW5GbGlnaHQgPSBudWxsO1xyXG4gICAgcmV0dXJuIHZhbHVlO1xyXG4gIH07XHJcbn1cclxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XHJcblxyXG5jb25zdCBsZXZlbHMgPSBbJ2RlYnVnJywgJ2luZm8nLCAnd2FybicsICdlcnJvcicsICdmYXRhbCddIGFzIGNvbnN0O1xyXG5cclxudHlwZSBMb2dMZXZlbCA9IHR5cGVvZiBsZXZlbHNbbnVtYmVyXTtcclxuXHJcbnR5cGUgUGFyYW1zID0gUGFyYW1ldGVyczx0eXBlb2YgY29uc29sZS5sb2c+O1xyXG5cclxudHlwZSBMb2dnZXIgPSB7XHJcbiAgbG9nTGV2ZWw6IExvZ0xldmVsO1xyXG4gIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcclxuICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcclxuICAvLyBhbGlhcyBmb3IgaW5mb1xyXG4gIGxvZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XHJcbiAgLy8gc3BlY2lhbCB0cmVhdG1lbnQsIGRpc2FibGVkIG9uIENJL1RUWVxyXG4gIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XHJcbiAgd2FybiguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XHJcbiAgZXJyb3IoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xyXG4gIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcclxufTtcclxuXHJcbmNvbnN0IGVuYWJsZWRMZXZlbHNBZnRlciA9IChsZXZlbDogTG9nTGV2ZWwgfCAnb2ZmJykgPT4ge1xyXG4gIGlmIChsZXZlbCA9PT0gJ29mZicpIHtcclxuICAgIHJldHVybiBbXTtcclxuICB9XHJcbiAgY29uc3QgaW5kZXggPSBsZXZlbHMuZmluZEluZGV4KChpdGVtKSA9PiBpdGVtID09PSBsZXZlbCk7XHJcbiAgaWYgKGluZGV4ID09PSAtMSkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxldmVsJyk7XHJcbiAgfVxyXG4gIHJldHVybiBsZXZlbHMuc2xpY2UoaW5kZXgpO1xyXG59O1xyXG5cclxuY29uc3QgaXNMZXZlbCA9IChsZXZlbD86IHN0cmluZyk6IGxldmVsIGlzIExvZ0xldmVsID0+IHtcclxuICByZXR1cm4gbGV2ZWxzLmluY2x1ZGVzKGxldmVsIGFzIExvZ0xldmVsKTtcclxufTtcclxuXHJcbmNvbnN0IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncyA9IChcclxuICBhcmdzID0gcHJvY2Vzcy5hcmd2XHJcbik6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xyXG4gIGNvbnN0IGluZGV4ID0gYXJncy5maW5kSW5kZXgoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gJy0tbG9nLWxldmVsJyk7XHJcbiAgaWYgKGluZGV4ID09PSAtMSkge1xyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICB9XHJcbiAgY29uc3QgbGV2ZWwgPSBhcmdzW2luZGV4ICsgMV07XHJcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcclxuICAgIHJldHVybiAnb2ZmJztcclxuICB9XHJcbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICB9XHJcbiAgcmV0dXJuIGxldmVsO1xyXG59O1xyXG5cclxuY29uc3QgdmVyYm9zaXR5RnJvbUVudiA9ICgpOiBMb2dMZXZlbCB8ICdvZmYnIHwgdW5kZWZpbmVkID0+IHtcclxuICBjb25zdCBsZXZlbCA9IHByb2Nlc3MuZW52WydMT0dfTEVWRUwnXTtcclxuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xyXG4gICAgcmV0dXJuICdvZmYnO1xyXG4gIH1cclxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gIH1cclxuICByZXR1cm4gbGV2ZWw7XHJcbn07XHJcblxyXG5jb25zdCBnZXRWZXJib3NpdHlDb25maWcgPSAoKSA9PiB7XHJcbiAgY29uc3QgYXJnc0xldmVsID0gdmVyYm9zaXR5RnJvbVByb2Nlc3NBcmdzKCk7XHJcbiAgY29uc3QgZW52TGV2ZWwgPSB2ZXJib3NpdHlGcm9tRW52KCk7XHJcbiAgcmV0dXJuIGFyZ3NMZXZlbCA/PyBlbnZMZXZlbCA/PyAnaW5mbyc7XHJcbn07XHJcblxyXG5jb25zdCBub29wID0gKC4uLl9hcmdzOiBQYXJhbXMpID0+IHtcclxuICByZXR1cm47XHJcbn07XHJcblxyXG5jb25zdCBsb2cgPSAoLi4uYXJnczogUGFyYW1zKSA9PiB7XHJcbiAgY29uc29sZS5sb2coLi4uYXJncyk7XHJcbn07XHJcblxyXG5jb25zdCBlcnJvciA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcclxuICBjb25zb2xlLmVycm9yKC4uLmFyZ3MpO1xyXG59O1xyXG5cclxuY29uc3Qgc2hvdWxkRW5hYmxlVGlwID0gKCkgPT4gIXByb2Nlc3MuZW52WydDSSddICYmICFwcm9jZXNzLnN0ZG91dC5pc1RUWTtcclxuXHJcbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoXHJcbiAgZGVwcyA9IHsgZ2V0VmVyYm9zaXR5Q29uZmlnLCBsb2csIGVycm9yLCBzaG91bGRFbmFibGVUaXAgfVxyXG4pID0+IHtcclxuICBjb25zdCBsb2dMZXZlbCA9IGRlcHMuZ2V0VmVyYm9zaXR5Q29uZmlnKCk7XHJcbiAgY29uc3QgZW5hYmxlZCA9IGVuYWJsZWRMZXZlbHNBZnRlcihsb2dMZXZlbCk7XHJcbiAgcmV0dXJuIGxldmVscy5yZWR1Y2UoXHJcbiAgICAoYWNjLCBsdmwpID0+IHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICAuLi5hY2MsXHJcbiAgICAgICAgW2x2bF06IGVuYWJsZWQuaW5jbHVkZXMobHZsKVxyXG4gICAgICAgICAgPyBbJ2ZhdGFsJywgJ2Vycm9yJ10uaW5jbHVkZXMobHZsKVxyXG4gICAgICAgICAgICA/IGRlcHMuZXJyb3JcclxuICAgICAgICAgICAgOiBkZXBzLmxvZ1xyXG4gICAgICAgICAgOiBub29wLFxyXG4gICAgICB9O1xyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgbG9nTGV2ZWwsXHJcbiAgICAgIGxvZzogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpID8gZGVwcy5sb2cgOiBub29wLFxyXG4gICAgICB0aXA6IGVuYWJsZWQuaW5jbHVkZXMoJ2luZm8nKSAmJiBkZXBzLnNob3VsZEVuYWJsZVRpcCgpID8gZGVwcy5sb2cgOiBub29wLFxyXG4gICAgfSBhcyBMb2dnZXJcclxuICApO1xyXG59O1xyXG5cclxuY29uc3QgY3JlYXRlRGVsZWdhdGluZ0xvZ2dlciA9IChvcHRzOiB7IHBhcmVudDogTG9nZ2VyIH0pOiBMb2dnZXIgPT5cclxuICBPYmplY3QuZnJlZXplKHtcclxuICAgIGdldCBsb2dMZXZlbCgpIHtcclxuICAgICAgcmV0dXJuIG9wdHMucGFyZW50LmxvZ0xldmVsO1xyXG4gICAgfSxcclxuICAgIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XHJcbiAgICAgIG9wdHMucGFyZW50LmRlYnVnKC4uLnBhcmFtcyk7XHJcbiAgICB9LFxyXG4gICAgaW5mbyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xyXG4gICAgICBvcHRzLnBhcmVudC5pbmZvKC4uLnBhcmFtcyk7XHJcbiAgICB9LFxyXG4gICAgbG9nKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XHJcbiAgICAgIG9wdHMucGFyZW50LmxvZyguLi5wYXJhbXMpO1xyXG4gICAgfSxcclxuICAgIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xyXG4gICAgICBvcHRzLnBhcmVudC50aXAoLi4ucGFyYW1zKTtcclxuICAgIH0sXHJcbiAgICB3YXJuKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XHJcbiAgICAgIG9wdHMucGFyZW50Lndhcm4oLi4ucGFyYW1zKTtcclxuICAgIH0sXHJcbiAgICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xyXG4gICAgICBvcHRzLnBhcmVudC5lcnJvciguLi5wYXJhbXMpO1xyXG4gICAgfSxcclxuICAgIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XHJcbiAgICAgIG9wdHMucGFyZW50LmZhdGFsKC4uLnBhcmFtcyk7XHJcbiAgICB9LFxyXG4gIH0pO1xyXG5cclxubGV0IGRlZmF1bHRMb2dnZXJGYWN0b3J5OiAoKCkgPT4gTG9nZ2VyKSB8IG51bGw7XHJcblxyXG5leHBvcnQgY29uc3QgY29uZmlndXJlRGVmYXVsdExvZ2dlciA9IChmYWN0b3J5OiAoKSA9PiBMb2dnZXIpID0+IHtcclxuICBpZiAoZGVmYXVsdExvZ2dlckZhY3RvcnkpIHtcclxuICAgIGNvbnN0IGVycm9yID0ge1xyXG4gICAgICBzdGFjazogJycsXHJcbiAgICB9O1xyXG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UoZXJyb3IpO1xyXG4gICAgbG9nZ2VyLmRlYnVnKCdDYW5ub3Qgb3ZlcnJpZGUgZGVmYXVsdCBsb2dnZXIgbXVsdGlwbGUgdGltZXMnLCBlcnJvci5zdGFjayk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGRlZmF1bHRMb2dnZXJGYWN0b3J5ID0gZmFjdG9yeTtcclxufTtcclxuXHJcbmNvbnN0IGRlZmF1bHRMb2dnZXIgPSBvbmNlKCgpID0+IHtcclxuICBsZXQgZmFjdG9yeSA9IGRlZmF1bHRMb2dnZXJGYWN0b3J5O1xyXG4gIGlmICghZmFjdG9yeSkge1xyXG4gICAgZmFjdG9yeSA9ICgpID0+IGNyZWF0ZUxvZ2dlcigpO1xyXG4gIH1cclxuICByZXR1cm4gZmFjdG9yeSgpO1xyXG59KTtcclxuXHJcbi8qKlxyXG4gKiBEZWZhdWx0IGxvZ2dlciBpbnN0YW5jZSBjYW4gYmUgY29uZmlndXJlZCBvbmNlIGF0IHN0YXJ0dXBcclxuICovXHJcbmV4cG9ydCBjb25zdCBsb2dnZXI6IExvZ2dlciA9IGNyZWF0ZURlbGVnYXRpbmdMb2dnZXIoe1xyXG4gIGdldCBwYXJlbnQoKSB7XHJcbiAgICByZXR1cm4gZGVmYXVsdExvZ2dlcigpO1xyXG4gIH0sXHJcbn0pO1xyXG4iLCIvKipcclxuICogQ2FwdHVyZSB0aGUgc3RhY2sgdHJhY2UgYW5kIGFsbG93IHRvIGVucmljaCBleGNlcHRpb25zIHRocm93biBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2tzXHJcbiAqIHdpdGggYWRkaXRpb25hbCBzdGFjayBpbmZvcm1hdGlvbiBjYXB0dXJlZCBhdCB0aGUgbW9tZW50IG9mIHRoZSBjYWxsIG9mIHRoaXMgZnVuY3Rpb25cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjYXB0dXJlU3RhY2tUcmFjZShyZW1vdmUgPSAwKSB7XHJcbiAgY29uc3Qgc3RhY2tDb250YWluZXIgPSB7XHJcbiAgICBzdGFjazogJycsXHJcbiAgfTtcclxuICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShzdGFja0NvbnRhaW5lcik7XHJcbiAgY29uc3Qgc3RhY2tUcmFjZSA9IHN0YWNrQ29udGFpbmVyLnN0YWNrXHJcbiAgICAuc3BsaXQoJ1xcbicpXHJcbiAgICAuc2xpY2UoNiArIHJlbW92ZSlcclxuICAgIC5qb2luKCdcXG4nKTtcclxuICByZXR1cm4ge1xyXG4gICAgLyoqXHJcbiAgICAgKiBDYXB0dXJlZCBzdGFjayB0cmFjZSBpbmZvcm1hdGlvblxyXG4gICAgICovXHJcbiAgICBzdGFja1RyYWNlLFxyXG4gICAgLyoqXHJcbiAgICAgKiBDYW4gYmUgY2FsbGVkIGluIGFzeW5jaHJvbm91cyBjYWxsYmFjayB0byBlbnJpY2ggZXhjZXB0aW9ucyB3aXRoIGFkZGl0aW9uYWwgaW5mb3JtYXRpb25cclxuICAgICAqIEBwYXJhbSBlcnIgRXhjZXB0aW9uIHRvIGVucmljaCAtIGl0IGlzIGdvaW5nIHRvIGhhdmUgaXRzIGAuc3RhY2tgIHByb3AgbXV0YXRlZFxyXG4gICAgICogQHJldHVybnMgU2FtZSBleGNlcHRpb25cclxuICAgICAqL1xyXG4gICAgcHJlcGFyZUZvclJldGhyb3c6IChlcnI6IEVycm9yKSA9PiB7XHJcbiAgICAgIGNvbnN0IG9sZFN0YWNrVHJhY2UgPSBlcnIuc3RhY2sgPz8gJycuc3BsaXQoJ1xcbicpLnNsaWNlKDEpLmpvaW4oJ1xcbicpO1xyXG4gICAgICBlcnIuc3RhY2sgPSBgJHtlcnIubmFtZSB8fCAnRXJyb3InfTogJHtcclxuICAgICAgICBlcnIubWVzc2FnZVxyXG4gICAgICB9XFxuJHtvbGRTdGFja1RyYWNlfVxcbiR7c3RhY2tUcmFjZX1gO1xyXG4gICAgICByZXR1cm4gZXJyO1xyXG4gICAgfSxcclxuICB9O1xyXG59XHJcbiIsImltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XHJcbmltcG9ydCB7IENoaWxkUHJvY2VzcyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xyXG5pbXBvcnQgeyBzcGF3biB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xyXG5pbXBvcnQgdHlwZSB7IEFzc2lnbiB9IGZyb20gJ3V0aWxpdHktdHlwZXMnO1xyXG5cclxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XHJcbmltcG9ydCB7IGNhcHR1cmVTdGFja1RyYWNlIH0gZnJvbSAnLi4vdXRpbHMvc3RhY2tUcmFjZSc7XHJcblxyXG5leHBvcnQgdHlwZSBTcGF3blRvUHJvbWlzZU9wdHMgPSB7XHJcbiAgLyoqXHJcbiAgICogU3BlY2lmeSBleGl0IGNvZGVzIHdoaWNoIHNob3VsZCBub3QgcmVzdWx0IGluIHRocm93aW5nIGFuIGVycm9yIHdoZW5cclxuICAgKiB0aGUgcHJvY2VzcyBoYXMgZmluaXNoZWQsIGUuZy4gc3BlY2lmeWluZyBgWzBdYCBtZWFucyBpZiBwcm9jZXNzIGZpbmlzaGVkXHJcbiAgICogd2l0aCB6ZXJvIGV4aXQgY29kZSB0aGVuIHRoZSBwcm9taXNlIHdpbGwgcmVzb2x2ZSBpbnN0ZWFkIG9mIHJlamVjdGluZy5cclxuICAgKlxyXG4gICAqIEFsdGVybmF0aXZlbHksIHNwZWNpZnkgYGluaGVyaXRgIHRvIHNhdmUgc3RhdHVzIGNvZGUgdG8gdGhlIGN1cnJlbnQgYHByb2Nlc3MuZXhpdENvZGVgXHJcbiAgICpcclxuICAgKiBBbHRlcm5hdGl2ZWx5LCBjb21wbGV0ZWx5IGlnbm9yZSB0aGUgZXhpdCBjb2RlIChlLmcuIHlvdSBmb2xsb3cgdXAgYW5kIGludGVycm9nYXRlXHJcbiAgICogdGhlIHByb2Nlc3MgY29kZSBtYW51YWxseSBhZnRlcndhcmRzKVxyXG4gICAqL1xyXG4gIGV4aXRDb2RlczogbnVtYmVyW10gfCAnaW5oZXJpdCcgfCAnYW55JztcclxufTtcclxuXHJcbnR5cGUgU2hhcmVkT3B0cyA9IFBpY2s8U3Bhd25PcHRpb25zLCAnY3dkJz47XHJcblxyXG50eXBlIFNwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PiA9IFtcclxuICBjb21tYW5kOiBzdHJpbmcsXHJcbiAgYXJnczogUmVhZG9ubHlBcnJheTxzdHJpbmc+LFxyXG4gIG9wdGlvbnM6IEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+XHJcbl07XHJcblxyXG5leHBvcnQgdHlwZSBTcGF3bk9wdGlvbnNXaXRoRXh0cmE8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxyXG4gIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+O1xyXG5cclxuZXhwb3J0IHR5cGUgU3Bhd25QYXJhbWV0ZXJNaXg8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxyXG4gIHwgW2NwOiBDaGlsZFByb2Nlc3MsIGV4dHJhT3B0czogQXNzaWduPEUsIFNoYXJlZE9wdHM+XVxyXG4gIHwgU3Bhd25BcmdzPEU+O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzU3Bhd25BcmdzPEUgZXh0ZW5kcyBvYmplY3Q+KFxyXG4gIGFyZ3M6IFNwYXduUGFyYW1ldGVyTWl4PEU+XHJcbik6IGFyZ3MgaXMgU3Bhd25BcmdzPEU+IHtcclxuICByZXR1cm4gIShhcmdzWzBdIGluc3RhbmNlb2YgQ2hpbGRQcm9jZXNzKSAmJiB0eXBlb2YgYXJnc1swXSA9PT0gJ3N0cmluZyc7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnM8RSBleHRlbmRzIG9iamVjdD4oXHJcbiAgcGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cclxuKSB7XHJcbiAgY29uc3QgW2NoaWxkLCBbY29tbWFuZCwgYXJncywgb3B0c11dID0gaXNTcGF3bkFyZ3MocGFyYW1ldGVycylcclxuICAgID8gW1xyXG4gICAgICAgIHNwYXduKC4uLihwYXJhbWV0ZXJzIGFzIHVua25vd24gYXMgUGFyYW1ldGVyczx0eXBlb2Ygc3Bhd24+KSksXHJcbiAgICAgICAgcGFyYW1ldGVycyxcclxuICAgICAgXVxyXG4gICAgOiBbXHJcbiAgICAgICAgcGFyYW1ldGVyc1swXSxcclxuICAgICAgICBbXHJcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduZmlsZSxcclxuICAgICAgICAgIHBhcmFtZXRlcnNbMF0uc3Bhd25hcmdzLnNsaWNlKDEpLFxyXG4gICAgICAgICAgcGFyYW1ldGVyc1sxXSBhcyBBc3NpZ248U3Bhd25PcHRpb25zLCBFPixcclxuICAgICAgICBdLFxyXG4gICAgICBdO1xyXG4gIHJldHVybiB7XHJcbiAgICBjaGlsZCxcclxuICAgIGNvbW1hbmQsXHJcbiAgICBhcmdzLFxyXG4gICAgb3B0cyxcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25Ub1Byb21pc2UoXHJcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXhcclxuKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgeyBjaGlsZCwgY29tbWFuZCwgYXJncywgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xyXG4gIGNvbnN0IHsgcHJlcGFyZUZvclJldGhyb3cgfSA9IGNhcHR1cmVTdGFja1RyYWNlKCk7XHJcblxyXG4gIGNvbnN0IGV4aXRDb2RlcyA9IG9wdHMuZXhpdENvZGVzO1xyXG5cclxuICBjb25zdCBjd2QgPSBvcHRzLmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XHJcblxyXG4gIGNvbnN0IGNtZCA9ICgpID0+IFtjb21tYW5kLCAuLi5hcmdzXS5qb2luKCcgJyk7XHJcblxyXG4gIGxvZ2dlci5kZWJ1ZyhbJz4nLCBjbWQoKV0uam9pbignICcpLCAuLi4oY3dkID8gW2BpbiAke2N3ZH1gXSA6IFtdKSk7XHJcblxyXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMsIHJlaikgPT5cclxuICAgIGNoaWxkXHJcbiAgICAgIC5vbignY2xvc2UnLCAoY29kZSwgc2lnbmFsKSA9PiB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJykge1xyXG4gICAgICAgICAgaWYgKFxyXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdpbmhlcml0JyAmJlxyXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdhbnknICYmXHJcbiAgICAgICAgICAgICFleGl0Q29kZXMuaW5jbHVkZXMoY29kZSlcclxuICAgICAgICAgICkge1xyXG4gICAgICAgICAgICByZWooXHJcbiAgICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3coXHJcbiAgICAgICAgICAgICAgICBuZXcgRXJyb3IoYENvbW1hbmQgXCIke2NtZCgpfVwiIGhhcyBmYWlsZWQgd2l0aCBjb2RlICR7Y29kZX1gKVxyXG4gICAgICAgICAgICAgIClcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlcygpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSBpZiAoc2lnbmFsKSB7XHJcbiAgICAgICAgICByZWooXHJcbiAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxyXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihgRmFpbGVkIHRvIGV4ZWN1dGUgY29tbWFuZCBcIiR7Y21kKCl9XCIgLSAke3NpZ25hbH1gKVxyXG4gICAgICAgICAgICApXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xyXG4gICAgICAgIH1cclxuICAgICAgfSlcclxuICAgICAgLm9uKCdlcnJvcicsIHJlailcclxuICApO1xyXG4gIC8vIGluaGVyaXQgZXhpdCBjb2RlXHJcbiAgaWYgKGV4aXRDb2RlcyA9PT0gJ2luaGVyaXQnKSB7XHJcbiAgICBpZiAoXHJcbiAgICAgIHR5cGVvZiBjaGlsZC5leGl0Q29kZSA9PT0gJ251bWJlcicgJiZcclxuICAgICAgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJyB8fCBwcm9jZXNzLmV4aXRDb2RlID09PSAwKVxyXG4gICAgKSB7XHJcbiAgICAgIHByb2Nlc3MuZXhpdENvZGUgPSBjaGlsZC5leGl0Q29kZTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xyXG5cclxuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCwgU3Bhd25Ub1Byb21pc2VPcHRzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XHJcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xyXG5pbXBvcnQgeyBzcGF3blRvUHJvbWlzZSB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xyXG5cclxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRPcHRzID0ge1xyXG4gIG91dHB1dD86XHJcbiAgICB8IEFycmF5PCdzdGRvdXQnIHwgJ3N0ZGVycic+XHJcbiAgICB8IFsnc3Rkb3V0JyB8ICdzdGRlcnInLCAuLi5BcnJheTwnc3Rkb3V0JyB8ICdzdGRlcnInPl07XHJcbiAgYnVmZmVycz86IHtcclxuICAgIGNvbWJpbmVkPzogc3RyaW5nW107XHJcbiAgICBzdGRvdXQ/OiBzdHJpbmdbXTtcclxuICAgIHN0ZGVycj86IHN0cmluZ1tdO1xyXG4gIH07XHJcbn0gJiBTcGF3blRvUHJvbWlzZU9wdHM7XHJcblxyXG5leHBvcnQgdHlwZSBTcGF3blJlc3VsdFJldHVybiA9IHtcclxuICBwaWQ/OiBudW1iZXI7XHJcbiAgb3V0cHV0OiBzdHJpbmdbXTtcclxuICBzdGRvdXQ6IHN0cmluZztcclxuICBzdGRlcnI6IHN0cmluZztcclxuICBzdGF0dXM6IG51bWJlciB8IG51bGw7XHJcbiAgc2lnbmFsOiBOb2RlSlMuU2lnbmFscyB8IG51bGw7XHJcbiAgZXJyb3I/OiBFcnJvciB8IHVuZGVmaW5lZDtcclxufTtcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blJlc3VsdChcclxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxTcGF3blJlc3VsdE9wdHM+XHJcbik6IFByb21pc2U8U3Bhd25SZXN1bHRSZXR1cm4+IHtcclxuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XHJcbiAgY29uc3QgY29tYmluZWREYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uY29tYmluZWQgPz8gW107XHJcbiAgY29uc3Qgc3Rkb3V0RGF0YTogc3RyaW5nW10gPSBvcHRzLmJ1ZmZlcnM/LnN0ZG91dCA/PyBbXTtcclxuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3RkZXJyID8/IFtdO1xyXG4gIGNvbnN0IG91dHB1dCA9IG9wdHMub3V0cHV0ID8/IFsnc3Rkb3V0JywgJ3N0ZGVyciddO1xyXG4gIGlmIChvdXRwdXQuaW5jbHVkZXMoJ3N0ZG91dCcpKSB7XHJcbiAgICBhc3NlcnQoXHJcbiAgICAgICEhY2hpbGQuc3Rkb3V0LFxyXG4gICAgICAnRXhwZWN0ZWQgXCIuc3Rkb3V0XCIgdG8gYmUgZGVmaW5lZCwgd2hpY2ggd2lsbCBvbmx5IGJlIGRlZmluZWQgaWYgY2hpbGQgcHJvY2VzcyBpcyBzcGF3bmVkIHdpdGggY29ycmVjdCBwYXJhbWV0ZXJzJ1xyXG4gICAgKTtcclxuICAgIGNoaWxkLnN0ZG91dC5zZXRFbmNvZGluZygndXRmLTgnKTtcclxuICAgIGNoaWxkLnN0ZG91dC5vbignZGF0YScsIChkYXRhOiBzdHJpbmcpID0+IHtcclxuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XHJcbiAgICAgIHN0ZG91dERhdGEucHVzaChkYXRhKTtcclxuICAgIH0pO1xyXG4gIH1cclxuICBpZiAob3V0cHV0LmluY2x1ZGVzKCdzdGRlcnInKSkge1xyXG4gICAgYXNzZXJ0KFxyXG4gICAgICAhIWNoaWxkLnN0ZGVycixcclxuICAgICAgJ0V4cGVjdGVkIFwiLnN0ZGVyclwiIHRvIGJlIGRlZmluZWQsIHdoaWNoIHdpbGwgb25seSBiZSBkZWZpbmVkIGlmIGNoaWxkIHByb2Nlc3MgaXMgc3Bhd25lZCB3aXRoIGNvcnJlY3QgcGFyYW1ldGVycydcclxuICAgICk7XHJcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XHJcbiAgICBjaGlsZC5zdGRlcnIub24oJ2RhdGEnLCAoZGF0YTogc3RyaW5nKSA9PiB7XHJcbiAgICAgIGNvbWJpbmVkRGF0YS5wdXNoKGRhdGEpO1xyXG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XHJcbiAgICB9KTtcclxuICB9XHJcbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3NwYXduVG9Qcm9taXNlKGNoaWxkLCBvcHRzKV0pO1xyXG4gIHJldHVybiB7XHJcbiAgICBwaWQ6IGNoaWxkLnBpZCxcclxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcclxuICAgIHN0YXR1czogY2hpbGQuZXhpdENvZGUsXHJcbiAgICBnZXQgb3V0cHV0KCkge1xyXG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xyXG4gICAgfSxcclxuICAgIGdldCBzdGRlcnIoKSB7XHJcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xyXG4gICAgfSxcclxuICAgIGdldCBzdGRvdXQoKSB7XHJcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xyXG4gICAgfSxcclxuICAgIGdldCBlcnJvcigpIHtcclxuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcclxuICAgICAgICA/IChyZXN1bHQucmVhc29uIGFzIEVycm9yKVxyXG4gICAgICAgIDogdW5kZWZpbmVkO1xyXG4gICAgfSxcclxuICB9O1xyXG59XHJcbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xyXG5pbXBvcnQgdHlwZSB7IFNwYXduUmVzdWx0T3B0cywgU3Bhd25SZXN1bHRSZXR1cm4gfSBmcm9tICcuL3NwYXduUmVzdWx0JztcclxuaW1wb3J0IHsgc3Bhd25SZXN1bHQgfSBmcm9tICcuL3NwYXduUmVzdWx0JztcclxuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xyXG5pbXBvcnQgeyBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dChcclxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxTcGF3blJlc3VsdE9wdHM+XHJcbik6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xyXG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcclxuICByZXR1cm4gcmVzdWx0Lm91dHB1dC5qb2luKCcnKTtcclxufVxyXG5cclxuY29uc3QgZGVmYXVsdFNob3VsZE91dHB1dCA9IChyZXN1bHQ6IFNwYXduUmVzdWx0UmV0dXJuKSA9PiB7XHJcbiAgcmV0dXJuIHJlc3VsdC5lcnJvciB8fCByZXN1bHQuc3RhdHVzICE9PSAwIHx8IGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJztcclxufTtcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxyXG4gIC4uLnBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4PFxyXG4gICAgU3Bhd25SZXN1bHRPcHRzICYge1xyXG4gICAgICAvKipcclxuICAgICAgICogQnkgZGVmYXVsdCB3aWxsIG91dHB1dCB0byBgc3RkZXJyYCB3aGVuIHNwYXduIHJlc3VsdCBmYWlsZWQgd2l0aCBhbiBlcnJvciwgd2hlblxyXG4gICAgICAgKiBzdGF0dXMgY29kZSBpcyBub3QgemVybyBvciB3aGVuIGBMb2dnZXIubG9nTGV2ZWxgIGlzIGBkZWJ1Z2BcclxuICAgICAgICovXHJcbiAgICAgIHNob3VsZE91dHB1dD86IChyZXN1bHQ6IFNwYXduUmVzdWx0UmV0dXJuKSA9PiBib29sZWFuO1xyXG4gICAgfVxyXG4gID5cclxuKSB7XHJcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xyXG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcclxuICBjb25zdCBzaG91bGRPdXRwdXQgPSBvcHRzLnNob3VsZE91dHB1dCA/PyBkZWZhdWx0U2hvdWxkT3V0cHV0O1xyXG4gIGlmIChzaG91bGRPdXRwdXQocmVzdWx0KSkge1xyXG4gICAgbG9nZ2VyLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xyXG4gIH1cclxuICBpZiAocmVzdWx0LmVycm9yKSB7XHJcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcclxuICB9XHJcbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXN1bHQpO1xyXG59XHJcbiIsImltcG9ydCB7IGRpcm5hbWUsIHNlcCB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSAnbm9kZTp1cmwnO1xuXG5pbXBvcnQgeyBvbmNlIH0gZnJvbSAnQHV0aWxzL3RzJztcblxuZXhwb3J0IGNvbnN0IGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsID0gKG9wdHM6IHtcbiAgaW1wb3J0TWV0YVVybDogc3RyaW5nO1xufSkgPT4ge1xuICAvLyB0aGlzIGlzIGhpZ2hseSBkZXBlbmRlbnQgb24gdGhlIG91dHB1dCBkaXJlY3Rvcnkgc3RydWN0dXJlXG4gIC8vIGFuZCB0aGUgY29udGV4dCBpbiB3aGljaCB0aGlzIGZ1bmN0aW9uIGlzIHJ1biAoYnVuZGxlZCBjb2RlIHZzIHRzeCAuL3NyYy90c2ZpbGUudHMpXG4gIGNvbnN0IF9fZmlsZU5hbWUgPSBmaWxlVVJMVG9QYXRoKG5ldyBVUkwob3B0cy5pbXBvcnRNZXRhVXJsKSk7XG4gIGNvbnN0IHBhcmVudCA9IGRpcm5hbWUoX19maWxlTmFtZSk7XG4gIGNvbnN0IHN1cGVyUGFyZW50ID0gZGlybmFtZShwYXJlbnQpO1xuXG4gIGNvbnN0IGlzQnVuZGxlZEluRGlzdCA9ICgpID0+IHBhcmVudC5lbmRzV2l0aChzZXAgKyAnZGlzdCcpO1xuICBjb25zdCBpc0J1bmRsZWRJbkJpbiA9ICgpID0+XG4gICAgcGFyZW50LmVuZHNXaXRoKHNlcCArICdiaW4nKSAmJiAhc3VwZXJQYXJlbnQuZW5kc1dpdGgoc2VwICsgJ3NyYycpO1xuXG4gIGlmIChpc0J1bmRsZWRJbkRpc3QoKSB8fCBpc0J1bmRsZWRJbkJpbigpKSB7XG4gICAgcmV0dXJuIGZpbGVVUkxUb1BhdGgobmV3IFVSTChgLi4vYCwgb3B0cy5pbXBvcnRNZXRhVXJsKSk7XG4gIH1cblxuICAvLyBydW4gdmlhIHRzeCB0byBidWlsZCB0aGUgQHJlcGthLWtpdC90cyBpdHNlbGZcbiAgcmV0dXJuIGZpbGVVUkxUb1BhdGgobmV3IFVSTChgLi4vLi4vYCwgb3B0cy5pbXBvcnRNZXRhVXJsKSk7XG59O1xuXG5leHBvcnQgY29uc3QgbW9kdWxlUm9vdERpcmVjdG9yeSA9IG9uY2UoKCkgPT5cbiAgZ2V0TW9kdWxlUm9vdERpcmVjdG9yeUZvckltcG9ydE1ldGFVcmwoeyBpbXBvcnRNZXRhVXJsOiBpbXBvcnQubWV0YS51cmwgfSlcbik7XG4iLCJpbXBvcnQgeyByZWFkRmlsZSwgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgZGlybmFtZSwgam9pbiwgc2VwIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4vbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5cbmFzeW5jIGZ1bmN0aW9uIGlzRmlsZShmaWxlUGF0aDogc3RyaW5nKSB7XG4gIHJldHVybiBhd2FpdCBzdGF0KGZpbGVQYXRoKVxuICAgIC50aGVuKChyZXN1bHQpID0+IHJlc3VsdC5pc0ZpbGUoKSlcbiAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xufVxuXG5hc3luYyBmdW5jdGlvbiogaXRlcmF0ZU5vZGVNb2R1bGVzKHN0YXJ0V2l0aDogc3RyaW5nLCBwYXRoOiBzdHJpbmcpIHtcbiAgbGV0IGN1cnJlbnQgPSBzdGFydFdpdGg7XG4gIHdoaWxlIChjdXJyZW50ICE9PSBzZXAgJiYgY3VycmVudCAhPT0gJ34vJykge1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGpvaW4oY3VycmVudCwgJ25vZGVfbW9kdWxlcycsIHBhdGgpO1xuICAgIGlmIChhd2FpdCBpc0ZpbGUoY2FuZGlkYXRlKSkge1xuICAgICAgeWllbGQgY2FuZGlkYXRlO1xuICAgIH1cbiAgICBpZiAoY3VycmVudCA9PT0gZGlybmFtZShjdXJyZW50KSkge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGN1cnJlbnQgPSBkaXJuYW1lKGN1cnJlbnQpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbmRCaW5TY3JpcHQoc3RhcnRXaXRoOiBzdHJpbmcsIGJpblNjcmlwdFBhdGg6IHN0cmluZykge1xuICBmb3IgYXdhaXQgKGNvbnN0IHBhdGggb2YgaXRlcmF0ZU5vZGVNb2R1bGVzKHN0YXJ0V2l0aCwgYmluU2NyaXB0UGF0aCkpIHtcbiAgICByZXR1cm4gcGF0aDtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYmluUGF0aChvcHRzOiB7XG4gIGJpbk5hbWU6IHN0cmluZztcbiAgYmluU2NyaXB0UGF0aDogc3RyaW5nO1xufSkge1xuICBjb25zdCByb290ID0gbW9kdWxlUm9vdERpcmVjdG9yeSgpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBmaW5kQmluU2NyaXB0KHJvb3QsIG9wdHMuYmluU2NyaXB0UGF0aCk7XG4gIGlmIChyZXN1bHQpIHtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGZpbmQgYmluICR7b3B0cy5iaW5OYW1lfWApO1xufVxuXG5mdW5jdGlvbiBzY3JpcHRGcm9tUGFja2FnZUpzb24ob3B0czoge1xuICBiaW5OYW1lOiBzdHJpbmc7XG4gIHBhY2thZ2VKc29uOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn0pIHtcbiAgY29uc3QgY2FuZGlkYXRlID0gb3B0cy5wYWNrYWdlSnNvblsnYmluJ107XG4gIGlmICh0eXBlb2YgY2FuZGlkYXRlID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBjYW5kaWRhdGU7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ29iamVjdCcgJiYgY2FuZGlkYXRlICE9PSBudWxsKSB7XG4gICAgY29uc3QgZW50cnkgPSAoY2FuZGlkYXRlIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4pW29wdHMuYmluTmFtZV07XG4gICAgaWYgKHR5cGVvZiBlbnRyeSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBlbnRyeTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRldGVybWluZUJpblNjcmlwdFBhdGgob3B0czoge1xuICBiaW5OYW1lOiBzdHJpbmc7XG4gIGJpblBhY2thZ2VOYW1lOiBzdHJpbmc7XG59KSB7XG4gIGZvciBhd2FpdCAoY29uc3QgcGF0aCBvZiBpdGVyYXRlTm9kZU1vZHVsZXMoXG4gICAgbW9kdWxlUm9vdERpcmVjdG9yeSgpLFxuICAgIGpvaW4ob3B0cy5iaW5QYWNrYWdlTmFtZSwgJ3BhY2thZ2UuanNvbicpXG4gICkpIHtcbiAgICBjb25zdCBwa2cgPSBhd2FpdCByZWFkRmlsZShwYXRoLCAndXRmLTgnKVxuICAgICAgLnRoZW4oKHRleHQpID0+IEpTT04ucGFyc2UodGV4dCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAuY2F0Y2goKCkgPT4gbnVsbCk7XG4gICAgaWYgKCFwa2cpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHNjcmlwdFBhdGggPSBzY3JpcHRGcm9tUGFja2FnZUpzb24oe1xuICAgICAgYmluTmFtZTogb3B0cy5iaW5OYW1lLFxuICAgICAgcGFja2FnZUpzb246IHBrZyxcbiAgICB9KTtcbiAgICBpZiAoIXNjcmlwdFBhdGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGpvaW4oZGlybmFtZShwYXRoKSwgc2NyaXB0UGF0aCk7XG4gICAgaWYgKGF3YWl0IGlzRmlsZShjYW5kaWRhdGUpKSB7XG4gICAgICAvLyBkZW5vcm1hbGl6ZSBhbmQgbWFrZSB0aGlzIGNvbnNpc3RlbnQgb24gYWxsIHBsYXRmb3Jtc1xuICAgICAgLy8gYXMgdGhlIHBhdGggd2lsbCB3b3JrIGJvdGggZm9yIHdpbmRvd3MgYW5kIG5vbi13aW5kb3dzXG4gICAgICByZXR1cm4gam9pbihvcHRzLmJpblBhY2thZ2VOYW1lLCBzY3JpcHRQYXRoKS5yZXBsYWNlQWxsKHNlcCwgJy8nKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cbiIsImltcG9ydCB7IHBlcmZvcm1hbmNlIH0gZnJvbSAnbm9kZTpwZXJmX2hvb2tzJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmltcG9ydCB7IHNwYXduT3V0cHV0Q29uZGl0aW9uYWwgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IGJpblBhdGggfSBmcm9tICcuL3V0aWxzL2JpblBhdGgnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVHNTY3JpcHQob3B0czoge1xuICBsb2NhdGlvbjogc3RyaW5nO1xuICBpbXBvcnRNZXRhVXJsPzogVVJMO1xuICBhcmdzPzogc3RyaW5nW107XG59KSB7XG4gIGNvbnN0IHN0YXJ0ZWQgPSBwZXJmb3JtYW5jZS5ub3coKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBsb2NhdGlvbiA9IG9wdHMuaW1wb3J0TWV0YVVybFxuICAgICAgPyBmaWxlVVJMVG9QYXRoKG5ldyBVUkwob3B0cy5sb2NhdGlvbiwgb3B0cy5pbXBvcnRNZXRhVXJsKSlcbiAgICAgIDogb3B0cy5sb2NhdGlvbjtcblxuICAgIGlmIChsb2dnZXIubG9nTGV2ZWwgIT09ICdkZWJ1ZycpIHtcbiAgICAgIGxvZ2dlci5sb2coYFJ1bm5pbmcgXCIke2xvY2F0aW9ufVwiYCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHNwYXduT3V0cHV0Q29uZGl0aW9uYWwoXG4gICAgICBwcm9jZXNzLmV4ZWNQYXRoLFxuICAgICAgW1xuICAgICAgICBhd2FpdCBiaW5QYXRoKHtcbiAgICAgICAgICBiaW5OYW1lOiAndHN4JyxcbiAgICAgICAgICBiaW5TY3JpcHRQYXRoOiAndHN4L2Rpc3QvY2xpLmpzJyxcbiAgICAgICAgfSksXG4gICAgICAgIGxvY2F0aW9uLFxuICAgICAgICAuLi4ob3B0cy5hcmdzIHx8IFtdKSxcbiAgICAgIF0sXG4gICAgICB7XG4gICAgICAgIGV4aXRDb2RlczogWzBdLFxuICAgICAgICAuLi4obG9nZ2VyLmxvZ0xldmVsID09PSAnZGVidWcnICYmIHtcbiAgICAgICAgICBzdGRpbzogJ2luaGVyaXQnLFxuICAgICAgICAgIG91dHB1dDogW10sXG4gICAgICAgIH0pLFxuICAgICAgICBlbnY6IHtcbiAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICBMT0dfTEVWRUw6IGxvZ2dlci5sb2dMZXZlbCxcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICApO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChsb2dnZXIubG9nTGV2ZWwgIT09ICdkZWJ1ZycpIHtcbiAgICAgIGxvZ2dlci5sb2coXG4gICAgICAgIGBGaW5pc2hlZCBpbiAkeygocGVyZm9ybWFuY2Uubm93KCkgLSBzdGFydGVkKSAvIDEwMDApLnRvRml4ZWQoMil9c2BcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG4iLCJpbXBvcnQgeyByZWFkRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xyXG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcclxuXHJcbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XHJcblxyXG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi4vdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeSc7XHJcbmltcG9ydCB0eXBlIHsgUGFja2FnZUpzb24gfSBmcm9tICcuL3BhY2thZ2VKc29uJztcclxuXHJcbmNvbnN0IGN3ZFBhY2thZ2VKc29uUGF0aCA9ICgpID0+IGpvaW4ocHJvY2Vzcy5jd2QoKSwgJy4vcGFja2FnZS5qc29uJyk7XHJcblxyXG5hc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb25BdChcclxuICBwYXRoOiBzdHJpbmcsXHJcbiAgZGVwcyA9IHsgcmVhZEZpbGU6IChwYXRoOiBzdHJpbmcpID0+IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpIH1cclxuKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xyXG4gIHJldHVybiBhd2FpdCBkZXBzXHJcbiAgICAucmVhZEZpbGUocGF0aClcclxuICAgIC50aGVuKChyZXN1bHQpID0+IEpTT04ucGFyc2UocmVzdWx0KSBhcyBQYWNrYWdlSnNvbik7XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCByZWFkQ3dkUGFja2FnZUpzb24gPSBvbmNlQXN5bmMoKCkgPT5cclxuICByZWFkUGFja2FnZUpzb25BdChjd2RQYWNrYWdlSnNvblBhdGgoKSlcclxuKTtcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb24oXHJcbiAgcGF0aDogc3RyaW5nLFxyXG4gIGRlcHMgPSB7IHJlYWRGaWxlOiAocGF0aDogc3RyaW5nKSA9PiByZWFkRmlsZShwYXRoLCAndXRmLTgnKSB9XHJcbik6IFByb21pc2U8UGFja2FnZUpzb24+IHtcclxuICAvLyBhc3N1bWluZyBjdXJyZW50IGRpcmVjdG9yeSBkb2Vzbid0IGNoYW5nZSB3aGlsZSBhcHAgaXMgcnVubmluZ1xyXG4gIHJldHVybiBwcm9jZXNzLmN3ZCgpID09PSBjd2RQYWNrYWdlSnNvblBhdGgoKVxyXG4gICAgPyBhd2FpdCByZWFkQ3dkUGFja2FnZUpzb24oKVxyXG4gICAgOiBhd2FpdCByZWFkUGFja2FnZUpzb25BdChwYXRoLCBkZXBzKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFJlYWQgcGFja2FnZSBqc29uIG9mIHRoZSBjdXJyZW50IGxpYnJhcnkgKEByZXBrYS1raXQvdHMpXHJcbiAqL1xyXG5leHBvcnQgY29uc3Qgb3VyUGFja2FnZUpzb24gPSBvbmNlQXN5bmMoXHJcbiAgYXN5bmMgKFxyXG4gICAgZGVwcyA9IHtcclxuICAgICAgcmVhZEZpbGU6IChwYXRoOiBzdHJpbmcpID0+IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpLFxyXG4gICAgfVxyXG4gICkgPT4ge1xyXG4gICAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gam9pbihtb2R1bGVSb290RGlyZWN0b3J5KCksICdwYWNrYWdlLmpzb24nKTtcclxuICAgIHJldHVybiBhd2FpdCByZWFkUGFja2FnZUpzb25BdChwYWNrYWdlSnNvblBhdGgsIHtcclxuICAgICAgcmVhZEZpbGU6IGRlcHMucmVhZEZpbGUsXHJcbiAgICB9KTtcclxuICB9XHJcbik7XHJcbiIsImltcG9ydCBhc3NlcnQgZnJvbSAnbm9kZTphc3NlcnQnO1xuaW1wb3J0IHsgZGlybmFtZSwgbm9ybWFsaXplLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBlc2NhcGVSZWdFeHAsIGlzVHJ1dGh5LCBvbmNlQXN5bmMgfSBmcm9tICdAdXRpbHMvdHMnO1xuaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5cbmNvbnN0IGdldFJlcG9zaXRvcnlSb290U2NhbkNhbmRpZGF0ZXMgPSAoY3VycmVudERpcmVjdG9yeTogc3RyaW5nKSA9PiB7XG4gIGNvbnN0IGVzYyA9IGVzY2FwZVJlZ0V4cChzZXApO1xuICAvLyBoYXZpbmcgJ3BhY2thZ2VzLyonIGluIHRoZSByb290IG9mIGEgbW9ub3JlcG8gaXMgc3VwZXIgY29tbW9uXG4gIGNvbnN0IHJlc3VsdCA9IG5ldyBSZWdFeHAoXG4gICAgYCguKig/PSR7ZXNjfXBhY2thZ2VzJHtlc2N9KSl8KC4qKD89JHtlc2N9bm9kZV9tb2R1bGVzJHtlc2N9KSl8KC4qKWBcbiAgKS5leGVjKGN1cnJlbnREaXJlY3RvcnkpO1xuICBhc3NlcnQoISFyZXN1bHQpO1xuICBjb25zdCBbLCBwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdF0gPSByZXN1bHQ7XG4gIHJldHVybiBbcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdLmZpbHRlcihpc1RydXRoeSk7XG59O1xuXG4vLyByZXR1cm5zIHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2hpY2ggaGFzIG1vbm9yZXBvIG1hcmtlcnMsIG11bHRpcGxlXG4vLyBkaXJlY3RvcmllcyBjYW4gaGF2ZSB0aGVtIC0gd2hpY2hldmVyIHJlYWQgZmlyc3Qgd2lsbCBiZSByZXR1cm5lZFxuLy8gc28gaWYgb3JkZXIgaXMgaW1wb3J0YW50IC0gc2Nhbm5pbmcgc2hvdWxkIGJlIHNlcGFyYXRlZCB0byBtdWx0aXBsZSBqb2JzXG4vLyB2aWEgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnNcbmNvbnN0IGhhc1Jvb3RNYXJrZXJzRm9yID0gYXN5bmMgKGNhbmRpZGF0ZTogc3RyaW5nKSA9PiB7XG4gIGNvbnN0IG1hcmtlcnMgPSBbXG4gICAgJy5naXQnLFxuICAgICd5YXJuLmxvY2snLFxuICAgICdwbnBtLWxvY2sueWFtbCcsXG4gICAgJ3BhY2thZ2UtbG9jay5qc29uJyxcbiAgICAncG5wbS13b3Jrc3BhY2UueWFtbCcsXG4gIF07XG4gIGNvbnN0IG1hcmtlcnNTdHJlYW0gPSBmZy5zdHJlYW0obWFya2Vycywge1xuICAgIG1hcmtEaXJlY3RvcmllczogdHJ1ZSxcbiAgICBvbmx5RmlsZXM6IGZhbHNlLFxuICAgIGN3ZDogY2FuZGlkYXRlLFxuICAgIGFic29sdXRlOiB0cnVlLFxuICB9KTtcbiAgZm9yIGF3YWl0IChjb25zdCBlbnRyeSBvZiBtYXJrZXJzU3RyZWFtKSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBlbnRyeSA9PT0gJ3N0cmluZycpO1xuICAgIHJldHVybiBkaXJuYW1lKGVudHJ5KTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufTtcblxuY29uc3QgaGFzUm9vdE1hcmtlcnMgPSBhc3luYyAoY2FuZGlkYXRlczogc3RyaW5nW10pID0+IHtcbiAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgIGNhbmRpZGF0ZXMubWFwKChjYW5kaWRhdGUpID0+IGhhc1Jvb3RNYXJrZXJzRm9yKGNhbmRpZGF0ZSkpXG4gICk7XG4gIHJldHVybiByZXN1bHRzLmZpbHRlcihpc1RydXRoeSlbMF07XG59O1xuXG5jb25zdCBwcmlvcml0aXplZEhhc01hcmtlcnMgPSAoam9iczogc3RyaW5nW11bXSkgPT4ge1xuICBpZiAoam9icy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gIH1cblxuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPigocmVzKSA9PiB7XG4gICAgY29uc3QgcmVzdWx0cyA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmcgfCB1bmRlZmluZWQ+KCk7XG5cbiAgICBjb25zdCBjaGVja1Nob3VsZENvbXBsZXRlID0gKGluZGV4OiBudW1iZXIsIHJlc3VsdDogc3RyaW5nIHwgdW5kZWZpbmVkKSA9PiB7XG4gICAgICByZXN1bHRzLnNldChpbmRleCwgcmVzdWx0KTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgam9icy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBoYXNSZXN1bHQgPSByZXN1bHRzLmhhcyhpKTtcbiAgICAgICAgaWYgKCFoYXNSZXN1bHQpIHtcbiAgICAgICAgICAvLyBpZiBhIGpvYiB3aXRoIGhpZ2hlc3QgcHJpb3JpdHkgaGFzbid0IGZpbmlzaGVkIHlldFxuICAgICAgICAgIC8vIHRoZW4gd2FpdCBmb3IgaXRcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXN1bHQgPSByZXN1bHRzLmdldChpKTtcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIC8vIGpvYiBmaW5pc2hlZCBhbmQgd2UgZm91bmQgbWFya2VycywgYWxzbyBhbGwgam9ic1xuICAgICAgICAgIC8vIHdpdGggaGlnaGVyIHByaW9yaXR5IGZpbmlzaGVkIGFuZCB0aGV5IGRvbid0IGhhdmVcbiAgICAgICAgICAvLyBhbnkgbWFya2VycyAtIHdlIGFyZSBkb25lXG4gICAgICAgICAgcmVzKHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHRzLnNpemUgPT09IGpvYnMubGVuZ3RoKSB7XG4gICAgICAgIC8vIGFsbCBqb2JzIGZpbmlzaGVkIC0gbm8gbWFya2VycyBmb3VuZFxuICAgICAgICByZXModW5kZWZpbmVkKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgam9icy5mb3JFYWNoKChkaXJlY3RvcmllcywgaW5kZXgpID0+IHtcbiAgICAgIGhhc1Jvb3RNYXJrZXJzKGRpcmVjdG9yaWVzKVxuICAgICAgICAudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgICAgY2hlY2tTaG91bGRDb21wbGV0ZShpbmRleCwgcmVzdWx0KTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBpZ25vcmVcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn07XG5cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuID0gYXN5bmMgKFxuICBsb29rdXBEaXJlY3Rvcnk6IHN0cmluZ1xuKSA9PiB7XG4gIGNvbnN0IHVuaXF1ZURpcm5hbWUgPSAocGF0aD86IHN0cmluZykgPT4ge1xuICAgIGlmICghcGF0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBkaXJuYW1lKHBhdGgpO1xuICAgIGlmIChyZXN1bHQgPT09IHBhdGgpIHtcbiAgICAgIC8vIGUuZy4gdGhlIHBhdGggd2FzIGFscmVhZHkgYSByb290IFwiL1wiXG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgY29uc3QgcGFyZW50ID0gdW5pcXVlRGlybmFtZShsb29rdXBEaXJlY3RvcnkpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IHVuaXF1ZURpcm5hbWUocGFyZW50KTtcblxuICBjb25zdCByZXN1bHQgPVxuICAgIChhd2FpdCBwcmlvcml0aXplZEhhc01hcmtlcnMoXG4gICAgICAvLyBzY2FuIGluIG1vc3QgbGlrZWx5IGxvY2F0aW9ucyBmaXJzdCB3aXRoIGN1cnJlbnQgbG9va3VwIGRpcmVjdG9yeSB0YWtpbmcgcHJpb3JpdHlcbiAgICAgIFtcbiAgICAgICAgW2xvb2t1cERpcmVjdG9yeV0sXG4gICAgICAgIGdldFJlcG9zaXRvcnlSb290U2NhbkNhbmRpZGF0ZXMobG9va3VwRGlyZWN0b3J5KSxcbiAgICAgICAgLy8gc2NhbiAyIGRpcmVjdG9yaWVzIHVwd2FyZHNcbiAgICAgICAgW3BhcmVudF0sXG4gICAgICAgIFtzdXBlclBhcmVudF0sXG4gICAgICBdXG4gICAgICAgIC5tYXAoKGRpcnMpID0+IGRpcnMuZmlsdGVyKGlzVHJ1dGh5KSlcbiAgICAgICAgLmZpbHRlcigoam9iKSA9PiBqb2IubGVuZ3RoID4gMClcbiAgICApKSB8fCBsb29rdXBEaXJlY3Rvcnk7IC8qIGZhbGxiYWNrIHRvIGN1cnJlbnQgZGlyZWN0b3J5IGluIHdvcnNlIHNjZW5hcmlvICovXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZShyZXN1bHQpO1xufTtcblxuLyoqXG4gKiBEZXRlcm1pbmUgcmVwb3NpdG9yeSByb290IHBhdGggYnkgc2Nhbm5pbmcgY3VycmVudCBhbmQgcGFyZW50IGRpcmVjdG9yaWVzXG4gKiBhbmQgbG9va2luZyBmb3IgbWFya2VyIGZpbGVzL2RpcnMgbGlrZTpcbiAqXG4gKiAtIC5naXRcbiAqIC0gcGFja2FnZS1sb2NrLmpzb25cbiAqIC0geWFybi5sb2NrXG4gKiAtIHBucG0tbG9jay55YW1sXG4gKiAtIHBucG0td29ya3NwYWNlLnlhbWxcbiAqL1xuZXhwb3J0IGNvbnN0IHJlcG9zaXRvcnlSb290UGF0aCA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHJvb3RQYXRoID0gYXdhaXQgcmVwb3NpdG9yeVJvb3RQYXRoVmlhRGlyZWN0b3J5U2Nhbihwcm9jZXNzLmN3ZCgpKTtcbiAgcmV0dXJuIHJvb3RQYXRoO1xufSk7XG4iLCJpbXBvcnQgeyBzdGF0IH0gZnJvbSAnZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgdHlwZSB7IFNwYXduT3B0aW9uc1dpdGhFeHRyYSB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgeyBzcGF3bk91dHB1dENvbmRpdGlvbmFsIH0gZnJvbSAnLi9jaGlsZC1wcm9jZXNzJztcbmltcG9ydCB0eXBlIHsgU3Bhd25SZXN1bHRPcHRzIH0gZnJvbSAnLi9jaGlsZC1wcm9jZXNzL3NwYXduUmVzdWx0JztcbmltcG9ydCB7IGJpblBhdGggfSBmcm9tICcuL3V0aWxzL2JpblBhdGgnO1xuaW1wb3J0IHR5cGUgeyBDbGlBcmdzIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBzZXRTY3JpcHQgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGNsaUFyZ3NQaXBlIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBpbnNlcnRBZnRlckFueU9mIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBpbmNsdWRlc0FueU9mIH0gZnJvbSAnLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3V0aWxzL3JlcG9zaXRvcnlSb290UGF0aCc7XG5cbmV4cG9ydCB0eXBlIFRhc2tUeXBlcyA9XG4gIHwgJ2xpbnQnXG4gIHwgJ2J1aWxkJ1xuICB8ICd0ZXN0J1xuICB8ICdkZWNsYXJhdGlvbnMnXG4gIHwgJ2ludGVncmF0aW9uJ1xuICB8ICdzZXR1cDppbnRlZ3JhdGlvbidcbiAgfCAoc3RyaW5nICYge1xuICAgICAgX2FsbG93U3RyaW5ncz86IHVuZGVmaW5lZDtcbiAgICB9KTtcblxuZXhwb3J0IGNvbnN0IHR1cmJvQmluUGF0aCA9ICgpID0+XG4gIGJpblBhdGgoe1xuICAgIGJpbk5hbWU6ICd0dXJibycsXG4gICAgYmluU2NyaXB0UGF0aDogJ3R1cmJvL2Jpbi90dXJibycsXG4gIH0pO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFzVHVyYm9Kc29uKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBjd2QgPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGgoKTtcbiAgcmV0dXJuIGF3YWl0IHN0YXQoam9pbihjd2QsICd0dXJiby5qc29uJykpXG4gICAgLnRoZW4oKHJlcykgPT4gcmVzLmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXNzVHVyYm9Gb3JjZUVudihhcmdzOiBzdHJpbmdbXSkge1xuICByZXR1cm4gaW5jbHVkZXNBbnlPZihhcmdzLCBbJ3J1biddKSAmJiBpbmNsdWRlc0FueU9mKGFyZ3MsIFsnLS1mb3JjZSddKVxuICAgID8ge1xuICAgICAgICBUVVJCT19GT1JDRTogJzEnLFxuICAgICAgfVxuICAgIDogdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5oZXJpdFR1cmJvRm9yY2VBcmdGcm9tRW52KCkge1xuICByZXR1cm4gKHN0YXRlOiBDbGlBcmdzKSA9PiAoe1xuICAgIC4uLnN0YXRlLFxuICAgIGlucHV0QXJnczpcbiAgICAgIGluY2x1ZGVzQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBbJ3J1biddKSAmJlxuICAgICAgIWluY2x1ZGVzQW55T2Yoc3RhdGUuaW5wdXRBcmdzLCBbJy0tZm9yY2UnXSkgJiZcbiAgICAgIHByb2Nlc3MuZW52WydUVVJCT19GT1JDRSddXG4gICAgICAgID8gaW5zZXJ0QWZ0ZXJBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsnLS1mb3JjZSddLCBbJ3J1biddKVxuICAgICAgICA6IHN0YXRlLmlucHV0QXJncyxcbiAgfSk7XG59XG5cbi8qKlxuICogUnVuIG9uZSBvZiB0aGUgZGV2IHBpcGVsaW5lIHRhc2tzIHVzaW5nIFR1cmJvIGZvciBhIHNpbmdsZSBwYWNrYWdlXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5UdXJib1Rhc2tzRm9yU2luZ2xlUGFja2FnZShvcHRzOiB7XG4gIHRhc2tzOiBbVGFza1R5cGVzLCAuLi5UYXNrVHlwZXNbXV07XG4gIHBhY2thZ2VEaXI/OiBzdHJpbmc7XG4gIHNwYXduT3B0czogT21pdDxTcGF3bk9wdGlvbnNXaXRoRXh0cmE8U3Bhd25SZXN1bHRPcHRzPiwgJ2N3ZCc+O1xufSkge1xuICBjb25zdCByb290RGlyID0gb3B0cy5wYWNrYWdlRGlyID8/IHByb2Nlc3MuY3dkKCk7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICByZXR1cm4gYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbChcbiAgICBwcm9jZXNzLmV4ZWNQYXRoLFxuICAgIGNsaUFyZ3NQaXBlKFxuICAgICAgW3NldFNjcmlwdChhd2FpdCB0dXJib0JpblBhdGgoKSksIGluaGVyaXRUdXJib0ZvcmNlQXJnRnJvbUVudigpXSxcbiAgICAgIFtcbiAgICAgICAgJ3J1bicsXG4gICAgICAgIC4uLm9wdHMudGFza3MsXG4gICAgICAgICctLWZpbHRlcj0nICsgcm9vdERpci5yZXBsYWNlKGN3ZCwgJy4nKSxcbiAgICAgICAgJy0tb3V0cHV0LWxvZ3M9bmV3LW9ubHknLFxuICAgICAgICAnLS1jb2xvcicsXG4gICAgICBdXG4gICAgKSxcbiAgICB7XG4gICAgICAuLi5vcHRzLnNwYXduT3B0cyxcbiAgICAgIGN3ZCxcbiAgICB9XG4gICk7XG59XG4iLCJpbXBvcnQgeyByZWFkRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xyXG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcclxuXHJcbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XHJcbmltcG9ydCB7IGxvYWQgfSBmcm9tICdqcy15YW1sJztcclxuXHJcbmltcG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vcmVwb3NpdG9yeVJvb3RQYXRoJztcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHRyeVJlYWRpbmdQbnBtV29ya3NwYWNlWWFtbChtb25vcmVwb1Jvb3Q6IHN0cmluZykge1xyXG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShcclxuICAgIGpvaW4obW9ub3JlcG9Sb290LCAncG5wbS13b3Jrc3BhY2UueWFtbCcpLFxyXG4gICAgJ3V0Zi04J1xyXG4gICk7XHJcbiAgY29uc3Qgcm9vdFBhdGggPSBsb2FkKHRleHQpIGFzIHtcclxuICAgIHBhY2thZ2VzPzogc3RyaW5nW107XHJcbiAgfTtcclxuICByZXR1cm4gQXJyYXkuaXNBcnJheShyb290UGF0aC5wYWNrYWdlcykgJiYgcm9vdFBhdGgucGFja2FnZXMubGVuZ3RoID4gMFxyXG4gICAgPyByb290UGF0aC5wYWNrYWdlc1xyXG4gICAgOiB1bmRlZmluZWQ7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHRyeVJlYWRpbmdQYWNrYWdlSnNvbldvcmtzcGFjZXMobW9ub3JlcG9Sb290OiBzdHJpbmcpIHtcclxuICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVhZEZpbGUoam9pbihtb25vcmVwb1Jvb3QsICdwYWNrYWdlLmpzb24nKSwgJ3V0Zi04Jyk7XHJcbiAgY29uc3QgcGFja2FnZUpzb24gPSBKU09OLnBhcnNlKHRleHQpIGFzIHtcclxuICAgIHdvcmtzcGFjZXM/OiBzdHJpbmdbXTtcclxuICB9O1xyXG4gIHJldHVybiBBcnJheS5pc0FycmF5KHBhY2thZ2VKc29uLndvcmtzcGFjZXMpICYmXHJcbiAgICBwYWNrYWdlSnNvbi53b3Jrc3BhY2VzLmxlbmd0aCA+IDBcclxuICAgID8gcGFja2FnZUpzb24ud29ya3NwYWNlc1xyXG4gICAgOiB1bmRlZmluZWQ7XHJcbn1cclxuXHJcbmNvbnN0IHJlYWRQYWNrYWdlc0dsb2JzQXQgPSBhc3luYyAobW9ub3JlcG9Sb290OiBzdHJpbmcpID0+IHtcclxuICBjb25zdCBbcG5wbVdvcmtzcGFjZXMsIHBhY2thZ2VKc29uV29ya3NwYWNlc10gPSBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICB0cnlSZWFkaW5nUG5wbVdvcmtzcGFjZVlhbWwobW9ub3JlcG9Sb290KS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpLFxyXG4gICAgdHJ5UmVhZGluZ1BhY2thZ2VKc29uV29ya3NwYWNlcyhtb25vcmVwb1Jvb3QpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCksXHJcbiAgXSk7XHJcbiAgcmV0dXJuIHBucG1Xb3Jrc3BhY2VzIHx8IHBhY2thZ2VKc29uV29ya3NwYWNlcyB8fCBbXTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBEZXRlcm1pbmUgbW9ub3JlcG8gcGFja2FnZXMgZ2xvYiBieSByZWFkaW5nIG9uZSBvZiB0aGUgc3VwcG9ydGVkXHJcbiAqIGZpbGVzXHJcbiAqXHJcbiAqIE5PVEU6IG9ubHkgcG5wbSBpcyBzdXBwb3J0ZWQgYXQgdGhlIG1vbWVudFxyXG4gKi9cclxuZXhwb3J0IGNvbnN0IHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMgPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xyXG4gIGNvbnN0IHJvb3QgPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGgoKTtcclxuICBjb25zdCBwYWNrYWdlc0dsb2JzID0gYXdhaXQgcmVhZFBhY2thZ2VzR2xvYnNBdChyb290KTtcclxuICByZXR1cm4ge1xyXG4gICAgcm9vdCxcclxuICAgIHBhY2thZ2VzR2xvYnMsXHJcbiAgfTtcclxufSk7XHJcbiIsImltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xyXG5cclxuaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XHJcblxyXG5pbXBvcnQgeyBoYXNUdXJib0pzb24gfSBmcm9tICcuLi90dXJibyc7XHJcbmltcG9ydCB7IHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMgfSBmcm9tICcuL3JlYWRQYWNrYWdlc0dsb2JzJztcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24oKSB7XHJcbiAgY29uc3QgW3sgcm9vdCwgcGFja2FnZXNHbG9icyB9LCBoYXNUdXJib10gPSBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzKCksXHJcbiAgICBoYXNUdXJib0pzb24oKSxcclxuICBdKTtcclxuICBpZiAocGFja2FnZXNHbG9icy5sZW5ndGggPT09IDApIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHJvb3QsXHJcbiAgICAgIHBhY2thZ2VzR2xvYnMsXHJcbiAgICAgIHBhY2thZ2VMb2NhdGlvbnM6IFtdLFxyXG4gICAgICBoYXNUdXJibyxcclxuICAgICAgdHlwZTogJ3NpbmdsZS1wYWNrYWdlJyBhcyBjb25zdCxcclxuICAgIH07XHJcbiAgfVxyXG4gIGNvbnN0IHBhY2thZ2VMb2NhdGlvbnMgPSBhd2FpdCBmZyhcclxuICAgIHBhY2thZ2VzR2xvYnMubWFwKChnbG9iKSA9PiBgJHtnbG9ifS9wYWNrYWdlLmpzb25gKSxcclxuICAgIHtcclxuICAgICAgY3dkOiByb290LFxyXG4gICAgfVxyXG4gICk7XHJcbiAgcmV0dXJuIHtcclxuICAgIHJvb3QsXHJcbiAgICBwYWNrYWdlc0dsb2JzLFxyXG4gICAgcGFja2FnZUxvY2F0aW9uczogcGFja2FnZUxvY2F0aW9ucy5tYXAoKGxvY2F0aW9uKSA9PiBkaXJuYW1lKGxvY2F0aW9uKSksXHJcbiAgICBoYXNUdXJibyxcclxuICAgIHR5cGU6ICdtdWx0aXBsZS1wYWNrYWdlcycgYXMgY29uc3QsXHJcbiAgfTtcclxufVxyXG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBDb25maWcgfSBmcm9tICdqZXN0JztcbmltcG9ydCB7IGRlZmF1bHRzIH0gZnJvbSAnamVzdC1jb25maWcnO1xuXG5leHBvcnQgY29uc3QgZXh0ZW5zaW9ucyA9IFtcbiAgJ2pzJyxcbiAgJ2NqcycsXG4gICdtanMnLFxuICAnanN4JyxcbiAgJ3RzJyxcbiAgJ2N0cycsXG4gICdtdHMnLFxuICAndHN4Jyxcbl07XG5cbmV4cG9ydCBjb25zdCBpZ25vcmVEaXJzID0gWycvbm9kZV9tb2R1bGVzLycsICcvZGlzdC8nLCAnLy50c2Mtb3V0LyddO1xuXG5leHBvcnQgY29uc3QgamVzdFRyYW5zZm9ybUNvbmZpZ1Byb3AgPSAoXG4gIGplc3RQbHVnaW5Sb290Pzogc3RyaW5nXG4pOiBQaWNrPENvbmZpZywgJ3RyYW5zZm9ybSc+ID0+IHtcbiAgY29uc3QgZXNidWlsZCA9IGplc3RQbHVnaW5Sb290XG4gICAgPyBqb2luKGplc3RQbHVnaW5Sb290LCAnZXNidWlsZC1qZXN0JylcbiAgICA6ICdlc2J1aWxkLWplc3QnO1xuXG4gIGNvbnN0IGVzYnVpbGREZWZhdWx0T3B0cyA9IHtcbiAgICB0YXJnZXQ6IGBub2RlJHtwcm9jZXNzLnZlcnNpb25zLm5vZGV9YCxcbiAgICBzb3VyY2VtYXA6IHRydWUsXG4gIH07XG5cbiAgY29uc3QgbG9hZGVyQnlFeHQgPSB7XG4gICAgdHM6IHsgbG9hZGVyOiAndHMnLCBmb3JtYXQ6ICdlc20nIH0sXG4gICAgY3RzOiB7IGxvYWRlcjogJ3RzJywgZm9ybWF0OiAnY2pzJyB9LFxuICAgIG10czogeyBsb2FkZXI6ICd0cycsIGZvcm1hdDogJ2VzbScgfSxcbiAgICBjdHN4OiB7IGxvYWRlcjogJ3RzeCcsIGZvcm1hdDogJ2NqcycgfSxcbiAgICBtdHN4OiB7IGxvYWRlcjogJ3RzeCcsIGZvcm1hdDogJ2VzbScgfSxcbiAgICB0c3g6IHsgbG9hZGVyOiAndHN4JywgZm9ybWF0OiAnZXNtJyB9LFxuICB9O1xuXG4gIHJldHVybiB7XG4gICAgdHJhbnNmb3JtOiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICBPYmplY3QuZW50cmllcyhsb2FkZXJCeUV4dCkubWFwKChbZXh0LCBvcHRzXSkgPT4gW1xuICAgICAgICBgXi4rXFxcXC4ke2V4dH0kYCxcbiAgICAgICAgW1xuICAgICAgICAgIGVzYnVpbGQsXG4gICAgICAgICAge1xuICAgICAgICAgICAgLi4uZXNidWlsZERlZmF1bHRPcHRzLFxuICAgICAgICAgICAgZm9ybWF0OiBvcHRzLmZvcm1hdCxcbiAgICAgICAgICAgIGxvYWRlcnM6IHtcbiAgICAgICAgICAgICAgW2AuJHtleHR9YF06IG9wdHMubG9hZGVyLFxuICAgICAgICAgICAgICBbYC50ZXN0LiR7ZXh0fWBdOiBvcHRzLmxvYWRlcixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIF0pXG4gICAgKSxcbiAgfTtcbn07XG5cbmV4cG9ydCBjb25zdCBjb21tb25EZWZhdWx0czogQ29uZmlnID0ge1xuICBjYWNoZURpcmVjdG9yeTogJ25vZGVfbW9kdWxlcy8uamVzdC1jYWNoZScsXG4gIHRlc3RQYXRoSWdub3JlUGF0dGVybnM6IFtcbiAgICAuLi5pZ25vcmVEaXJzLm1hcCgoZGlyKSA9PiBgPHJvb3REaXI+JHtkaXJ9YCksXG4gICAgJzxyb290RGlyPi8uKi90ZXN0LWNhc2VzLycsXG4gIF0sXG4gIHRyYW5zZm9ybUlnbm9yZVBhdHRlcm5zOiBbLi4uaWdub3JlRGlycy5tYXAoKGRpcikgPT4gYDxyb290RGlyPiR7ZGlyfWApXSxcbiAgY292ZXJhZ2VQYXRoSWdub3JlUGF0dGVybnM6IFsuLi5pZ25vcmVEaXJzLm1hcCgoZGlyKSA9PiBgPHJvb3REaXI+JHtkaXJ9YCldLFxuICBtb2R1bGVQYXRoSWdub3JlUGF0dGVybnM6IFsuLi5pZ25vcmVEaXJzLm1hcCgoZGlyKSA9PiBgPHJvb3REaXI+JHtkaXJ9YCldLFxuICBtb2R1bGVGaWxlRXh0ZW5zaW9uczogW1xuICAgIC4uLm5ldyBTZXQoWy4uLmRlZmF1bHRzLm1vZHVsZUZpbGVFeHRlbnNpb25zLCAuLi5leHRlbnNpb25zXSksXG4gIF0sXG4gIGV4dGVuc2lvbnNUb1RyZWF0QXNFc206IFsnLmpzeCcsICcudHMnLCAnLm10cycsICcudHN4J10sXG4gIHJvb3REaXI6IHByb2Nlc3MuY3dkKCksXG59O1xuXG5jb25zdCBmbGF2b3JSZWdleCA9IC9cXHcrLztcblxuZXhwb3J0IGZ1bmN0aW9uIGN1c3RvbUZsYXZvclRlc3REZWZhdWx0cyhmbGF2b3I6IHN0cmluZyk6IENvbmZpZyB7XG4gIGlmIChmbGF2b3IgPT09ICd1bml0Jykge1xuICAgIHRocm93IG5ldyBFcnJvcignRmxhdm9yIGNhbm5vdCBiZSB1bml0Jyk7XG4gIH1cbiAgaWYgKCFmbGF2b3JSZWdleC50ZXN0KGZsYXZvcikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEZsYXZvciBzaG91bGQgbWF0Y2ggLyR7Zmxhdm9yUmVnZXguc291cmNlfS9gKTtcbiAgfVxuICBjb25zdCByb290cyA9IFsnPHJvb3REaXI+JywgJzxyb290RGlyPi9zcmMnXTtcbiAgY29uc3QgZmxhdm9yVGVzdEdsb2JzID0gW2BfXyR7Zmxhdm9yfV9fLyoqYF07XG4gIGNvbnN0IGV4dHMgPSBleHRlbnNpb25zLmpvaW4oJywnKTtcbiAgY29uc3QgZmxhdm9yVGVzdE1hdGNoID0gZmxhdm9yVGVzdEdsb2JzXG4gICAgLmZsYXRNYXAoKGdsb2IpID0+XG4gICAgICByb290cy5tYXAoKHJvb3QpID0+IFtyb290LCBnbG9iXS5maWx0ZXIoQm9vbGVhbikuam9pbignLycpKVxuICAgIClcbiAgICAubWFwKChnbG9iKSA9PiBbZ2xvYiwgYCoudGVzdC57JHtleHRzfX1gXS5qb2luKCcvJykpO1xuXG4gIHJldHVybiB7XG4gICAgdGVzdE1hdGNoOiBmbGF2b3JUZXN0TWF0Y2gsXG4gICAgdGVzdFRpbWVvdXQ6IDQ1XzAwMCxcbiAgICBzbG93VGVzdFRocmVzaG9sZDogMzBfMDAwLFxuICAgIGNvdmVyYWdlRGlyZWN0b3J5OiBgbm9kZV9tb2R1bGVzLy5jb3ZlcmFnZS0ke2ZsYXZvcn1gLFxuICAgIC4uLmNvbW1vbkRlZmF1bHRzLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdW5pdFRlc3REZWZhdWx0cygpOiBDb25maWcge1xuICBjb25zdCByb290cyA9IFsnPHJvb3REaXI+J107XG4gIGNvbnN0IHVuaXRUZXN0R2xvYnMgPSBbJyoqL19fdGVzdHNfXy8qKicsICcqKiddO1xuICBjb25zdCBleHRzID0gZXh0ZW5zaW9ucy5qb2luKCcsJyk7XG4gIGNvbnN0IHVuaXRUZXN0TWF0Y2ggPSB1bml0VGVzdEdsb2JzXG4gICAgLmZsYXRNYXAoKGdsb2IpID0+XG4gICAgICByb290cy5tYXAoKHJvb3QpID0+IFtyb290LCBnbG9iXS5maWx0ZXIoQm9vbGVhbikuam9pbignLycpKVxuICAgIClcbiAgICAubWFwKChnbG9iKSA9PiBbZ2xvYiwgYCoudGVzdC57JHtleHRzfX1gXS5qb2luKCcvJykpO1xuXG4gIHJldHVybiB7XG4gICAgdGVzdE1hdGNoOiB1bml0VGVzdE1hdGNoLFxuICAgIGNvdmVyYWdlRGlyZWN0b3J5OiAnbm9kZV9tb2R1bGVzLy5jb3ZlcmFnZS11bml0JyxcbiAgICAuLi5jb21tb25EZWZhdWx0cyxcbiAgICB0ZXN0UGF0aElnbm9yZVBhdHRlcm5zOiBbXG4gICAgICAuLi4oY29tbW9uRGVmYXVsdHMudGVzdFBhdGhJZ25vcmVQYXR0ZXJucyB8fCBbXSksXG4gICAgICBgPHJvb3REaXI+Lyg/IV9fdGVzdHNfXykoX19bYS16QS1aMC05XStfXykvYCxcbiAgICAgIGA8cm9vdERpcj4vc3JjLyg/IV9fdGVzdHNfXykoX19bYS16QS1aMC05XStfXykvYCxcbiAgICBdLFxuICB9O1xufVxuIiwiaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gJ25vZGU6Y3J5cHRvJztcbmltcG9ydCB7IG1rZGlyLCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0IHsgam9pbiwgcmVzb2x2ZSwgc2VwIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5cbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuLi91dGlscy9tb2R1bGVSb290RGlyZWN0b3J5JztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdlbmVyYXRlU2NyaXB0KG9wdHM6IHtcbiAgc2NyaXB0OiAnc2V0dXAnIHwgJ3RlYXJkb3duJztcbiAgZmxhdm9yOiBzdHJpbmc7XG4gIHJvb3REaXI6IHN0cmluZztcbn0pIHtcbiAgY29uc3QgeyBmbGF2b3IsIHNjcmlwdCwgcm9vdERpciB9ID0gb3B0cztcblxuICBjb25zdCBzdHJlYW0gPSBmZy5zdHJlYW0oXG4gICAgW2BfXyR7Zmxhdm9yfV9fLyR7c2NyaXB0fS50c2AsIGBzcmMvX18ke2ZsYXZvcn1fXy8ke3NjcmlwdH0udHNgXSxcbiAgICB7XG4gICAgICBjd2Q6IHJvb3REaXIsXG4gICAgfVxuICApIGFzIEFzeW5jSXRlcmFibGU8c3RyaW5nPjtcblxuICBmb3IgYXdhaXQgKGNvbnN0IHNjcmlwdExvYyBvZiBzdHJlYW0pIHtcbiAgICBpZiAoc2NyaXB0TG9jKSB7XG4gICAgICBjb25zdCByb290ID0gbW9kdWxlUm9vdERpcmVjdG9yeSgpO1xuICAgICAgY29uc3QgbG9jYXRpb24gPSByZXNvbHZlKGpvaW4ocm9vdERpciwgc2NyaXB0TG9jKSk7XG5cbiAgICAgIGNvbnN0IG1vZHVsZVBhdGggPSAoaW5wdXQ6IHN0cmluZykgPT5cbiAgICAgICAgcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJ1xuICAgICAgICAgID8gYGZpbGU6Ly8ke2lucHV0LnJlcGxhY2VBbGwoc2VwLCAnLycpfWBcbiAgICAgICAgICA6IGlucHV0O1xuXG4gICAgICBjb25zdCBzY3JpcHQgPSBgaW1wb3J0IHsgcnVuVHNTY3JpcHQgfSBmcm9tICR7SlNPTi5zdHJpbmdpZnkoXG4gICAgICAgIG1vZHVsZVBhdGgoam9pbihyb290LCAnY29uZmlncy9qZXN0L2plc3RDb25maWdIZWxwZXJzLmdlbi5tanMnKSlcbiAgICAgICl9O1xuXG5leHBvcnQgZGVmYXVsdCBhc3luYyAoKSA9PiB7XG5hd2FpdCBydW5Uc1NjcmlwdCh7XG4gIGxvY2F0aW9uOiAke0pTT04uc3RyaW5naWZ5KGxvY2F0aW9uKX1cbn0pXG59YDtcblxuICAgICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTEnKVxuICAgICAgICAudXBkYXRlKHJvb3REaXIpXG4gICAgICAgIC51cGRhdGUoZmxhdm9yKVxuICAgICAgICAudXBkYXRlKHNjcmlwdClcbiAgICAgICAgLmRpZ2VzdCgpXG4gICAgICAgIC50b1N0cmluZygnaGV4Jyk7XG5cbiAgICAgIGNvbnN0IGRpciA9IGpvaW4odG1wZGlyKCksICdqZXN0LXNjcmlwdHMnKTtcbiAgICAgIGNvbnN0IGZpbGUgPSBqb2luKGRpciwgYCR7aGFzaH0ubWpzYCk7XG5cbiAgICAgIGF3YWl0IG1rZGlyKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG5cbiAgICAgIGF3YWl0IHdyaXRlRmlsZShmaWxlLCBzY3JpcHQpO1xuXG4gICAgICByZXR1cm4gZmlsZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGlzRGlyZWN0b3J5KHBhdGg6IHN0cmluZykge1xyXG4gIHJldHVybiBzdGF0KHBhdGgpXHJcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNEaXJlY3RvcnkoKSlcclxuICAgIC5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xyXG59XHJcbiIsImltcG9ydCB7IGRpcm5hbWUsIGpvaW4gfSBmcm9tICdwYXRoJztcclxuXHJcbnR5cGUgVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMgPSB7XHJcbiAgc3RhcnQ6IHN0cmluZztcclxuICBzdG9wcz86IHN0cmluZ1tdO1xyXG4gIGFwcGVuZFBhdGg/OiBzdHJpbmc7XHJcbiAgdGVzdDogKHBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTxib29sZWFuIHwgc3RyaW5nIHwgdW5kZWZpbmVkPjtcclxufTtcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiogdXB3YXJkRGlyZWN0b3J5V2FsayhvcHRzOiBVcHdhcmREaXJlY3RvcnlXYWxrT3B0cykge1xyXG4gIGxldCBjdXJyZW50ID0gb3B0cy5zdGFydDtcclxuICB3aGlsZSAoXHJcbiAgICBjdXJyZW50ICE9PSAnLycgJiZcclxuICAgIGN1cnJlbnQgIT09ICd+LycgJiZcclxuICAgICEob3B0cy5zdG9wcz8uaW5jbHVkZXMoY3VycmVudCkgPz8gZmFsc2UpXHJcbiAgKSB7XHJcbiAgICBjb25zdCBwYXRoID0gb3B0cy5hcHBlbmRQYXRoID8gam9pbihjdXJyZW50LCBvcHRzLmFwcGVuZFBhdGgpIDogY3VycmVudDtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGF3YWl0IG9wdHMudGVzdChwYXRoKTtcclxuICAgIGlmIChjYW5kaWRhdGUpIHtcclxuICAgICAgeWllbGQgdHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ3N0cmluZycgPyBjYW5kaWRhdGUgOiBwYXRoO1xyXG4gICAgfVxyXG4gICAgY3VycmVudCA9IGRpcm5hbWUoY3VycmVudCk7XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXB3YXJkRGlyZWN0b3J5U2VhcmNoKG9wdHM6IFVwd2FyZERpcmVjdG9yeVdhbGtPcHRzKSB7XHJcbiAgY29uc3Qgd2FsayA9IHVwd2FyZERpcmVjdG9yeVdhbGsob3B0cyk7XHJcbiAgZm9yIGF3YWl0IChjb25zdCBkaXIgb2Ygd2Fsaykge1xyXG4gICAgcmV0dXJuIGRpcjtcclxuICB9XHJcbiAgcmV0dXJuIHVuZGVmaW5lZDtcclxufVxyXG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcclxuXHJcbmltcG9ydCB7IGlzRGlyZWN0b3J5IH0gZnJvbSAnLi9pc0RpcmVjdG9yeSc7XHJcbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuL21vZHVsZVJvb3REaXJlY3RvcnknO1xyXG5pbXBvcnQgeyB1cHdhcmREaXJlY3RvcnlTZWFyY2ggfSBmcm9tICcuL3Vwd2FyZERpcmVjdG9yeVNlYXJjaCc7XHJcblxyXG5leHBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcclxuZXhwb3J0IHsgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uIH0gZnJvbSAnLi9sb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24nO1xyXG5leHBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3JlcG9zaXRvcnlSb290UGF0aCc7XHJcblxyXG5hc3luYyBmdW5jdGlvbiBsb29rdXAob3B0czogeyBwYXRoOiBzdHJpbmc7IGxvb2t1cFBhY2thZ2VOYW1lOiBzdHJpbmcgfSkge1xyXG4gIHJldHVybiBhd2FpdCB1cHdhcmREaXJlY3RvcnlTZWFyY2goe1xyXG4gICAgc3RhcnQ6IG1vZHVsZVJvb3REaXJlY3RvcnkoKSxcclxuICAgIGFwcGVuZFBhdGg6IGpvaW4oJ25vZGVfbW9kdWxlcycsIG9wdHMubG9va3VwUGFja2FnZU5hbWUpLFxyXG4gICAgdGVzdDogaXNEaXJlY3RvcnksXHJcbiAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBMb29rdXAgbG9jYXRpb24gZm9yIGRldkRlcGVuZGVuY2llcyBvZiBcIkByZXBrYS1raXQvdHNcIiAtIHRoaXMgZnVuY3Rpb24gd2lsbFxyXG4gKiBsb29rdXAgZm9yIFwib3B0cy5sb29rdXBQYWNrYWdlTmFtZVwiXHJcbiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmluZERldkRlcGVuZGVuY3kob3B0czogeyBsb29rdXBQYWNrYWdlTmFtZTogc3RyaW5nIH0pIHtcclxuICBjb25zdCBsb29rdXBQYWNrYWdlTmFtZSA9IG9wdHMubG9va3VwUGFja2FnZU5hbWU7XHJcblxyXG4gIHJldHVybiBhd2FpdCBsb29rdXAoe1xyXG4gICAgcGF0aDogbW9kdWxlUm9vdERpcmVjdG9yeSgpLFxyXG4gICAgbG9va3VwUGFja2FnZU5hbWUsXHJcbiAgfSk7XHJcbn1cclxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XHJcblxyXG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICdAdXRpbHMvdHMnO1xyXG5cclxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XHJcbmltcG9ydCB7IGZpbmREZXZEZXBlbmRlbmN5IH0gZnJvbSAnLi4vdXRpbHMvZmluZERldkRlcGVuZGVuY3knO1xyXG5cclxuZXhwb3J0IGNvbnN0IGplc3RQbHVnaW5Sb290ID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcclxuICBjb25zdCByZXN1bHQgPSBhd2FpdCBmaW5kRGV2RGVwZW5kZW5jeSh7XHJcbiAgICBsb29rdXBQYWNrYWdlTmFtZTogJ2VzYnVpbGQtamVzdCcsXHJcbiAgfSk7XHJcbiAgaWYgKCFyZXN1bHQpIHtcclxuICAgIGxvZ2dlci53YXJuKFxyXG4gICAgICAnSmVzdCBwbHVnaW5zIHJvb3QgY2Fubm90IGJlIGRldGVybWluZWQuIERvIHlvdSBoYXZlIFwiQHJlcGthLWtpdC90c1wiIGluIGRldkRlcGVuZGVuY2llcyBhdCB0aGUgbW9ub3JlcG8gcm9vdCBvciBhdCB0aGUgbG9jYWwgcGFja2FnZT8nXHJcbiAgICApO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBpZiAobG9nZ2VyLmxvZ0xldmVsID09PSAnZGVidWcnKSB7XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZygnRm91bmQgamVzdCBwbHVnaW5zIHJvb3QgYXQnLCBkaXJuYW1lKHJlc3VsdCkpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0ID8gZGlybmFtZShyZXN1bHQpIDogJy4nO1xyXG59KTtcclxuIiwiaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XHJcblxyXG5pbXBvcnQgdHlwZSB7IENvbmZpZyB9IGZyb20gJ2plc3QnO1xyXG5pbXBvcnQgeyByZWFkSW5pdGlhbE9wdGlvbnMgfSBmcm9tICdqZXN0LWNvbmZpZyc7XHJcblxyXG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcclxuaW1wb3J0IHsgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uIH0gZnJvbSAnLi4vdXRpbHMvbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uJztcclxuaW1wb3J0IHtcclxuICBjdXN0b21GbGF2b3JUZXN0RGVmYXVsdHMsXHJcbiAgamVzdFRyYW5zZm9ybUNvbmZpZ1Byb3AsXHJcbiAgdW5pdFRlc3REZWZhdWx0cyxcclxufSBmcm9tICcuL2NvbmZpZ0J1aWxkaW5nQmxvY2tzJztcclxuaW1wb3J0IHsgZ2VuZXJhdGVTY3JpcHQgfSBmcm9tICcuL2dlbmVyYXRlU2NyaXB0JztcclxuaW1wb3J0IHsgamVzdFBsdWdpblJvb3QgfSBmcm9tICcuL2plc3RQbHVnaW5Sb290JztcclxuXHJcbmV4cG9ydCB0eXBlIFRlc3RGbGF2b3IgPVxyXG4gIHwgJ3VuaXQnXHJcbiAgfCAnaW50ZWdyYXRpb24nXHJcbiAgfCAoc3RyaW5nICYge1xyXG4gICAgICAkJGN1c3RvbTogbmV2ZXI7XHJcbiAgICB9KTtcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNvbmZpZyhcclxuICBmbGF2b3I6IFRlc3RGbGF2b3IsXHJcbiAgcm9vdERpcjogc3RyaW5nLFxyXG4gIHBhcmVudFJvb3REaXI/OiBzdHJpbmdcclxuKSB7XHJcbiAgY29uc3QgcGx1Z2luUm9vdCA9IGplc3RQbHVnaW5Sb290KCk7XHJcblxyXG4gIGNvbnN0IGJhc2VDb25maWcgPVxyXG4gICAgZmxhdm9yID09PSAndW5pdCcgPyB1bml0VGVzdERlZmF1bHRzKCkgOiBjdXN0b21GbGF2b3JUZXN0RGVmYXVsdHMoZmxhdm9yKTtcclxuXHJcbiAgY29uc3QgZ2xvYmFsU2V0dXAgPSBnZW5lcmF0ZVNjcmlwdCh7XHJcbiAgICBzY3JpcHQ6ICdzZXR1cCcsXHJcbiAgICBmbGF2b3IsXHJcbiAgICByb290RGlyLFxyXG4gIH0pO1xyXG5cclxuICBjb25zdCBnbG9iYWxUZWFyZG93biA9IGdlbmVyYXRlU2NyaXB0KHtcclxuICAgIHNjcmlwdDogJ3RlYXJkb3duJyxcclxuICAgIGZsYXZvcixcclxuICAgIHJvb3REaXIsXHJcbiAgfSk7XHJcblxyXG4gIHByb2Nlc3MuZW52WydURVNUX0ZMQVZPUiddID0gZmxhdm9yO1xyXG5cclxuICBjb25zdCBqZXN0Q29uZmlnID0gcmVhZEluaXRpYWxPcHRpb25zKHVuZGVmaW5lZCwge1xyXG4gICAgcGFja2FnZVJvb3RPckNvbmZpZzogcm9vdERpcixcclxuICAgIHBhcmVudENvbmZpZ0Rpcm5hbWU6IHBhcmVudFJvb3REaXIsXHJcbiAgICByZWFkRnJvbUN3ZDogZmFsc2UsXHJcbiAgICBza2lwTXVsdGlwbGVDb25maWdFcnJvcjogdHJ1ZSxcclxuICB9KTtcclxuXHJcbiAgY29uc3QgcmVzb2x2ZWRDb25maWcgPSAoYXdhaXQgamVzdENvbmZpZykuY29uZmlnO1xyXG5cclxuICBjb25zdCBjb25maWcgPSB7XHJcbiAgICAuLi5iYXNlQ29uZmlnLFxyXG4gICAgLi4uamVzdFRyYW5zZm9ybUNvbmZpZ1Byb3AoYXdhaXQgcGx1Z2luUm9vdCksXHJcbiAgICAuLi5yZXNvbHZlZENvbmZpZyxcclxuICAgIGdsb2JhbFNldHVwOiBhd2FpdCBnbG9iYWxTZXR1cCxcclxuICAgIGdsb2JhbFRlYXJkb3duOiBhd2FpdCBnbG9iYWxUZWFyZG93bixcclxuICB9O1xyXG5cclxuICByZXR1cm4gY29uZmlnO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlSmVzdENvbmZpZ0ZvclNpbmdsZVBhY2thZ2Uoe1xyXG4gIGZsYXZvciA9ICd1bml0JyxcclxuICByb290RGlyID0gcHJvY2Vzcy5jd2QoKSxcclxufToge1xyXG4gIGZsYXZvcjogVGVzdEZsYXZvcjtcclxuICByb290RGlyPzogc3RyaW5nO1xyXG59KTogUHJvbWlzZTxDb25maWc+IHtcclxuICByZXR1cm4gYXdhaXQgY3JlYXRlQ29uZmlnKGZsYXZvciwgcm9vdERpcik7XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVKZXN0Q29uZmlnRm9yTW9ub3JlcG8oe1xyXG4gIGZsYXZvciA9ICd1bml0JyxcclxuICBjd2QgPSBwcm9jZXNzLmN3ZCgpLFxyXG59OiB7XHJcbiAgZmxhdm9yOiBUZXN0Rmxhdm9yO1xyXG4gIGN3ZDogc3RyaW5nO1xyXG59KTogUHJvbWlzZTxDb25maWc+IHtcclxuICBjb25zdCByZXBvQ29uZmlnID0gYXdhaXQgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uKCk7XHJcblxyXG4gIGlmIChyZXBvQ29uZmlnLnR5cGUgPT09ICdzaW5nbGUtcGFja2FnZScpIHtcclxuICAgIHJldHVybiBjcmVhdGVKZXN0Q29uZmlnRm9yU2luZ2xlUGFja2FnZSh7XHJcbiAgICAgIGZsYXZvcixcclxuICAgICAgcm9vdERpcjogcmVwb0NvbmZpZy5yb290LFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBpZiAocmVwb0NvbmZpZy5yb290ICE9PSBjd2QpIHtcclxuICAgIHJldHVybiBjcmVhdGVKZXN0Q29uZmlnRm9yU2luZ2xlUGFja2FnZSh7IGZsYXZvciwgcm9vdERpcjogY3dkIH0pO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgcHJvamVjdHMgPSAoXHJcbiAgICBhd2FpdCBQcm9taXNlLmFsbChcclxuICAgICAgcmVwb0NvbmZpZy5wYWNrYWdlTG9jYXRpb25zLm1hcChhc3luYyAobG9jYXRpb24pID0+IHtcclxuICAgICAgICBjb25zdCBiYXNlQ29uZmlnID0gY3JlYXRlQ29uZmlnKGZsYXZvciwgbG9jYXRpb24sIGN3ZCk7XHJcbiAgICAgICAgY29uc3QgcGFja2FnZUpzb24gPSByZWFkUGFja2FnZUpzb24oam9pbihsb2NhdGlvbiwgJ3BhY2thZ2UuanNvbicpKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgLi4uKGF3YWl0IGJhc2VDb25maWcpLFxyXG4gICAgICAgICAgcm9vdERpcjogbG9jYXRpb24sXHJcbiAgICAgICAgICBkaXNwbGF5TmFtZTogKGF3YWl0IHBhY2thZ2VKc29uKS5uYW1lLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH0pXHJcbiAgICApXHJcbiAgKS5maWx0ZXIoQm9vbGVhbik7XHJcblxyXG4gIGNvbnN0IHRlc3RUaW1lb3V0ID0gcHJvamVjdHMucmVkdWNlKFxyXG4gICAgKGFjYywgcHJvamVjdCkgPT5cclxuICAgICAgTWF0aC5tYXgoXHJcbiAgICAgICAgYWNjLFxyXG4gICAgICAgIHR5cGVvZiBwcm9qZWN0LnRlc3RUaW1lb3V0ID09PSAnbnVtYmVyJyA/IHByb2plY3QudGVzdFRpbWVvdXQgOiAwXHJcbiAgICAgICksXHJcbiAgICAwXHJcbiAgKTtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIC4uLih0ZXN0VGltZW91dCAhPT0gMCAmJiB7XHJcbiAgICAgIHRlc3RUaW1lb3V0LFxyXG4gICAgfSksXHJcbiAgICBwcm9qZWN0czogcHJvamVjdHMubWFwKFxyXG4gICAgICAoeyBjb3ZlcmFnZURpcmVjdG9yeSwgdGVzdFRpbWVvdXQsIC4uLnByb2plY3QgfSkgPT4gcHJvamVjdFxyXG4gICAgKSxcclxuICB9O1xyXG59XHJcbiJdLCJuYW1lcyI6WyJwYXRoIiwicmVzdWx0Iiwic2NyaXB0IiwidGVzdFRpbWVvdXQiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7QUFDTyxTQUFTLGFBQWEsR0FBcUIsRUFBQTtBQUNoRCxFQUFPLE9BQUEsR0FBQSxDQUFJLE9BQVEsQ0FBQSxxQkFBQSxFQUF1QixNQUFNLENBQUEsQ0FBQTtBQUNsRDs7QUNITyxTQUFTLFNBQ2QsS0FDeUIsRUFBQTtBQUN6QixFQUFBLE9BQU8sUUFBUSxLQUFLLENBQUEs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
