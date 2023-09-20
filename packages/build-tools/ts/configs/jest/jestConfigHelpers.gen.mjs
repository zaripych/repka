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
  const isBundledInRoot = () => parent.endsWith(sep + "@repka-kit/ts".replace("/", sep));
  const isBundledInDist = () => parent.endsWith(sep + "dist");
  const isBundledInBin = () => parent.endsWith(sep + "bin") && !superParent.endsWith(sep + "src");
  if (isBundledInRoot() || isBundledInBin() || isBundledInDist()) {
    return {
      type: "bundled",
      path: fileURLToPath(new URL(`./`, opts.importMetaUrl))
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
  return path === cwdPackageJsonPath() ? await readCwdPackageJson() : await readPackageJsonAt(path, deps);
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

async function tryReadingPnpmWorkspaceYaml(monorepoRoot) {
  const text = await readFile(
    join(monorepoRoot, "pnpm-workspace.yaml"),
    "utf-8"
  );
  const rootPath = load(text);
  return Array.isArray(rootPath.packages) && rootPath.packages.length > 0 ? rootPath.packages : void 0;
}
async function tryReadingPackageJsonWorkspaces(monorepoRoot) {
  const packageJson = await readPackageJson(join(monorepoRoot, "package.json"));
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

async function loadRepositoryConfiguration() {
  const [{ root, packagesGlobs }] = await Promise.all([
    readMonorepoPackagesGlobs()
  ]);
  if (packagesGlobs.length === 0) {
    return {
      root,
      packagesGlobs,
      packageLocations: [],
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
    start: opts.path,
    appendPath: join("node_modules", opts.lookupPackageName),
    test: isDirectory
  });
}
async function findDevDependency(opts) {
  const lookupPackageName = opts.lookupPackageName;
  return await lookup({
    path: opts.path ?? moduleRootDirectory(),
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL2VzY2FwZVJlZ0V4cC50cyIsIi4uLy4uLy4uLy4uL3V0aWxzL3RzL3NyYy9pc1RydXRoeS50cyIsIi4uLy4uLy4uLy4uL3V0aWxzL3RzL3NyYy9vbmNlLnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL29uY2VBc3luYy50cyIsIi4uLy4uL3NyYy9sb2dnZXIvbG9nZ2VyLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3N0YWNrVHJhY2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blRvUHJvbWlzZS50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduUmVzdWx0LnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25PdXRwdXQudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeS50cyIsIi4uLy4uL3NyYy91dGlscy9iaW5QYXRoLnRzIiwiLi4vLi4vc3JjL3J1blRzU2NyaXB0LnRzIiwiLi4vLi4vc3JjL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24udHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy9qZXN0L2NvbmZpZ0J1aWxkaW5nQmxvY2tzLnRzIiwiLi4vLi4vc3JjL2plc3QvZ2VuZXJhdGVTY3JpcHQudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNEaXJlY3RvcnkudHMiLCIuLi8uLi9zcmMvdXRpbHMvdXB3YXJkRGlyZWN0b3J5U2VhcmNoLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2ZpbmREZXZEZXBlbmRlbmN5LnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdFBsdWdpblJvb3QudHMiLCIuLi8uLi9zcmMvamVzdC9jcmVhdGVKZXN0Q29uZmlnLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIGh0dHBzOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzM0NDYxNzAvZXNjYXBlLXN0cmluZy1mb3ItdXNlLWluLWphdmFzY3JpcHQtcmVnZXhcbmV4cG9ydCBmdW5jdGlvbiBlc2NhcGVSZWdFeHAoc3RyOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc3RyLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gaXNUcnV0aHk8VD4oXG4gIHZhbHVlOiBOb25OdWxsYWJsZTxUPiB8IGZhbHNlIHwgbnVsbCB8IHVuZGVmaW5lZCB8ICcnIHwgMFxuKTogdmFsdWUgaXMgTm9uTnVsbGFibGU8VD4ge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSk7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZTxUPihmbjogKCkgPT4gVCk6ICgpID0+IFQge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiAoKTogVCA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdmFsdWUgPSBmbigpO1xuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBvbmNlQXN5bmM8VD4oZm46ICgpID0+IFQgfCBQcm9taXNlPFQ+KTogKCkgPT4gUHJvbWlzZTxUPiB7XG4gIGxldCB2YWx1ZTogVDtcbiAgbGV0IGluRmxpZ2h0OiBQcm9taXNlPFQ+IHwgbnVsbDtcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcbiAgcmV0dXJuIGFzeW5jICgpOiBQcm9taXNlPFQ+ID0+IHtcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICBpZiAoaW5GbGlnaHQpIHtcbiAgICAgIHJldHVybiBpbkZsaWdodDtcbiAgICB9XG4gICAgaW5GbGlnaHQgPSBQcm9taXNlLnJlc29sdmUoZm4oKSk7XG4gICAgdmFsdWUgPSBhd2FpdCBpbkZsaWdodDtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICBpbkZsaWdodCA9IG51bGw7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xufVxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XG5cbmNvbnN0IGxldmVscyA9IFsnZGVidWcnLCAnaW5mbycsICd3YXJuJywgJ2Vycm9yJywgJ2ZhdGFsJ10gYXMgY29uc3Q7XG5cbnR5cGUgTG9nTGV2ZWwgPSB0eXBlb2YgbGV2ZWxzW251bWJlcl07XG5cbnR5cGUgUGFyYW1zID0gUGFyYW1ldGVyczx0eXBlb2YgY29uc29sZS5sb2c+O1xuXG50eXBlIExvZ2dlciA9IHtcbiAgbG9nTGV2ZWw6IExvZ0xldmVsO1xuICBkZWJ1ZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGluZm8oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBhbGlhcyBmb3IgaW5mb1xuICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBzcGVjaWFsIHRyZWF0bWVudCwgZGlzYWJsZWQgb24gQ0kvVFRZXG4gIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbn07XG5cbmNvbnN0IGVuYWJsZWRMZXZlbHNBZnRlciA9IChsZXZlbDogTG9nTGV2ZWwgfCAnb2ZmJykgPT4ge1xuICBpZiAobGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIGNvbnN0IGluZGV4ID0gbGV2ZWxzLmZpbmRJbmRleCgoaXRlbSkgPT4gaXRlbSA9PT0gbGV2ZWwpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxldmVsJyk7XG4gIH1cbiAgcmV0dXJuIGxldmVscy5zbGljZShpbmRleCk7XG59O1xuXG5jb25zdCBpc0xldmVsID0gKGxldmVsPzogc3RyaW5nKTogbGV2ZWwgaXMgTG9nTGV2ZWwgPT4ge1xuICByZXR1cm4gbGV2ZWxzLmluY2x1ZGVzKGxldmVsIGFzIExvZ0xldmVsKTtcbn07XG5cbmNvbnN0IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncyA9IChcbiAgYXJncyA9IHByb2Nlc3MuYXJndlxuKTogTG9nTGV2ZWwgfCAnb2ZmJyB8IHVuZGVmaW5lZCA9PiB7XG4gIGNvbnN0IGluZGV4ID0gYXJncy5maW5kSW5kZXgoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gJy0tbG9nLWxldmVsJyk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGNvbnN0IGxldmVsID0gYXJnc1tpbmRleCArIDFdO1xuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiAnb2ZmJztcbiAgfVxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlGcm9tRW52ID0gKCk6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xuICBjb25zdCBsZXZlbCA9IHByb2Nlc3MuZW52WydMT0dfTEVWRUwnXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgZ2V0VmVyYm9zaXR5Q29uZmlnID0gKCkgPT4ge1xuICBjb25zdCBhcmdzTGV2ZWwgPSB2ZXJib3NpdHlGcm9tUHJvY2Vzc0FyZ3MoKTtcbiAgY29uc3QgZW52TGV2ZWwgPSB2ZXJib3NpdHlGcm9tRW52KCk7XG4gIHJldHVybiBhcmdzTGV2ZWwgPz8gZW52TGV2ZWwgPz8gJ2luZm8nO1xufTtcblxuY29uc3Qgbm9vcCA9ICguLi5fYXJnczogUGFyYW1zKSA9PiB7XG4gIHJldHVybjtcbn07XG5cbmNvbnN0IGxvZyA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5sb2coLi4uYXJncyk7XG59O1xuXG5jb25zdCBlcnJvciA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5lcnJvciguLi5hcmdzKTtcbn07XG5cbmNvbnN0IHNob3VsZEVuYWJsZVRpcCA9ICgpID0+ICFwcm9jZXNzLmVudlsnQ0knXSAmJiAhcHJvY2Vzcy5zdGRvdXQuaXNUVFk7XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoXG4gIGRlcHMgPSB7IGdldFZlcmJvc2l0eUNvbmZpZywgbG9nLCBlcnJvciwgc2hvdWxkRW5hYmxlVGlwIH1cbikgPT4ge1xuICBjb25zdCBsb2dMZXZlbCA9IGRlcHMuZ2V0VmVyYm9zaXR5Q29uZmlnKCk7XG4gIGNvbnN0IGVuYWJsZWQgPSBlbmFibGVkTGV2ZWxzQWZ0ZXIobG9nTGV2ZWwpO1xuICByZXR1cm4gbGV2ZWxzLnJlZHVjZShcbiAgICAoYWNjLCBsdmwpID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmFjYyxcbiAgICAgICAgW2x2bF06IGVuYWJsZWQuaW5jbHVkZXMobHZsKVxuICAgICAgICAgID8gWydmYXRhbCcsICdlcnJvciddLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICAgID8gZGVwcy5lcnJvclxuICAgICAgICAgICAgOiBkZXBzLmxvZ1xuICAgICAgICAgIDogbm9vcCxcbiAgICAgIH07XG4gICAgfSxcbiAgICB7XG4gICAgICBsb2dMZXZlbCxcbiAgICAgIGxvZzogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpID8gZGVwcy5sb2cgOiBub29wLFxuICAgICAgdGlwOiBlbmFibGVkLmluY2x1ZGVzKCdpbmZvJykgJiYgZGVwcy5zaG91bGRFbmFibGVUaXAoKSA/IGRlcHMubG9nIDogbm9vcCxcbiAgICB9IGFzIExvZ2dlclxuICApO1xufTtcblxuY29uc3QgY3JlYXRlRGVsZWdhdGluZ0xvZ2dlciA9IChvcHRzOiB7IHBhcmVudDogTG9nZ2VyIH0pOiBMb2dnZXIgPT5cbiAgT2JqZWN0LmZyZWV6ZSh7XG4gICAgZ2V0IGxvZ0xldmVsKCkge1xuICAgICAgcmV0dXJuIG9wdHMucGFyZW50LmxvZ0xldmVsO1xuICAgIH0sXG4gICAgZGVidWcoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmRlYnVnKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5pbmZvKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmxvZyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgdGlwKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC50aXAoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50Lndhcm4oLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGVycm9yKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5lcnJvciguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgZmF0YWwoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmZhdGFsKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgfSk7XG5cbmxldCBkZWZhdWx0TG9nZ2VyRmFjdG9yeTogKCgpID0+IExvZ2dlcikgfCBudWxsO1xuXG5leHBvcnQgY29uc3QgY29uZmlndXJlRGVmYXVsdExvZ2dlciA9IChmYWN0b3J5OiAoKSA9PiBMb2dnZXIpID0+IHtcbiAgaWYgKGRlZmF1bHRMb2dnZXJGYWN0b3J5KSB7XG4gICAgY29uc3QgZXJyb3IgPSB7XG4gICAgICBzdGFjazogJycsXG4gICAgfTtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShlcnJvcik7XG4gICAgbG9nZ2VyLmRlYnVnKCdDYW5ub3Qgb3ZlcnJpZGUgZGVmYXVsdCBsb2dnZXIgbXVsdGlwbGUgdGltZXMnLCBlcnJvci5zdGFjayk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGRlZmF1bHRMb2dnZXJGYWN0b3J5ID0gZmFjdG9yeTtcbn07XG5cbmNvbnN0IGRlZmF1bHRMb2dnZXIgPSBvbmNlKCgpID0+IHtcbiAgbGV0IGZhY3RvcnkgPSBkZWZhdWx0TG9nZ2VyRmFjdG9yeTtcbiAgaWYgKCFmYWN0b3J5KSB7XG4gICAgZmFjdG9yeSA9ICgpID0+IGNyZWF0ZUxvZ2dlcigpO1xuICB9XG4gIHJldHVybiBmYWN0b3J5KCk7XG59KTtcblxuLyoqXG4gKiBEZWZhdWx0IGxvZ2dlciBpbnN0YW5jZSBjYW4gYmUgY29uZmlndXJlZCBvbmNlIGF0IHN0YXJ0dXBcbiAqL1xuZXhwb3J0IGNvbnN0IGxvZ2dlcjogTG9nZ2VyID0gY3JlYXRlRGVsZWdhdGluZ0xvZ2dlcih7XG4gIGdldCBwYXJlbnQoKSB7XG4gICAgcmV0dXJuIGRlZmF1bHRMb2dnZXIoKTtcbiAgfSxcbn0pO1xuIiwiLyoqXG4gKiBDYXB0dXJlIHRoZSBzdGFjayB0cmFjZSBhbmQgYWxsb3cgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgdGhyb3duIGluIGFzeW5jaHJvbm91cyBjYWxsYmFja3NcbiAqIHdpdGggYWRkaXRpb25hbCBzdGFjayBpbmZvcm1hdGlvbiBjYXB0dXJlZCBhdCB0aGUgbW9tZW50IG9mIHRoZSBjYWxsIG9mIHRoaXMgZnVuY3Rpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhcHR1cmVTdGFja1RyYWNlKHJlbW92ZSA9IDApIHtcbiAgY29uc3Qgc3RhY2tDb250YWluZXIgPSB7XG4gICAgc3RhY2s6ICcnLFxuICB9O1xuICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShzdGFja0NvbnRhaW5lcik7XG4gIGNvbnN0IHN0YWNrVHJhY2UgPSBzdGFja0NvbnRhaW5lci5zdGFja1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuc2xpY2UoNiArIHJlbW92ZSlcbiAgICAuam9pbignXFxuJyk7XG4gIHJldHVybiB7XG4gICAgLyoqXG4gICAgICogQ2FwdHVyZWQgc3RhY2sgdHJhY2UgaW5mb3JtYXRpb25cbiAgICAgKi9cbiAgICBzdGFja1RyYWNlLFxuICAgIC8qKlxuICAgICAqIENhbiBiZSBjYWxsZWQgaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrIHRvIGVucmljaCBleGNlcHRpb25zIHdpdGggYWRkaXRpb25hbCBpbmZvcm1hdGlvblxuICAgICAqIEBwYXJhbSBlcnIgRXhjZXB0aW9uIHRvIGVucmljaCAtIGl0IGlzIGdvaW5nIHRvIGhhdmUgaXRzIGAuc3RhY2tgIHByb3AgbXV0YXRlZFxuICAgICAqIEByZXR1cm5zIFNhbWUgZXhjZXB0aW9uXG4gICAgICovXG4gICAgcHJlcGFyZUZvclJldGhyb3c6IChlcnI6IEVycm9yKSA9PiB7XG4gICAgICBjb25zdCBvbGRTdGFja1RyYWNlID0gZXJyLnN0YWNrID8/ICcnLnNwbGl0KCdcXG4nKS5zbGljZSgxKS5qb2luKCdcXG4nKTtcbiAgICAgIGVyci5zdGFjayA9IGAke2Vyci5uYW1lIHx8ICdFcnJvcid9OiAke1xuICAgICAgICBlcnIubWVzc2FnZVxuICAgICAgfVxcbiR7b2xkU3RhY2tUcmFjZX1cXG4ke3N0YWNrVHJhY2V9YDtcbiAgICAgIHJldHVybiBlcnI7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHNwYXduIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IEFzc2lnbiB9IGZyb20gJ3V0aWxpdHktdHlwZXMnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IGNhcHR1cmVTdGFja1RyYWNlIH0gZnJvbSAnLi4vdXRpbHMvc3RhY2tUcmFjZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduVG9Qcm9taXNlT3B0cyA9IHtcbiAgLyoqXG4gICAqIFNwZWNpZnkgZXhpdCBjb2RlcyB3aGljaCBzaG91bGQgbm90IHJlc3VsdCBpbiB0aHJvd2luZyBhbiBlcnJvciB3aGVuXG4gICAqIHRoZSBwcm9jZXNzIGhhcyBmaW5pc2hlZCwgZS5nLiBzcGVjaWZ5aW5nIGBbMF1gIG1lYW5zIGlmIHByb2Nlc3MgZmluaXNoZWRcbiAgICogd2l0aCB6ZXJvIGV4aXQgY29kZSB0aGVuIHRoZSBwcm9taXNlIHdpbGwgcmVzb2x2ZSBpbnN0ZWFkIG9mIHJlamVjdGluZy5cbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgc3BlY2lmeSBgaW5oZXJpdGAgdG8gc2F2ZSBzdGF0dXMgY29kZSB0byB0aGUgY3VycmVudCBgcHJvY2Vzcy5leGl0Q29kZWBcbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgY29tcGxldGVseSBpZ25vcmUgdGhlIGV4aXQgY29kZSAoZS5nLiB5b3UgZm9sbG93IHVwIGFuZCBpbnRlcnJvZ2F0ZVxuICAgKiB0aGUgcHJvY2VzcyBjb2RlIG1hbnVhbGx5IGFmdGVyd2FyZHMpXG4gICAqL1xuICBleGl0Q29kZXM6IG51bWJlcltdIHwgJ2luaGVyaXQnIHwgJ2FueSc7XG59O1xuXG50eXBlIFNoYXJlZE9wdHMgPSBQaWNrPFNwYXduT3B0aW9ucywgJ2N3ZCc+O1xuXG50eXBlIFNwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PiA9IFtcbiAgY29tbWFuZDogc3RyaW5nLFxuICBhcmdzOiBSZWFkb25seUFycmF5PHN0cmluZz4sXG4gIG9wdGlvbnM6IEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+XG5dO1xuXG5leHBvcnQgdHlwZSBTcGF3bk9wdGlvbnNXaXRoRXh0cmE8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICBBc3NpZ248U3Bhd25PcHRpb25zLCBFPjtcblxuZXhwb3J0IHR5cGUgU3Bhd25QYXJhbWV0ZXJNaXg8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICB8IFtjcDogQ2hpbGRQcm9jZXNzLCBleHRyYU9wdHM6IEFzc2lnbjxFLCBTaGFyZWRPcHRzPl1cbiAgfCBTcGF3bkFyZ3M8RT47XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgYXJnczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbik6IGFyZ3MgaXMgU3Bhd25BcmdzPEU+IHtcbiAgcmV0dXJuICEoYXJnc1swXSBpbnN0YW5jZW9mIENoaWxkUHJvY2VzcykgJiYgdHlwZW9mIGFyZ3NbMF0gPT09ICdzdHJpbmcnO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzPEUgZXh0ZW5kcyBvYmplY3Q+KFxuICBwYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxFPlxuKSB7XG4gIGNvbnN0IFtjaGlsZCwgW2NvbW1hbmQsIGFyZ3MsIG9wdHNdXSA9IGlzU3Bhd25BcmdzKHBhcmFtZXRlcnMpXG4gICAgPyBbXG4gICAgICAgIHNwYXduKC4uLihwYXJhbWV0ZXJzIGFzIHVua25vd24gYXMgUGFyYW1ldGVyczx0eXBlb2Ygc3Bhd24+KSksXG4gICAgICAgIHBhcmFtZXRlcnMsXG4gICAgICBdXG4gICAgOiBbXG4gICAgICAgIHBhcmFtZXRlcnNbMF0sXG4gICAgICAgIFtcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduZmlsZSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduYXJncy5zbGljZSgxKSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzFdIGFzIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+LFxuICAgICAgICBdLFxuICAgICAgXTtcbiAgcmV0dXJuIHtcbiAgICBjaGlsZCxcbiAgICBjb21tYW5kLFxuICAgIGFyZ3MsXG4gICAgb3B0cyxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduVG9Qcm9taXNlKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHsgY2hpbGQsIGNvbW1hbmQsIGFyZ3MsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgeyBwcmVwYXJlRm9yUmV0aHJvdyB9ID0gY2FwdHVyZVN0YWNrVHJhY2UoKTtcblxuICBjb25zdCBleGl0Q29kZXMgPSBvcHRzLmV4aXRDb2RlcztcblxuICBjb25zdCBjd2QgPSBvcHRzLmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY21kID0gKCkgPT4gW2NvbW1hbmQsIC4uLmFyZ3NdLmpvaW4oJyAnKTtcblxuICBsb2dnZXIuZGVidWcoWyc+JywgY21kKCldLmpvaW4oJyAnKSwgLi4uKGN3ZCA/IFtgaW4gJHtjd2R9YF0gOiBbXSkpO1xuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMsIHJlaikgPT5cbiAgICBjaGlsZFxuICAgICAgLm9uKCdjbG9zZScsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGV4aXRDb2RlcyAhPT0gJ2luaGVyaXQnICYmXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdhbnknICYmXG4gICAgICAgICAgICAhZXhpdENvZGVzLmluY2x1ZGVzKGNvZGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZWooXG4gICAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihgQ29tbWFuZCBcIiR7Y21kKCl9XCIgaGFzIGZhaWxlZCB3aXRoIGNvZGUgJHtjb2RlfWApXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgICByZWooXG4gICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBGYWlsZWQgdG8gZXhlY3V0ZSBjb21tYW5kIFwiJHtjbWQoKX1cIiAtICR7c2lnbmFsfWApXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLm9uKCdlcnJvcicsIHJlailcbiAgKTtcbiAgLy8gaW5oZXJpdCBleGl0IGNvZGVcbiAgaWYgKGV4aXRDb2RlcyA9PT0gJ2luaGVyaXQnKSB7XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIGNoaWxkLmV4aXRDb2RlID09PSAnbnVtYmVyJyAmJlxuICAgICAgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJyB8fCBwcm9jZXNzLmV4aXRDb2RlID09PSAwKVxuICAgICkge1xuICAgICAgcHJvY2Vzcy5leGl0Q29kZSA9IGNoaWxkLmV4aXRDb2RlO1xuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuXG5pbXBvcnQgdHlwZSB7IFNwYXduUGFyYW1ldGVyTWl4LCBTcGF3blRvUHJvbWlzZU9wdHMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcblxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRPcHRzID0ge1xuICBvdXRwdXQ/OlxuICAgIHwgQXJyYXk8J3N0ZG91dCcgfCAnc3RkZXJyJz5cbiAgICB8IFsnc3Rkb3V0JyB8ICdzdGRlcnInLCAuLi5BcnJheTwnc3Rkb3V0JyB8ICdzdGRlcnInPl07XG4gIGJ1ZmZlcnM/OiB7XG4gICAgY29tYmluZWQ/OiBzdHJpbmdbXTtcbiAgICBzdGRvdXQ/OiBzdHJpbmdbXTtcbiAgICBzdGRlcnI/OiBzdHJpbmdbXTtcbiAgfTtcbn0gJiBTcGF3blRvUHJvbWlzZU9wdHM7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0UmV0dXJuID0ge1xuICBwaWQ/OiBudW1iZXI7XG4gIG91dHB1dDogc3RyaW5nW107XG4gIHN0ZG91dDogc3RyaW5nO1xuICBzdGRlcnI6IHN0cmluZztcbiAgc3RhdHVzOiBudW1iZXIgfCBudWxsO1xuICBzaWduYWw6IE5vZGVKUy5TaWduYWxzIHwgbnVsbDtcbiAgZXJyb3I/OiBFcnJvciB8IHVuZGVmaW5lZDtcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blJlc3VsdChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxTcGF3blJlc3VsdFJldHVybj4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IGNvbWJpbmVkRGF0YTogc3RyaW5nW10gPSBvcHRzLmJ1ZmZlcnM/LmNvbWJpbmVkID8/IFtdO1xuICBjb25zdCBzdGRvdXREYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3Rkb3V0ID8/IFtdO1xuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3RkZXJyID8/IFtdO1xuICBjb25zdCBvdXRwdXQgPSBvcHRzLm91dHB1dCA/PyBbJ3N0ZG91dCcsICdzdGRlcnInXTtcbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3Rkb3V0JykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZG91dCxcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRvdXRcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRvdXREYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3RkZXJyJykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZGVycixcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRlcnJcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3NwYXduVG9Qcm9taXNlKGNoaWxkLCBvcHRzKV0pO1xuICByZXR1cm4ge1xuICAgIHBpZDogY2hpbGQucGlkLFxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcbiAgICBzdGF0dXM6IGNoaWxkLmV4aXRDb2RlLFxuICAgIGdldCBvdXRwdXQoKSB7XG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xuICAgIH0sXG4gICAgZ2V0IHN0ZGVycigpIHtcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IHN0ZG91dCgpIHtcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IGVycm9yKCkge1xuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcbiAgICAgICAgPyAocmVzdWx0LnJlYXNvbiBhcyBFcnJvcilcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMsIFNwYXduUmVzdWx0UmV0dXJuIH0gZnJvbSAnLi9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBzcGF3blJlc3VsdCB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwgb3B0cyk7XG4gIHJldHVybiByZXN1bHQub3V0cHV0LmpvaW4oJycpO1xufVxuXG5jb25zdCBkZWZhdWx0U2hvdWxkT3V0cHV0ID0gKHJlc3VsdDogU3Bhd25SZXN1bHRSZXR1cm4pID0+IHtcbiAgcmV0dXJuIHJlc3VsdC5lcnJvciB8fCByZXN1bHQuc3RhdHVzICE9PSAwIHx8IGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJztcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxcbiAgICBTcGF3blJlc3VsdE9wdHMgJiB7XG4gICAgICAvKipcbiAgICAgICAqIEJ5IGRlZmF1bHQgd2lsbCBvdXRwdXQgdG8gYHN0ZGVycmAgd2hlbiBzcGF3biByZXN1bHQgZmFpbGVkIHdpdGggYW4gZXJyb3IsIHdoZW5cbiAgICAgICAqIHN0YXR1cyBjb2RlIGlzIG5vdCB6ZXJvIG9yIHdoZW4gYExvZ2dlci5sb2dMZXZlbGAgaXMgYGRlYnVnYFxuICAgICAgICovXG4gICAgICBzaG91bGRPdXRwdXQ/OiAocmVzdWx0OiBTcGF3blJlc3VsdFJldHVybikgPT4gYm9vbGVhbjtcbiAgICB9XG4gID5cbikge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcbiAgY29uc3Qgc2hvdWxkT3V0cHV0ID0gb3B0cy5zaG91bGRPdXRwdXQgPz8gZGVmYXVsdFNob3VsZE91dHB1dDtcbiAgaWYgKHNob3VsZE91dHB1dChyZXN1bHQpKSB7XG4gICAgbG9nZ2VyLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xuICB9XG4gIGlmIChyZXN1bHQuZXJyb3IpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG59XG4iLCJpbXBvcnQgeyBkaXJuYW1lLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcblxuaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XG5cbmV4cG9ydCBjb25zdCBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCA9IChvcHRzOiB7XG4gIGltcG9ydE1ldGFVcmw6IHN0cmluZztcbn0pID0+IHtcbiAgLy8gdGhpcyBpcyBoaWdobHkgZGVwZW5kZW50IG9uIHRoZSBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZVxuICAvLyBhbmQgdGhlIGNvbnRleHQgaW4gd2hpY2ggdGhpcyBmdW5jdGlvbiBpcyBydW4gKGJ1bmRsZWQgY29kZSB2cyB0c3ggLi9zcmMvdHNmaWxlLnRzKVxuICBjb25zdCBfX2ZpbGVOYW1lID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICBjb25zdCBwYXJlbnQgPSBkaXJuYW1lKF9fZmlsZU5hbWUpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IGRpcm5hbWUocGFyZW50KTtcblxuICBjb25zdCBpc0J1bmRsZWRJblJvb3QgPSAoKSA9PlxuICAgIHBhcmVudC5lbmRzV2l0aChzZXAgKyAnQHJlcGthLWtpdC90cycucmVwbGFjZSgnLycsIHNlcCkpO1xuICBjb25zdCBpc0J1bmRsZWRJbkRpc3QgPSAoKSA9PiBwYXJlbnQuZW5kc1dpdGgoc2VwICsgJ2Rpc3QnKTtcbiAgY29uc3QgaXNCdW5kbGVkSW5CaW4gPSAoKSA9PlxuICAgIHBhcmVudC5lbmRzV2l0aChzZXAgKyAnYmluJykgJiYgIXN1cGVyUGFyZW50LmVuZHNXaXRoKHNlcCArICdzcmMnKTtcblxuICBpZiAoaXNCdW5kbGVkSW5Sb290KCkgfHwgaXNCdW5kbGVkSW5CaW4oKSB8fCBpc0J1bmRsZWRJbkRpc3QoKSkge1xuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiAnYnVuZGxlZCcgYXMgY29uc3QsXG4gICAgICBwYXRoOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4vYCwgb3B0cy5pbXBvcnRNZXRhVXJsKSksXG4gICAgfTtcbiAgfVxuXG4gIC8vIHJ1biB2aWEgdHN4IHRvIGJ1aWxkIHRoZSBAcmVwa2Eta2l0L3RzIGl0c2VsZlxuICByZXR1cm4ge1xuICAgIHR5cGU6ICdzb3VyY2UnIGFzIGNvbnN0LFxuICAgIHBhdGg6IGZpbGVVUkxUb1BhdGgobmV3IFVSTChgLi4vLi4vYCwgb3B0cy5pbXBvcnRNZXRhVXJsKSksXG4gIH07XG59O1xuXG5leHBvcnQgY29uc3QgbW9kdWxlUm9vdERpcmVjdG9yeSA9IG9uY2UoXG4gICgpID0+XG4gICAgZ2V0TW9kdWxlUm9vdERpcmVjdG9yeUZvckltcG9ydE1ldGFVcmwoeyBpbXBvcnRNZXRhVXJsOiBpbXBvcnQubWV0YS51cmwgfSlcbiAgICAgIC5wYXRoXG4pO1xuIiwiaW1wb3J0IHsgcmVhZEZpbGUsIHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGRpcm5hbWUsIGpvaW4sIHNlcCB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuL21vZHVsZVJvb3REaXJlY3RvcnknO1xuXG5hc3luYyBmdW5jdGlvbiBpc0ZpbGUoZmlsZVBhdGg6IHN0cmluZykge1xuICByZXR1cm4gYXdhaXQgc3RhdChmaWxlUGF0aClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24qIGl0ZXJhdGVOb2RlTW9kdWxlcyhzdGFydFdpdGg6IHN0cmluZywgcGF0aDogc3RyaW5nKSB7XG4gIGxldCBjdXJyZW50ID0gc3RhcnRXaXRoO1xuICB3aGlsZSAoY3VycmVudCAhPT0gc2VwICYmIGN1cnJlbnQgIT09ICd+LycpIHtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBqb2luKGN1cnJlbnQsICdub2RlX21vZHVsZXMnLCBwYXRoKTtcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGNhbmRpZGF0ZSkpIHtcbiAgICAgIHlpZWxkIGNhbmRpZGF0ZTtcbiAgICB9XG4gICAgaWYgKGN1cnJlbnQgPT09IGRpcm5hbWUoY3VycmVudCkpIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjdXJyZW50ID0gZGlybmFtZShjdXJyZW50KTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBmaW5kQmluU2NyaXB0KHN0YXJ0V2l0aDogc3RyaW5nLCBiaW5TY3JpcHRQYXRoOiBzdHJpbmcpIHtcbiAgZm9yIGF3YWl0IChjb25zdCBwYXRoIG9mIGl0ZXJhdGVOb2RlTW9kdWxlcyhzdGFydFdpdGgsIGJpblNjcmlwdFBhdGgpKSB7XG4gICAgcmV0dXJuIHBhdGg7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJpblBhdGgob3B0czoge1xuICBiaW5OYW1lOiBzdHJpbmc7XG4gIGJpblNjcmlwdFBhdGg6IHN0cmluZztcbn0pIHtcbiAgY29uc3Qgcm9vdCA9IG1vZHVsZVJvb3REaXJlY3RvcnkoKTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmluZEJpblNjcmlwdChyb290LCBvcHRzLmJpblNjcmlwdFBhdGgpO1xuICBpZiAocmVzdWx0KSB7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBmaW5kIGJpbiAke29wdHMuYmluTmFtZX1gKTtcbn1cblxuZnVuY3Rpb24gc2NyaXB0RnJvbVBhY2thZ2VKc29uKG9wdHM6IHtcbiAgYmluTmFtZTogc3RyaW5nO1xuICBwYWNrYWdlSnNvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59KSB7XG4gIGNvbnN0IGNhbmRpZGF0ZSA9IG9wdHMucGFja2FnZUpzb25bJ2JpbiddO1xuICBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gY2FuZGlkYXRlO1xuICB9IGVsc2UgaWYgKHR5cGVvZiBjYW5kaWRhdGUgPT09ICdvYmplY3QnICYmIGNhbmRpZGF0ZSAhPT0gbnVsbCkge1xuICAgIGNvbnN0IGVudHJ5ID0gKGNhbmRpZGF0ZSBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KVtvcHRzLmJpbk5hbWVdO1xuICAgIGlmICh0eXBlb2YgZW50cnkgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gZW50cnk7XG4gICAgfVxuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZXRlcm1pbmVCaW5TY3JpcHRQYXRoKG9wdHM6IHtcbiAgYmluTmFtZTogc3RyaW5nO1xuICBiaW5QYWNrYWdlTmFtZTogc3RyaW5nO1xufSkge1xuICBmb3IgYXdhaXQgKGNvbnN0IHBhdGggb2YgaXRlcmF0ZU5vZGVNb2R1bGVzKFxuICAgIG1vZHVsZVJvb3REaXJlY3RvcnkoKSxcbiAgICBqb2luKG9wdHMuYmluUGFja2FnZU5hbWUsICdwYWNrYWdlLmpzb24nKVxuICApKSB7XG4gICAgY29uc3QgcGtnID0gYXdhaXQgcmVhZEZpbGUocGF0aCwgJ3V0Zi04JylcbiAgICAgIC50aGVuKCh0ZXh0KSA9PiBKU09OLnBhcnNlKHRleHQpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgLmNhdGNoKCgpID0+IG51bGwpO1xuICAgIGlmICghcGtnKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzY3JpcHRQYXRoID0gc2NyaXB0RnJvbVBhY2thZ2VKc29uKHtcbiAgICAgIGJpbk5hbWU6IG9wdHMuYmluTmFtZSxcbiAgICAgIHBhY2thZ2VKc29uOiBwa2csXG4gICAgfSk7XG4gICAgaWYgKCFzY3JpcHRQYXRoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBjYW5kaWRhdGUgPSBqb2luKGRpcm5hbWUocGF0aCksIHNjcmlwdFBhdGgpO1xuICAgIGlmIChhd2FpdCBpc0ZpbGUoY2FuZGlkYXRlKSkge1xuICAgICAgLy8gZGVub3JtYWxpemUgYW5kIG1ha2UgdGhpcyBjb25zaXN0ZW50IG9uIGFsbCBwbGF0Zm9ybXNcbiAgICAgIC8vIGFzIHRoZSBwYXRoIHdpbGwgd29yayBib3RoIGZvciB3aW5kb3dzIGFuZCBub24td2luZG93c1xuICAgICAgcmV0dXJuIGpvaW4ob3B0cy5iaW5QYWNrYWdlTmFtZSwgc2NyaXB0UGF0aCkucmVwbGFjZUFsbChzZXAsICcvJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG4iLCJpbXBvcnQgeyBwZXJmb3JtYW5jZSB9IGZyb20gJ25vZGU6cGVyZl9ob29rcyc7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSAnbm9kZTp1cmwnO1xuXG5pbXBvcnQgeyBzcGF3bk91dHB1dENvbmRpdGlvbmFsIH0gZnJvbSAnLi9jaGlsZC1wcm9jZXNzJztcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBiaW5QYXRoIH0gZnJvbSAnLi91dGlscy9iaW5QYXRoJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRzU2NyaXB0KG9wdHM6IHtcbiAgbG9jYXRpb246IHN0cmluZztcbiAgaW1wb3J0TWV0YVVybD86IFVSTDtcbiAgYXJncz86IHN0cmluZ1tdO1xufSkge1xuICBjb25zdCBzdGFydGVkID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gIHRyeSB7XG4gICAgY29uc3QgbG9jYXRpb24gPSBvcHRzLmltcG9ydE1ldGFVcmxcbiAgICAgID8gZmlsZVVSTFRvUGF0aChuZXcgVVJMKG9wdHMubG9jYXRpb24sIG9wdHMuaW1wb3J0TWV0YVVybCkpXG4gICAgICA6IG9wdHMubG9jYXRpb247XG5cbiAgICBpZiAobG9nZ2VyLmxvZ0xldmVsICE9PSAnZGVidWcnKSB7XG4gICAgICBsb2dnZXIubG9nKGBSdW5uaW5nIFwiJHtsb2NhdGlvbn1cImApO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAgICAgcHJvY2Vzcy5leGVjUGF0aCxcbiAgICAgIFtcbiAgICAgICAgYXdhaXQgYmluUGF0aCh7XG4gICAgICAgICAgYmluTmFtZTogJ3RzeCcsXG4gICAgICAgICAgYmluU2NyaXB0UGF0aDogJ3RzeC9kaXN0L2NsaS5qcycsXG4gICAgICAgIH0pLFxuICAgICAgICBsb2NhdGlvbixcbiAgICAgICAgLi4uKG9wdHMuYXJncyB8fCBbXSksXG4gICAgICBdLFxuICAgICAge1xuICAgICAgICBleGl0Q29kZXM6IFswXSxcbiAgICAgICAgLi4uKGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJyAmJiB7XG4gICAgICAgICAgc3RkaW86ICdpbmhlcml0JyxcbiAgICAgICAgICBvdXRwdXQ6IFtdLFxuICAgICAgICB9KSxcbiAgICAgICAgZW52OiB7XG4gICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgTE9HX0xFVkVMOiBsb2dnZXIubG9nTGV2ZWwsXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAobG9nZ2VyLmxvZ0xldmVsICE9PSAnZGVidWcnKSB7XG4gICAgICBsb2dnZXIubG9nKFxuICAgICAgICBgRmluaXNoZWQgaW4gJHsoKHBlcmZvcm1hbmNlLm5vdygpIC0gc3RhcnRlZCkgLyAxMDAwKS50b0ZpeGVkKDIpfXNgXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICdAdXRpbHMvdHMnO1xuXG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi4vdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5pbXBvcnQgdHlwZSB7IFBhY2thZ2VKc29uIH0gZnJvbSAnLi9wYWNrYWdlSnNvbic7XG5cbmNvbnN0IGN3ZFBhY2thZ2VKc29uUGF0aCA9ICgpID0+IGpvaW4ocHJvY2Vzcy5jd2QoKSwgJy4vcGFja2FnZS5qc29uJyk7XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbkF0KFxuICBwYXRoOiBzdHJpbmcsXG4gIGRlcHMgPSB7IHJlYWRGaWxlOiAocGF0aDogc3RyaW5nKSA9PiByZWFkRmlsZShwYXRoLCAndXRmLTgnKSB9XG4pOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIHJldHVybiBhd2FpdCBkZXBzXG4gICAgLnJlYWRGaWxlKHBhdGgpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gSlNPTi5wYXJzZShyZXN1bHQpIGFzIFBhY2thZ2VKc29uKTtcbn1cblxuZXhwb3J0IGNvbnN0IHJlYWRDd2RQYWNrYWdlSnNvbiA9IG9uY2VBc3luYygoKSA9PlxuICByZWFkUGFja2FnZUpzb25BdChjd2RQYWNrYWdlSnNvblBhdGgoKSlcbik7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb24oXG4gIHBhdGg6IHN0cmluZyxcbiAgZGVwcyA9IHsgcmVhZEZpbGU6IChwYXRoOiBzdHJpbmcpID0+IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpIH1cbik6IFByb21pc2U8UGFja2FnZUpzb24+IHtcbiAgLy8gYXNzdW1pbmcgY3VycmVudCBkaXJlY3RvcnkgZG9lc24ndCBjaGFuZ2Ugd2hpbGUgYXBwIGlzIHJ1bm5pbmdcbiAgcmV0dXJuIHBhdGggPT09IGN3ZFBhY2thZ2VKc29uUGF0aCgpXG4gICAgPyBhd2FpdCByZWFkQ3dkUGFja2FnZUpzb24oKVxuICAgIDogYXdhaXQgcmVhZFBhY2thZ2VKc29uQXQocGF0aCwgZGVwcyk7XG59XG5cbi8qKlxuICogUmVhZCBwYWNrYWdlIGpzb24gb2YgdGhlIGN1cnJlbnQgbGlicmFyeSAoQHJlcGthLWtpdC90cylcbiAqL1xuZXhwb3J0IGNvbnN0IG91clBhY2thZ2VKc29uID0gb25jZUFzeW5jKFxuICBhc3luYyAoXG4gICAgZGVwcyA9IHtcbiAgICAgIHJlYWRGaWxlOiAocGF0aDogc3RyaW5nKSA9PiByZWFkRmlsZShwYXRoLCAndXRmLTgnKSxcbiAgICB9XG4gICkgPT4ge1xuICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IGpvaW4obW9kdWxlUm9vdERpcmVjdG9yeSgpLCAncGFja2FnZS5qc29uJyk7XG4gICAgcmV0dXJuIGF3YWl0IHJlYWRQYWNrYWdlSnNvbkF0KHBhY2thZ2VKc29uUGF0aCwge1xuICAgICAgcmVhZEZpbGU6IGRlcHMucmVhZEZpbGUsXG4gICAgfSk7XG4gIH1cbik7XG4iLCJpbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0JztcbmltcG9ydCB7IGRpcm5hbWUsIG5vcm1hbGl6ZSwgc2VwIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgZXNjYXBlUmVnRXhwLCBpc1RydXRoeSwgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcbmltcG9ydCBmZyBmcm9tICdmYXN0LWdsb2InO1xuXG5jb25zdCBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzID0gKGN1cnJlbnREaXJlY3Rvcnk6IHN0cmluZykgPT4ge1xuICBjb25zdCBlc2MgPSBlc2NhcGVSZWdFeHAoc2VwKTtcbiAgLy8gaGF2aW5nICdwYWNrYWdlcy8qJyBpbiB0aGUgcm9vdCBvZiBhIG1vbm9yZXBvIGlzIHN1cGVyIGNvbW1vblxuICBjb25zdCByZXN1bHQgPSBuZXcgUmVnRXhwKFxuICAgIGAoLiooPz0ke2VzY31wYWNrYWdlcyR7ZXNjfSkpfCguKig/PSR7ZXNjfW5vZGVfbW9kdWxlcyR7ZXNjfSkpfCguKilgXG4gICkuZXhlYyhjdXJyZW50RGlyZWN0b3J5KTtcbiAgYXNzZXJ0KCEhcmVzdWx0KTtcbiAgY29uc3QgWywgcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdID0gcmVzdWx0O1xuICByZXR1cm4gW3BhY2thZ2VzUm9vdCwgbm9kZU1vZHVsZXNSb290XS5maWx0ZXIoaXNUcnV0aHkpO1xufTtcblxuLy8gcmV0dXJucyB0aGUgZmlyc3QgZGlyZWN0b3J5IHdoaWNoIGhhcyBtb25vcmVwbyBtYXJrZXJzLCBtdWx0aXBsZVxuLy8gZGlyZWN0b3JpZXMgY2FuIGhhdmUgdGhlbSAtIHdoaWNoZXZlciByZWFkIGZpcnN0IHdpbGwgYmUgcmV0dXJuZWRcbi8vIHNvIGlmIG9yZGVyIGlzIGltcG9ydGFudCAtIHNjYW5uaW5nIHNob3VsZCBiZSBzZXBhcmF0ZWQgdG8gbXVsdGlwbGUgam9ic1xuLy8gdmlhIHByaW9yaXRpemVkSGFzTW9ub3JlcG9NYXJrZXJzXG5jb25zdCBoYXNSb290TWFya2Vyc0ZvciA9IGFzeW5jIChjYW5kaWRhdGU6IHN0cmluZykgPT4ge1xuICBjb25zdCBtYXJrZXJzID0gW1xuICAgICcuZ2l0JyxcbiAgICAneWFybi5sb2NrJyxcbiAgICAncG5wbS1sb2NrLnlhbWwnLFxuICAgICdwYWNrYWdlLWxvY2suanNvbicsXG4gICAgJ3BucG0td29ya3NwYWNlLnlhbWwnLFxuICBdO1xuICBjb25zdCBtYXJrZXJzU3RyZWFtID0gZmcuc3RyZWFtKG1hcmtlcnMsIHtcbiAgICBtYXJrRGlyZWN0b3JpZXM6IHRydWUsXG4gICAgb25seUZpbGVzOiBmYWxzZSxcbiAgICBjd2Q6IGNhbmRpZGF0ZSxcbiAgICBhYnNvbHV0ZTogdHJ1ZSxcbiAgfSk7XG4gIGZvciBhd2FpdCAoY29uc3QgZW50cnkgb2YgbWFya2Vyc1N0cmVhbSkge1xuICAgIGFzc2VydCh0eXBlb2YgZW50cnkgPT09ICdzdHJpbmcnKTtcbiAgICByZXR1cm4gZGlybmFtZShlbnRyeSk7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbmNvbnN0IGhhc1Jvb3RNYXJrZXJzID0gYXN5bmMgKGNhbmRpZGF0ZXM6IHN0cmluZ1tdKSA9PiB7XG4gIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBjYW5kaWRhdGVzLm1hcCgoY2FuZGlkYXRlKSA9PiBoYXNSb290TWFya2Vyc0ZvcihjYW5kaWRhdGUpKVxuICApO1xuICByZXR1cm4gcmVzdWx0cy5maWx0ZXIoaXNUcnV0aHkpWzBdO1xufTtcblxuY29uc3QgcHJpb3JpdGl6ZWRIYXNNYXJrZXJzID0gKGpvYnM6IHN0cmluZ1tdW10pID0+IHtcbiAgaWYgKGpvYnMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4oKHJlcykgPT4ge1xuICAgIGNvbnN0IHJlc3VsdHMgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nIHwgdW5kZWZpbmVkPigpO1xuXG4gICAgY29uc3QgY2hlY2tTaG91bGRDb21wbGV0ZSA9IChpbmRleDogbnVtYmVyLCByZXN1bHQ6IHN0cmluZyB8IHVuZGVmaW5lZCkgPT4ge1xuICAgICAgcmVzdWx0cy5zZXQoaW5kZXgsIHJlc3VsdCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGpvYnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3QgaGFzUmVzdWx0ID0gcmVzdWx0cy5oYXMoaSk7XG4gICAgICAgIGlmICghaGFzUmVzdWx0KSB7XG4gICAgICAgICAgLy8gaWYgYSBqb2Igd2l0aCBoaWdoZXN0IHByaW9yaXR5IGhhc24ndCBmaW5pc2hlZCB5ZXRcbiAgICAgICAgICAvLyB0aGVuIHdhaXQgZm9yIGl0XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzdWx0cy5nZXQoaSk7XG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAvLyBqb2IgZmluaXNoZWQgYW5kIHdlIGZvdW5kIG1hcmtlcnMsIGFsc28gYWxsIGpvYnNcbiAgICAgICAgICAvLyB3aXRoIGhpZ2hlciBwcmlvcml0eSBmaW5pc2hlZCBhbmQgdGhleSBkb24ndCBoYXZlXG4gICAgICAgICAgLy8gYW55IG1hcmtlcnMgLSB3ZSBhcmUgZG9uZVxuICAgICAgICAgIHJlcyhyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0cy5zaXplID09PSBqb2JzLmxlbmd0aCkge1xuICAgICAgICAvLyBhbGwgam9icyBmaW5pc2hlZCAtIG5vIG1hcmtlcnMgZm91bmRcbiAgICAgICAgcmVzKHVuZGVmaW5lZCk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGpvYnMuZm9yRWFjaCgoZGlyZWN0b3JpZXMsIGluZGV4KSA9PiB7XG4gICAgICBoYXNSb290TWFya2VycyhkaXJlY3RvcmllcylcbiAgICAgICAgLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGNoZWNrU2hvdWxkQ29tcGxldGUoaW5kZXgsIHJlc3VsdCk7XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gaWdub3JlXG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59O1xuXG5leHBvcnQgY29uc3QgcmVwb3NpdG9yeVJvb3RQYXRoVmlhRGlyZWN0b3J5U2NhbiA9IGFzeW5jIChcbiAgbG9va3VwRGlyZWN0b3J5OiBzdHJpbmdcbikgPT4ge1xuICBjb25zdCB1bmlxdWVEaXJuYW1lID0gKHBhdGg/OiBzdHJpbmcpID0+IHtcbiAgICBpZiAoIXBhdGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gZGlybmFtZShwYXRoKTtcbiAgICBpZiAocmVzdWx0ID09PSBwYXRoKSB7XG4gICAgICAvLyBlLmcuIHRoZSBwYXRoIHdhcyBhbHJlYWR5IGEgcm9vdCBcIi9cIlxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIGNvbnN0IHBhcmVudCA9IHVuaXF1ZURpcm5hbWUobG9va3VwRGlyZWN0b3J5KTtcbiAgY29uc3Qgc3VwZXJQYXJlbnQgPSB1bmlxdWVEaXJuYW1lKHBhcmVudCk7XG5cbiAgY29uc3QgcmVzdWx0ID1cbiAgICAoYXdhaXQgcHJpb3JpdGl6ZWRIYXNNYXJrZXJzKFxuICAgICAgLy8gc2NhbiBpbiBtb3N0IGxpa2VseSBsb2NhdGlvbnMgZmlyc3Qgd2l0aCBjdXJyZW50IGxvb2t1cCBkaXJlY3RvcnkgdGFraW5nIHByaW9yaXR5XG4gICAgICBbXG4gICAgICAgIFtsb29rdXBEaXJlY3RvcnldLFxuICAgICAgICBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzKGxvb2t1cERpcmVjdG9yeSksXG4gICAgICAgIC8vIHNjYW4gMiBkaXJlY3RvcmllcyB1cHdhcmRzXG4gICAgICAgIFtwYXJlbnRdLFxuICAgICAgICBbc3VwZXJQYXJlbnRdLFxuICAgICAgXVxuICAgICAgICAubWFwKChkaXJzKSA9PiBkaXJzLmZpbHRlcihpc1RydXRoeSkpXG4gICAgICAgIC5maWx0ZXIoKGpvYikgPT4gam9iLmxlbmd0aCA+IDApXG4gICAgKSkgfHwgbG9va3VwRGlyZWN0b3J5OyAvKiBmYWxsYmFjayB0byBjdXJyZW50IGRpcmVjdG9yeSBpbiB3b3JzZSBzY2VuYXJpbyAqL1xuXG4gIHJldHVybiBub3JtYWxpemUocmVzdWx0KTtcbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIHJlcG9zaXRvcnkgcm9vdCBwYXRoIGJ5IHNjYW5uaW5nIGN1cnJlbnQgYW5kIHBhcmVudCBkaXJlY3Rvcmllc1xuICogYW5kIGxvb2tpbmcgZm9yIG1hcmtlciBmaWxlcy9kaXJzIGxpa2U6XG4gKlxuICogLSAuZ2l0XG4gKiAtIHBhY2thZ2UtbG9jay5qc29uXG4gKiAtIHlhcm4ubG9ja1xuICogLSBwbnBtLWxvY2sueWFtbFxuICogLSBwbnBtLXdvcmtzcGFjZS55YW1sXG4gKi9cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGggPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290UGF0aCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4ocHJvY2Vzcy5jd2QoKSk7XG4gIHJldHVybiByb290UGF0aDtcbn0pO1xuIiwiaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICdAdXRpbHMvdHMnO1xuaW1wb3J0IHsgbG9hZCB9IGZyb20gJ2pzLXlhbWwnO1xuXG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmltcG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuYXN5bmMgZnVuY3Rpb24gdHJ5UmVhZGluZ1BucG1Xb3Jrc3BhY2VZYW1sKG1vbm9yZXBvUm9vdDogc3RyaW5nKSB7XG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShcbiAgICBqb2luKG1vbm9yZXBvUm9vdCwgJ3BucG0td29ya3NwYWNlLnlhbWwnKSxcbiAgICAndXRmLTgnXG4gICk7XG4gIGNvbnN0IHJvb3RQYXRoID0gbG9hZCh0ZXh0KSBhcyB7XG4gICAgcGFja2FnZXM/OiBzdHJpbmdbXTtcbiAgfTtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkocm9vdFBhdGgucGFja2FnZXMpICYmIHJvb3RQYXRoLnBhY2thZ2VzLmxlbmd0aCA+IDBcbiAgICA/IHJvb3RQYXRoLnBhY2thZ2VzXG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHRyeVJlYWRpbmdQYWNrYWdlSnNvbldvcmtzcGFjZXMobW9ub3JlcG9Sb290OiBzdHJpbmcpIHtcbiAgY29uc3QgcGFja2FnZUpzb24gPSBhd2FpdCByZWFkUGFja2FnZUpzb24oam9pbihtb25vcmVwb1Jvb3QsICdwYWNrYWdlLmpzb24nKSk7XG4gIGNvbnN0IHdvcmtzcGFjZXMgPSBwYWNrYWdlSnNvblsnd29ya3NwYWNlcyddO1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSh3b3Jrc3BhY2VzKSAmJiB3b3Jrc3BhY2VzLmxlbmd0aCA+IDBcbiAgICA/IHdvcmtzcGFjZXMuZmxhdE1hcCgoZW50cnkpID0+ICh0eXBlb2YgZW50cnkgPT09ICdzdHJpbmcnID8gW2VudHJ5XSA6IFtdKSlcbiAgICA6IHVuZGVmaW5lZDtcbn1cblxuY29uc3QgcmVhZFBhY2thZ2VzR2xvYnNBdCA9IGFzeW5jIChtb25vcmVwb1Jvb3Q6IHN0cmluZykgPT4ge1xuICBjb25zdCBbcG5wbVdvcmtzcGFjZXMsIHBhY2thZ2VKc29uV29ya3NwYWNlc10gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgdHJ5UmVhZGluZ1BucG1Xb3Jrc3BhY2VZYW1sKG1vbm9yZXBvUm9vdCkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKSxcbiAgICB0cnlSZWFkaW5nUGFja2FnZUpzb25Xb3Jrc3BhY2VzKG1vbm9yZXBvUm9vdCkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKSxcbiAgXSk7XG4gIHJldHVybiBwbnBtV29ya3NwYWNlcyB8fCBwYWNrYWdlSnNvbldvcmtzcGFjZXMgfHwgW107XG59O1xuXG4vKipcbiAqIERldGVybWluZSBtb25vcmVwbyBwYWNrYWdlcyBnbG9iIGJ5IHJlYWRpbmcgb25lIG9mIHRoZSBzdXBwb3J0ZWRcbiAqIGZpbGVzXG4gKlxuICogTk9URTogb25seSBwbnBtIGlzIHN1cHBvcnRlZCBhdCB0aGUgbW9tZW50XG4gKi9cbmV4cG9ydCBjb25zdCByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3Qgcm9vdCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICBjb25zdCBwYWNrYWdlc0dsb2JzID0gYXdhaXQgcmVhZFBhY2thZ2VzR2xvYnNBdChyb290KTtcbiAgcmV0dXJuIHtcbiAgICByb290LFxuICAgIHBhY2thZ2VzR2xvYnMsXG4gIH07XG59KTtcbiIsImltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcblxuaW1wb3J0IHsgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyB9IGZyb20gJy4vcmVhZFBhY2thZ2VzR2xvYnMnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uKCkge1xuICBjb25zdCBbeyByb290LCBwYWNrYWdlc0dsb2JzIH1dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMoKSxcbiAgXSk7XG5cbiAgaWYgKHBhY2thZ2VzR2xvYnMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJvb3QsXG4gICAgICBwYWNrYWdlc0dsb2JzLFxuICAgICAgcGFja2FnZUxvY2F0aW9uczogW10sXG4gICAgICB0eXBlOiAnc2luZ2xlLXBhY2thZ2UnIGFzIGNvbnN0LFxuICAgIH07XG4gIH1cblxuICBjb25zdCBwYWNrYWdlTG9jYXRpb25zID0gYXdhaXQgZmcoXG4gICAgcGFja2FnZXNHbG9icy5tYXAoKGdsb2IpID0+IGAke2dsb2J9L3BhY2thZ2UuanNvbmApLFxuICAgIHtcbiAgICAgIGN3ZDogcm9vdCxcbiAgICB9XG4gICk7XG5cbiAgcmV0dXJuIHtcbiAgICByb290LFxuICAgIHBhY2thZ2VzR2xvYnMsXG4gICAgcGFja2FnZUxvY2F0aW9uczogcGFja2FnZUxvY2F0aW9ucy5tYXAoKGxvY2F0aW9uKSA9PiBkaXJuYW1lKGxvY2F0aW9uKSksXG4gICAgdHlwZTogJ211bHRpcGxlLXBhY2thZ2VzJyBhcyBjb25zdCxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgdHlwZSB7IENvbmZpZyB9IGZyb20gJ2plc3QnO1xuaW1wb3J0IHsgZGVmYXVsdHMgfSBmcm9tICdqZXN0LWNvbmZpZyc7XG5cbmV4cG9ydCBjb25zdCBleHRlbnNpb25zID0gW1xuICAnanMnLFxuICAnY2pzJyxcbiAgJ21qcycsXG4gICdqc3gnLFxuICAndHMnLFxuICAnY3RzJyxcbiAgJ210cycsXG4gICd0c3gnLFxuXTtcblxuZXhwb3J0IGNvbnN0IGlnbm9yZURpcnMgPSBbJy9ub2RlX21vZHVsZXMvJywgJy9kaXN0LycsICcvLnRzYy1vdXQvJ107XG5cbmV4cG9ydCBjb25zdCBqZXN0VHJhbnNmb3JtQ29uZmlnUHJvcCA9IChcbiAgamVzdFBsdWdpblJvb3Q/OiBzdHJpbmdcbik6IFBpY2s8Q29uZmlnLCAndHJhbnNmb3JtJz4gPT4ge1xuICBjb25zdCBlc2J1aWxkID0gamVzdFBsdWdpblJvb3RcbiAgICA/IGpvaW4oamVzdFBsdWdpblJvb3QsICdlc2J1aWxkLWplc3QnKVxuICAgIDogJ2VzYnVpbGQtamVzdCc7XG5cbiAgY29uc3QgZXNidWlsZERlZmF1bHRPcHRzID0ge1xuICAgIHRhcmdldDogYG5vZGUke3Byb2Nlc3MudmVyc2lvbnMubm9kZX1gLFxuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgfTtcblxuICBjb25zdCBsb2FkZXJCeUV4dCA9IHtcbiAgICB0czogeyBsb2FkZXI6ICd0cycsIGZvcm1hdDogJ2VzbScgfSxcbiAgICBjdHM6IHsgbG9hZGVyOiAndHMnLCBmb3JtYXQ6ICdjanMnIH0sXG4gICAgbXRzOiB7IGxvYWRlcjogJ3RzJywgZm9ybWF0OiAnZXNtJyB9LFxuICAgIGN0c3g6IHsgbG9hZGVyOiAndHN4JywgZm9ybWF0OiAnY2pzJyB9LFxuICAgIG10c3g6IHsgbG9hZGVyOiAndHN4JywgZm9ybWF0OiAnZXNtJyB9LFxuICAgIHRzeDogeyBsb2FkZXI6ICd0c3gnLCBmb3JtYXQ6ICdlc20nIH0sXG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICB0cmFuc2Zvcm06IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIE9iamVjdC5lbnRyaWVzKGxvYWRlckJ5RXh0KS5tYXAoKFtleHQsIG9wdHNdKSA9PiBbXG4gICAgICAgIGBeLitcXFxcLiR7ZXh0fSRgLFxuICAgICAgICBbXG4gICAgICAgICAgZXNidWlsZCxcbiAgICAgICAgICB7XG4gICAgICAgICAgICAuLi5lc2J1aWxkRGVmYXVsdE9wdHMsXG4gICAgICAgICAgICBmb3JtYXQ6IG9wdHMuZm9ybWF0LFxuICAgICAgICAgICAgbG9hZGVyczoge1xuICAgICAgICAgICAgICBbYC4ke2V4dH1gXTogb3B0cy5sb2FkZXIsXG4gICAgICAgICAgICAgIFtgLnRlc3QuJHtleHR9YF06IG9wdHMubG9hZGVyLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgXSlcbiAgICApLFxuICB9O1xufTtcblxuZXhwb3J0IGNvbnN0IGNvbW1vbkRlZmF1bHRzOiBDb25maWcgPSB7XG4gIGNhY2hlRGlyZWN0b3J5OiAnbm9kZV9tb2R1bGVzLy5qZXN0LWNhY2hlJyxcbiAgdGVzdFBhdGhJZ25vcmVQYXR0ZXJuczogW1xuICAgIC4uLmlnbm9yZURpcnMubWFwKChkaXIpID0+IGA8cm9vdERpcj4ke2Rpcn1gKSxcbiAgICAnPHJvb3REaXI+Ly4qL3Rlc3QtY2FzZXMvJyxcbiAgXSxcbiAgdHJhbnNmb3JtSWdub3JlUGF0dGVybnM6IFsuLi5pZ25vcmVEaXJzLm1hcCgoZGlyKSA9PiBgPHJvb3REaXI+JHtkaXJ9YCldLFxuICBjb3ZlcmFnZVBhdGhJZ25vcmVQYXR0ZXJuczogWy4uLmlnbm9yZURpcnMubWFwKChkaXIpID0+IGA8cm9vdERpcj4ke2Rpcn1gKV0sXG4gIG1vZHVsZVBhdGhJZ25vcmVQYXR0ZXJuczogWy4uLmlnbm9yZURpcnMubWFwKChkaXIpID0+IGA8cm9vdERpcj4ke2Rpcn1gKV0sXG4gIG1vZHVsZUZpbGVFeHRlbnNpb25zOiBbXG4gICAgLi4ubmV3IFNldChbLi4uZGVmYXVsdHMubW9kdWxlRmlsZUV4dGVuc2lvbnMsIC4uLmV4dGVuc2lvbnNdKSxcbiAgXSxcbiAgZXh0ZW5zaW9uc1RvVHJlYXRBc0VzbTogWycuanN4JywgJy50cycsICcubXRzJywgJy50c3gnXSxcbiAgcm9vdERpcjogcHJvY2Vzcy5jd2QoKSxcbn07XG5cbmNvbnN0IGZsYXZvclJlZ2V4ID0gL1xcdysvO1xuXG5leHBvcnQgZnVuY3Rpb24gY3VzdG9tRmxhdm9yVGVzdERlZmF1bHRzKGZsYXZvcjogc3RyaW5nKTogQ29uZmlnIHtcbiAgaWYgKGZsYXZvciA9PT0gJ3VuaXQnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdGbGF2b3IgY2Fubm90IGJlIHVuaXQnKTtcbiAgfVxuICBpZiAoIWZsYXZvclJlZ2V4LnRlc3QoZmxhdm9yKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRmxhdm9yIHNob3VsZCBtYXRjaCAvJHtmbGF2b3JSZWdleC5zb3VyY2V9L2ApO1xuICB9XG4gIGNvbnN0IHJvb3RzID0gWyc8cm9vdERpcj4nLCAnPHJvb3REaXI+L3NyYyddO1xuICBjb25zdCBmbGF2b3JUZXN0R2xvYnMgPSBbYF9fJHtmbGF2b3J9X18vKipgXTtcbiAgY29uc3QgZXh0cyA9IGV4dGVuc2lvbnMuam9pbignLCcpO1xuICBjb25zdCBmbGF2b3JUZXN0TWF0Y2ggPSBmbGF2b3JUZXN0R2xvYnNcbiAgICAuZmxhdE1hcCgoZ2xvYikgPT5cbiAgICAgIHJvb3RzLm1hcCgocm9vdCkgPT4gW3Jvb3QsIGdsb2JdLmZpbHRlcihCb29sZWFuKS5qb2luKCcvJykpXG4gICAgKVxuICAgIC5tYXAoKGdsb2IpID0+IFtnbG9iLCBgKi50ZXN0Lnske2V4dHN9fWBdLmpvaW4oJy8nKSk7XG5cbiAgcmV0dXJuIHtcbiAgICB0ZXN0TWF0Y2g6IGZsYXZvclRlc3RNYXRjaCxcbiAgICB0ZXN0VGltZW91dDogNDVfMDAwLFxuICAgIHNsb3dUZXN0VGhyZXNob2xkOiAzMF8wMDAsXG4gICAgY292ZXJhZ2VEaXJlY3Rvcnk6IGBub2RlX21vZHVsZXMvLmNvdmVyYWdlLSR7Zmxhdm9yfWAsXG4gICAgLi4uY29tbW9uRGVmYXVsdHMsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1bml0VGVzdERlZmF1bHRzKCk6IENvbmZpZyB7XG4gIGNvbnN0IHJvb3RzID0gWyc8cm9vdERpcj4nXTtcbiAgY29uc3QgdW5pdFRlc3RHbG9icyA9IFsnKiovX190ZXN0c19fLyoqJywgJyoqJ107XG4gIGNvbnN0IGV4dHMgPSBleHRlbnNpb25zLmpvaW4oJywnKTtcbiAgY29uc3QgdW5pdFRlc3RNYXRjaCA9IHVuaXRUZXN0R2xvYnNcbiAgICAuZmxhdE1hcCgoZ2xvYikgPT5cbiAgICAgIHJvb3RzLm1hcCgocm9vdCkgPT4gW3Jvb3QsIGdsb2JdLmZpbHRlcihCb29sZWFuKS5qb2luKCcvJykpXG4gICAgKVxuICAgIC5tYXAoKGdsb2IpID0+IFtnbG9iLCBgKi50ZXN0Lnske2V4dHN9fWBdLmpvaW4oJy8nKSk7XG5cbiAgcmV0dXJuIHtcbiAgICB0ZXN0TWF0Y2g6IHVuaXRUZXN0TWF0Y2gsXG4gICAgY292ZXJhZ2VEaXJlY3Rvcnk6ICdub2RlX21vZHVsZXMvLmNvdmVyYWdlLXVuaXQnLFxuICAgIC4uLmNvbW1vbkRlZmF1bHRzLFxuICAgIHRlc3RQYXRoSWdub3JlUGF0dGVybnM6IFtcbiAgICAgIC4uLihjb21tb25EZWZhdWx0cy50ZXN0UGF0aElnbm9yZVBhdHRlcm5zIHx8IFtdKSxcbiAgICAgIGA8cm9vdERpcj4vKD8hX190ZXN0c19fKShfX1thLXpBLVowLTldK19fKS9gLFxuICAgICAgYDxyb290RGlyPi9zcmMvKD8hX190ZXN0c19fKShfX1thLXpBLVowLTldK19fKS9gLFxuICAgIF0sXG4gIH07XG59XG4iLCJpbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnbm9kZTpjcnlwdG8nO1xuaW1wb3J0IHsgbWtkaXIsIHdyaXRlRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgeyBqb2luLCByZXNvbHZlLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcblxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4uL3V0aWxzL21vZHVsZVJvb3REaXJlY3RvcnknO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVTY3JpcHQob3B0czoge1xuICBzY3JpcHQ6ICdzZXR1cCcgfCAndGVhcmRvd24nO1xuICBmbGF2b3I6IHN0cmluZztcbiAgcm9vdERpcjogc3RyaW5nO1xufSkge1xuICBjb25zdCB7IGZsYXZvciwgc2NyaXB0LCByb290RGlyIH0gPSBvcHRzO1xuXG4gIGNvbnN0IHN0cmVhbSA9IGZnLnN0cmVhbShcbiAgICBbYF9fJHtmbGF2b3J9X18vJHtzY3JpcHR9LnRzYCwgYHNyYy9fXyR7Zmxhdm9yfV9fLyR7c2NyaXB0fS50c2BdLFxuICAgIHtcbiAgICAgIGN3ZDogcm9vdERpcixcbiAgICB9XG4gICkgYXMgQXN5bmNJdGVyYWJsZTxzdHJpbmc+O1xuXG4gIGZvciBhd2FpdCAoY29uc3Qgc2NyaXB0TG9jIG9mIHN0cmVhbSkge1xuICAgIGlmIChzY3JpcHRMb2MpIHtcbiAgICAgIGNvbnN0IHJvb3QgPSBtb2R1bGVSb290RGlyZWN0b3J5KCk7XG4gICAgICBjb25zdCBsb2NhdGlvbiA9IHJlc29sdmUoam9pbihyb290RGlyLCBzY3JpcHRMb2MpKTtcblxuICAgICAgY29uc3QgbW9kdWxlUGF0aCA9IChpbnB1dDogc3RyaW5nKSA9PlxuICAgICAgICBwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInXG4gICAgICAgICAgPyBgZmlsZTovLyR7aW5wdXQucmVwbGFjZUFsbChzZXAsICcvJyl9YFxuICAgICAgICAgIDogaW5wdXQ7XG5cbiAgICAgIGNvbnN0IHNjcmlwdCA9IGBpbXBvcnQgeyBydW5Uc1NjcmlwdCB9IGZyb20gJHtKU09OLnN0cmluZ2lmeShcbiAgICAgICAgbW9kdWxlUGF0aChqb2luKHJvb3QsICdjb25maWdzL2plc3QvamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcycpKVxuICAgICAgKX07XG5cbmV4cG9ydCBkZWZhdWx0IGFzeW5jICgpID0+IHtcbmF3YWl0IHJ1blRzU2NyaXB0KHtcbiAgbG9jYXRpb246ICR7SlNPTi5zdHJpbmdpZnkobG9jYXRpb24pfVxufSlcbn1gO1xuXG4gICAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaCgnc2hhMScpXG4gICAgICAgIC51cGRhdGUocm9vdERpcilcbiAgICAgICAgLnVwZGF0ZShmbGF2b3IpXG4gICAgICAgIC51cGRhdGUoc2NyaXB0KVxuICAgICAgICAuZGlnZXN0KClcbiAgICAgICAgLnRvU3RyaW5nKCdoZXgnKTtcblxuICAgICAgY29uc3QgZGlyID0gam9pbih0bXBkaXIoKSwgJ2plc3Qtc2NyaXB0cycpO1xuICAgICAgY29uc3QgZmlsZSA9IGpvaW4oZGlyLCBgJHtoYXNofS5tanNgKTtcblxuICAgICAgYXdhaXQgbWtkaXIoZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcblxuICAgICAgYXdhaXQgd3JpdGVGaWxlKGZpbGUsIHNjcmlwdCk7XG5cbiAgICAgIHJldHVybiBmaWxlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG4iLCJpbXBvcnQgeyBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpc0RpcmVjdG9yeShwYXRoOiBzdHJpbmcpIHtcbiAgcmV0dXJuIHN0YXQocGF0aClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNEaXJlY3RvcnkoKSlcbiAgICAuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbn1cbiIsImltcG9ydCB7IGRpcm5hbWUsIGpvaW4gfSBmcm9tICdwYXRoJztcblxudHlwZSBVcHdhcmREaXJlY3RvcnlXYWxrT3B0cyA9IHtcbiAgc3RhcnQ6IHN0cmluZztcbiAgc3RvcHM/OiBzdHJpbmdbXTtcbiAgYXBwZW5kUGF0aD86IHN0cmluZztcbiAgdGVzdDogKHBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTxib29sZWFuIHwgc3RyaW5nIHwgdW5kZWZpbmVkPjtcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiogdXB3YXJkRGlyZWN0b3J5V2FsayhvcHRzOiBVcHdhcmREaXJlY3RvcnlXYWxrT3B0cykge1xuICBsZXQgY3VycmVudCA9IG9wdHMuc3RhcnQ7XG4gIHdoaWxlIChcbiAgICBjdXJyZW50ICE9PSAnLycgJiZcbiAgICBjdXJyZW50ICE9PSAnfi8nICYmXG4gICAgIShvcHRzLnN0b3BzPy5pbmNsdWRlcyhjdXJyZW50KSA/PyBmYWxzZSlcbiAgKSB7XG4gICAgY29uc3QgcGF0aCA9IG9wdHMuYXBwZW5kUGF0aCA/IGpvaW4oY3VycmVudCwgb3B0cy5hcHBlbmRQYXRoKSA6IGN1cnJlbnQ7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gYXdhaXQgb3B0cy50ZXN0KHBhdGgpO1xuICAgIGlmIChjYW5kaWRhdGUpIHtcbiAgICAgIHlpZWxkIHR5cGVvZiBjYW5kaWRhdGUgPT09ICdzdHJpbmcnID8gY2FuZGlkYXRlIDogcGF0aDtcbiAgICB9XG4gICAgY3VycmVudCA9IGRpcm5hbWUoY3VycmVudCk7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHVwd2FyZERpcmVjdG9yeVNlYXJjaChvcHRzOiBVcHdhcmREaXJlY3RvcnlXYWxrT3B0cykge1xuICBjb25zdCB3YWxrID0gdXB3YXJkRGlyZWN0b3J5V2FsayhvcHRzKTtcbiAgZm9yIGF3YWl0IChjb25zdCBkaXIgb2Ygd2Fsaykge1xuICAgIHJldHVybiBkaXI7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cbiIsImltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBpc0RpcmVjdG9yeSB9IGZyb20gJy4vaXNEaXJlY3RvcnknO1xuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4vbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5pbXBvcnQgeyB1cHdhcmREaXJlY3RvcnlTZWFyY2ggfSBmcm9tICcuL3Vwd2FyZERpcmVjdG9yeVNlYXJjaCc7XG5cbmV4cG9ydCB7IHJlYWRQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuZXhwb3J0IHsgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uIH0gZnJvbSAnLi9sb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24nO1xuZXhwb3J0IHsgcmVwb3NpdG9yeVJvb3RQYXRoIH0gZnJvbSAnLi9yZXBvc2l0b3J5Um9vdFBhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiBsb29rdXAob3B0czogeyBwYXRoOiBzdHJpbmc7IGxvb2t1cFBhY2thZ2VOYW1lOiBzdHJpbmcgfSkge1xuICByZXR1cm4gYXdhaXQgdXB3YXJkRGlyZWN0b3J5U2VhcmNoKHtcbiAgICBzdGFydDogb3B0cy5wYXRoLFxuICAgIGFwcGVuZFBhdGg6IGpvaW4oJ25vZGVfbW9kdWxlcycsIG9wdHMubG9va3VwUGFja2FnZU5hbWUpLFxuICAgIHRlc3Q6IGlzRGlyZWN0b3J5LFxuICB9KTtcbn1cblxuLyoqXG4gKiBMb29rdXAgbG9jYXRpb24gZm9yIGRldkRlcGVuZGVuY2llcyBvZiBcIkByZXBrYS1raXQvdHNcIiAtIHRoaXMgZnVuY3Rpb24gd2lsbFxuICogbG9va3VwIGZvciBcIm9wdHMubG9va3VwUGFja2FnZU5hbWVcIlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmluZERldkRlcGVuZGVuY3kob3B0czoge1xuICBwYXRoPzogc3RyaW5nO1xuICBsb29rdXBQYWNrYWdlTmFtZTogc3RyaW5nO1xufSkge1xuICBjb25zdCBsb29rdXBQYWNrYWdlTmFtZSA9IG9wdHMubG9va3VwUGFja2FnZU5hbWU7XG5cbiAgcmV0dXJuIGF3YWl0IGxvb2t1cCh7XG4gICAgcGF0aDogb3B0cy5wYXRoID8/IG1vZHVsZVJvb3REaXJlY3RvcnkoKSxcbiAgICBsb29rdXBQYWNrYWdlTmFtZSxcbiAgfSk7XG59XG4iLCJpbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcblxuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyBmaW5kRGV2RGVwZW5kZW5jeSB9IGZyb20gJy4uL3V0aWxzL2ZpbmREZXZEZXBlbmRlbmN5JztcblxuZXhwb3J0IGNvbnN0IGplc3RQbHVnaW5Sb290ID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmluZERldkRlcGVuZGVuY3koe1xuICAgIGxvb2t1cFBhY2thZ2VOYW1lOiAnZXNidWlsZC1qZXN0JyxcbiAgfSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgbG9nZ2VyLndhcm4oXG4gICAgICAnSmVzdCBwbHVnaW5zIHJvb3QgY2Fubm90IGJlIGRldGVybWluZWQuIERvIHlvdSBoYXZlIFwiQHJlcGthLWtpdC90c1wiIGluIGRldkRlcGVuZGVuY2llcyBhdCB0aGUgbW9ub3JlcG8gcm9vdCBvciBhdCB0aGUgbG9jYWwgcGFja2FnZT8nXG4gICAgKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAobG9nZ2VyLmxvZ0xldmVsID09PSAnZGVidWcnKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ0ZvdW5kIGplc3QgcGx1Z2lucyByb290IGF0JywgZGlybmFtZShyZXN1bHQpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdCA/IGRpcm5hbWUocmVzdWx0KSA6ICcuJztcbn0pO1xuIiwiaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB0eXBlIHsgQ29uZmlnIH0gZnJvbSAnamVzdCc7XG5pbXBvcnQgeyByZWFkSW5pdGlhbE9wdGlvbnMgfSBmcm9tICdqZXN0LWNvbmZpZyc7XG5cbmltcG9ydCB7IHJlYWRQYWNrYWdlSnNvbiB9IGZyb20gJy4uL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuaW1wb3J0IHsgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uIH0gZnJvbSAnLi4vdXRpbHMvbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uJztcbmltcG9ydCB7XG4gIGN1c3RvbUZsYXZvclRlc3REZWZhdWx0cyxcbiAgamVzdFRyYW5zZm9ybUNvbmZpZ1Byb3AsXG4gIHVuaXRUZXN0RGVmYXVsdHMsXG59IGZyb20gJy4vY29uZmlnQnVpbGRpbmdCbG9ja3MnO1xuaW1wb3J0IHsgZ2VuZXJhdGVTY3JpcHQgfSBmcm9tICcuL2dlbmVyYXRlU2NyaXB0JztcbmltcG9ydCB7IGplc3RQbHVnaW5Sb290IH0gZnJvbSAnLi9qZXN0UGx1Z2luUm9vdCc7XG5cbmV4cG9ydCB0eXBlIFRlc3RGbGF2b3IgPVxuICB8ICd1bml0J1xuICB8ICdpbnRlZ3JhdGlvbidcbiAgfCAoc3RyaW5nICYge1xuICAgICAgJCRjdXN0b206IG5ldmVyO1xuICAgIH0pO1xuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVDb25maWcoXG4gIGZsYXZvcjogVGVzdEZsYXZvcixcbiAgcm9vdERpcjogc3RyaW5nLFxuICBwYXJlbnRSb290RGlyPzogc3RyaW5nXG4pIHtcbiAgY29uc3QgcGx1Z2luUm9vdCA9IGplc3RQbHVnaW5Sb290KCk7XG5cbiAgY29uc3QgYmFzZUNvbmZpZyA9XG4gICAgZmxhdm9yID09PSAndW5pdCcgPyB1bml0VGVzdERlZmF1bHRzKCkgOiBjdXN0b21GbGF2b3JUZXN0RGVmYXVsdHMoZmxhdm9yKTtcblxuICBjb25zdCBnbG9iYWxTZXR1cCA9IGdlbmVyYXRlU2NyaXB0KHtcbiAgICBzY3JpcHQ6ICdzZXR1cCcsXG4gICAgZmxhdm9yLFxuICAgIHJvb3REaXIsXG4gIH0pO1xuXG4gIGNvbnN0IGdsb2JhbFRlYXJkb3duID0gZ2VuZXJhdGVTY3JpcHQoe1xuICAgIHNjcmlwdDogJ3RlYXJkb3duJyxcbiAgICBmbGF2b3IsXG4gICAgcm9vdERpcixcbiAgfSk7XG5cbiAgcHJvY2Vzcy5lbnZbJ1RFU1RfRkxBVk9SJ10gPSBmbGF2b3I7XG5cbiAgY29uc3QgamVzdENvbmZpZyA9IHJlYWRJbml0aWFsT3B0aW9ucyh1bmRlZmluZWQsIHtcbiAgICBwYWNrYWdlUm9vdE9yQ29uZmlnOiByb290RGlyLFxuICAgIHBhcmVudENvbmZpZ0Rpcm5hbWU6IHBhcmVudFJvb3REaXIsXG4gICAgcmVhZEZyb21Dd2Q6IGZhbHNlLFxuICAgIHNraXBNdWx0aXBsZUNvbmZpZ0Vycm9yOiB0cnVlLFxuICB9KTtcblxuICBjb25zdCByZXNvbHZlZENvbmZpZyA9IChhd2FpdCBqZXN0Q29uZmlnKS5jb25maWc7XG5cbiAgY29uc3QgY29uZmlnID0ge1xuICAgIC4uLmJhc2VDb25maWcsXG4gICAgLi4uamVzdFRyYW5zZm9ybUNvbmZpZ1Byb3AoYXdhaXQgcGx1Z2luUm9vdCksXG4gICAgLi4ucmVzb2x2ZWRDb25maWcsXG4gICAgZ2xvYmFsU2V0dXA6IGF3YWl0IGdsb2JhbFNldHVwLFxuICAgIGdsb2JhbFRlYXJkb3duOiBhd2FpdCBnbG9iYWxUZWFyZG93bixcbiAgfTtcblxuICByZXR1cm4gY29uZmlnO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlSmVzdENvbmZpZ0ZvclNpbmdsZVBhY2thZ2Uoe1xuICBmbGF2b3IgPSAndW5pdCcsXG4gIHJvb3REaXIgPSBwcm9jZXNzLmN3ZCgpLFxufToge1xuICBmbGF2b3I6IFRlc3RGbGF2b3I7XG4gIHJvb3REaXI/OiBzdHJpbmc7XG59KTogUHJvbWlzZTxDb25maWc+IHtcbiAgcmV0dXJuIGF3YWl0IGNyZWF0ZUNvbmZpZyhmbGF2b3IsIHJvb3REaXIpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlSmVzdENvbmZpZ0Zvck1vbm9yZXBvKHtcbiAgZmxhdm9yID0gJ3VuaXQnLFxuICBjd2QgPSBwcm9jZXNzLmN3ZCgpLFxufToge1xuICBmbGF2b3I6IFRlc3RGbGF2b3I7XG4gIGN3ZDogc3RyaW5nO1xufSk6IFByb21pc2U8Q29uZmlnPiB7XG4gIGNvbnN0IHJlcG9Db25maWcgPSBhd2FpdCBsb2FkUmVwb3NpdG9yeUNvbmZpZ3VyYXRpb24oKTtcblxuICBpZiAocmVwb0NvbmZpZy50eXBlID09PSAnc2luZ2xlLXBhY2thZ2UnKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUplc3RDb25maWdGb3JTaW5nbGVQYWNrYWdlKHtcbiAgICAgIGZsYXZvcixcbiAgICAgIHJvb3REaXI6IHJlcG9Db25maWcucm9vdCxcbiAgICB9KTtcbiAgfVxuXG4gIGlmIChyZXBvQ29uZmlnLnJvb3QgIT09IGN3ZCkge1xuICAgIHJldHVybiBjcmVhdGVKZXN0Q29uZmlnRm9yU2luZ2xlUGFja2FnZSh7IGZsYXZvciwgcm9vdERpcjogY3dkIH0pO1xuICB9XG5cbiAgY29uc3QgcHJvamVjdHMgPSAoXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICByZXBvQ29uZmlnLnBhY2thZ2VMb2NhdGlvbnMubWFwKGFzeW5jIChsb2NhdGlvbikgPT4ge1xuICAgICAgICBjb25zdCBiYXNlQ29uZmlnID0gY3JlYXRlQ29uZmlnKGZsYXZvciwgbG9jYXRpb24sIGN3ZCk7XG4gICAgICAgIGNvbnN0IHBhY2thZ2VKc29uID0gcmVhZFBhY2thZ2VKc29uKGpvaW4obG9jYXRpb24sICdwYWNrYWdlLmpzb24nKSk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgLi4uKGF3YWl0IGJhc2VDb25maWcpLFxuICAgICAgICAgIHJvb3REaXI6IGxvY2F0aW9uLFxuICAgICAgICAgIGRpc3BsYXlOYW1lOiAoYXdhaXQgcGFja2FnZUpzb24pLm5hbWUsXG4gICAgICAgIH07XG4gICAgICB9KVxuICAgIClcbiAgKS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgY29uc3QgdGVzdFRpbWVvdXQgPSBwcm9qZWN0cy5yZWR1Y2UoXG4gICAgKGFjYywgcHJvamVjdCkgPT5cbiAgICAgIE1hdGgubWF4KFxuICAgICAgICBhY2MsXG4gICAgICAgIHR5cGVvZiBwcm9qZWN0LnRlc3RUaW1lb3V0ID09PSAnbnVtYmVyJyA/IHByb2plY3QudGVzdFRpbWVvdXQgOiAwXG4gICAgICApLFxuICAgIDBcbiAgKTtcblxuICByZXR1cm4ge1xuICAgIC4uLih0ZXN0VGltZW91dCAhPT0gMCAmJiB7XG4gICAgICB0ZXN0VGltZW91dCxcbiAgICB9KSxcbiAgICBwcm9qZWN0czogcHJvamVjdHMubWFwKFxuICAgICAgKHsgY292ZXJhZ2VEaXJlY3RvcnksIHRlc3RUaW1lb3V0LCAuLi5wcm9qZWN0IH0pID0+IHByb2plY3RcbiAgICApLFxuICB9O1xufVxuIl0sIm5hbWVzIjpbInBhdGgiLCJyZXN1bHQiLCJzY3JpcHQiLCJ0ZXN0VGltZW91dCJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7OztBQUNPLFNBQVMsYUFBYSxHQUFxQixFQUFBO0FBQ2hELEVBQU8sT0FBQSxHQUFBLENBQUksT0FBUSxDQUFBLHFCQUFBLEVBQXVCLE1BQU0sQ0FBQSxDQUFBO0FBQ2xEOztBQ0hPLFNBQVMsU0FDZCxLQUN5QixFQUFBO0FBQ3pCLEVBQUEsT0FBTyxRQUFRLEtBQUssQ0FBQSxDQUFBO0FBQ3RCOztBQ0pPLFNBQVMsS0FBUSxFQUFzQixFQUFBO0FBQzVDLEVBQUksSUFBQSxLQUFBLENBQUE7QUFDSixFQUFBLElBQUksVUFBYSxHQUFBLEtBQUEsQ0FBQTtBQUNqQixFQUFBLE9BQU8sTUFBUztBQUNkLElBQUEsSUFBSSxVQUFZLEVBQUE7QUFDZCxNQUFPLE9BQUEsS0FBQSxDQUFBO0FBQUEsS0FDVDtBQUNBLElBQUEsS0FBQSxHQUFRLEVBQUcsRUFBQSxDQUFBO0FBQ1gsSUFBYSxVQUFBLEdBQUEsSUFBQSxDQUFBO0FBQ2IsSUFBTyxPQUFBLEtBQUEsQ0FBQTtBQUFBLEdBQ1QsQ0FBQTtBQUNGOztBQ1hPLFNBQVMsVUFBYSxFQUE0QyxFQUFBO0FBQ3ZFLEVBQUksSUFBQSxLQUFB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
