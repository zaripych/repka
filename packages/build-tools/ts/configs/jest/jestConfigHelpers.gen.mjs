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
  const isBundledInRoot = () => parent.endsWith(sep + "@repka-kit/ts");
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL2VzY2FwZVJlZ0V4cC50cyIsIi4uLy4uLy4uLy4uL3V0aWxzL3RzL3NyYy9pc1RydXRoeS50cyIsIi4uLy4uLy4uLy4uL3V0aWxzL3RzL3NyYy9vbmNlLnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL29uY2VBc3luYy50cyIsIi4uLy4uL3NyYy9sb2dnZXIvbG9nZ2VyLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3N0YWNrVHJhY2UudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blRvUHJvbWlzZS50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduUmVzdWx0LnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25PdXRwdXQudHMiLCIuLi8uLi9zcmMvdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeS50cyIsIi4uLy4uL3NyYy91dGlscy9iaW5QYXRoLnRzIiwiLi4vLi4vc3JjL3J1blRzU2NyaXB0LnRzIiwiLi4vLi4vc3JjL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24udHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy9qZXN0L2NvbmZpZ0J1aWxkaW5nQmxvY2tzLnRzIiwiLi4vLi4vc3JjL2plc3QvZ2VuZXJhdGVTY3JpcHQudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNEaXJlY3RvcnkudHMiLCIuLi8uLi9zcmMvdXRpbHMvdXB3YXJkRGlyZWN0b3J5U2VhcmNoLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2ZpbmREZXZEZXBlbmRlbmN5LnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdFBsdWdpblJvb3QudHMiLCIuLi8uLi9zcmMvamVzdC9jcmVhdGVKZXN0Q29uZmlnLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIGh0dHBzOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzM0NDYxNzAvZXNjYXBlLXN0cmluZy1mb3ItdXNlLWluLWphdmFzY3JpcHQtcmVnZXhcbmV4cG9ydCBmdW5jdGlvbiBlc2NhcGVSZWdFeHAoc3RyOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc3RyLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gaXNUcnV0aHk8VD4oXG4gIHZhbHVlOiBOb25OdWxsYWJsZTxUPiB8IGZhbHNlIHwgbnVsbCB8IHVuZGVmaW5lZCB8ICcnIHwgMFxuKTogdmFsdWUgaXMgTm9uTnVsbGFibGU8VD4ge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSk7XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gb25jZTxUPihmbjogKCkgPT4gVCk6ICgpID0+IFQge1xuICBsZXQgdmFsdWU6IFQ7XG4gIGxldCBjYWxjdWxhdGVkID0gZmFsc2U7XG4gIHJldHVybiAoKTogVCA9PiB7XG4gICAgaWYgKGNhbGN1bGF0ZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdmFsdWUgPSBmbigpO1xuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfTtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBvbmNlQXN5bmM8VD4oZm46ICgpID0+IFQgfCBQcm9taXNlPFQ+KTogKCkgPT4gUHJvbWlzZTxUPiB7XG4gIGxldCB2YWx1ZTogVDtcbiAgbGV0IGluRmxpZ2h0OiBQcm9taXNlPFQ+IHwgbnVsbDtcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcbiAgcmV0dXJuIGFzeW5jICgpOiBQcm9taXNlPFQ+ID0+IHtcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICBpZiAoaW5GbGlnaHQpIHtcbiAgICAgIHJldHVybiBpbkZsaWdodDtcbiAgICB9XG4gICAgaW5GbGlnaHQgPSBQcm9taXNlLnJlc29sdmUoZm4oKSk7XG4gICAgdmFsdWUgPSBhd2FpdCBpbkZsaWdodDtcbiAgICBjYWxjdWxhdGVkID0gdHJ1ZTtcbiAgICBpbkZsaWdodCA9IG51bGw7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xufVxuIiwiaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XG5cbmNvbnN0IGxldmVscyA9IFsnZGVidWcnLCAnaW5mbycsICd3YXJuJywgJ2Vycm9yJywgJ2ZhdGFsJ10gYXMgY29uc3Q7XG5cbnR5cGUgTG9nTGV2ZWwgPSB0eXBlb2YgbGV2ZWxzW251bWJlcl07XG5cbnR5cGUgUGFyYW1zID0gUGFyYW1ldGVyczx0eXBlb2YgY29uc29sZS5sb2c+O1xuXG50eXBlIExvZ2dlciA9IHtcbiAgbG9nTGV2ZWw6IExvZ0xldmVsO1xuICBkZWJ1ZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGluZm8oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBhbGlhcyBmb3IgaW5mb1xuICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICAvLyBzcGVjaWFsIHRyZWF0bWVudCwgZGlzYWJsZWQgb24gQ0kvVFRZXG4gIHRpcCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xuICBlcnJvciguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGZhdGFsKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbn07XG5cbmNvbnN0IGVuYWJsZWRMZXZlbHNBZnRlciA9IChsZXZlbDogTG9nTGV2ZWwgfCAnb2ZmJykgPT4ge1xuICBpZiAobGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIGNvbnN0IGluZGV4ID0gbGV2ZWxzLmZpbmRJbmRleCgoaXRlbSkgPT4gaXRlbSA9PT0gbGV2ZWwpO1xuICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGxldmVsJyk7XG4gIH1cbiAgcmV0dXJuIGxldmVscy5zbGljZShpbmRleCk7XG59O1xuXG5jb25zdCBpc0xldmVsID0gKGxldmVsPzogc3RyaW5nKTogbGV2ZWwgaXMgTG9nTGV2ZWwgPT4ge1xuICByZXR1cm4gbGV2ZWxzLmluY2x1ZGVzKGxldmVsIGFzIExvZ0xldmVsKTtcbn07XG5cbmNvbnN0IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncyA9IChcbiAgYXJncyA9IHByb2Nlc3MuYXJndlxuKTogTG9nTGV2ZWwgfCAnb2ZmJyB8IHVuZGVmaW5lZCA9PiB7XG4gIGNvbnN0IGluZGV4ID0gYXJncy5maW5kSW5kZXgoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gJy0tbG9nLWxldmVsJyk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGNvbnN0IGxldmVsID0gYXJnc1tpbmRleCArIDFdO1xuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiAnb2ZmJztcbiAgfVxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5jb25zdCB2ZXJib3NpdHlGcm9tRW52ID0gKCk6IExvZ0xldmVsIHwgJ29mZicgfCB1bmRlZmluZWQgPT4ge1xuICBjb25zdCBsZXZlbCA9IHByb2Nlc3MuZW52WydMT0dfTEVWRUwnXTtcbiAgaWYgKGxldmVsID09PSAnc2lsZW50JyB8fCBsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gJ29mZic7XG4gIH1cbiAgaWYgKCFpc0xldmVsKGxldmVsKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGxldmVsO1xufTtcblxuY29uc3QgZ2V0VmVyYm9zaXR5Q29uZmlnID0gKCkgPT4ge1xuICBjb25zdCBhcmdzTGV2ZWwgPSB2ZXJib3NpdHlGcm9tUHJvY2Vzc0FyZ3MoKTtcbiAgY29uc3QgZW52TGV2ZWwgPSB2ZXJib3NpdHlGcm9tRW52KCk7XG4gIHJldHVybiBhcmdzTGV2ZWwgPz8gZW52TGV2ZWwgPz8gJ2luZm8nO1xufTtcblxuY29uc3Qgbm9vcCA9ICguLi5fYXJnczogUGFyYW1zKSA9PiB7XG4gIHJldHVybjtcbn07XG5cbmNvbnN0IGxvZyA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5sb2coLi4uYXJncyk7XG59O1xuXG5jb25zdCBlcnJvciA9ICguLi5hcmdzOiBQYXJhbXMpID0+IHtcbiAgY29uc29sZS5lcnJvciguLi5hcmdzKTtcbn07XG5cbmNvbnN0IHNob3VsZEVuYWJsZVRpcCA9ICgpID0+ICFwcm9jZXNzLmVudlsnQ0knXSAmJiAhcHJvY2Vzcy5zdGRvdXQuaXNUVFk7XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoXG4gIGRlcHMgPSB7IGdldFZlcmJvc2l0eUNvbmZpZywgbG9nLCBlcnJvciwgc2hvdWxkRW5hYmxlVGlwIH1cbikgPT4ge1xuICBjb25zdCBsb2dMZXZlbCA9IGRlcHMuZ2V0VmVyYm9zaXR5Q29uZmlnKCk7XG4gIGNvbnN0IGVuYWJsZWQgPSBlbmFibGVkTGV2ZWxzQWZ0ZXIobG9nTGV2ZWwpO1xuICByZXR1cm4gbGV2ZWxzLnJlZHVjZShcbiAgICAoYWNjLCBsdmwpID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmFjYyxcbiAgICAgICAgW2x2bF06IGVuYWJsZWQuaW5jbHVkZXMobHZsKVxuICAgICAgICAgID8gWydmYXRhbCcsICdlcnJvciddLmluY2x1ZGVzKGx2bClcbiAgICAgICAgICAgID8gZGVwcy5lcnJvclxuICAgICAgICAgICAgOiBkZXBzLmxvZ1xuICAgICAgICAgIDogbm9vcCxcbiAgICAgIH07XG4gICAgfSxcbiAgICB7XG4gICAgICBsb2dMZXZlbCxcbiAgICAgIGxvZzogZW5hYmxlZC5pbmNsdWRlcygnaW5mbycpID8gZGVwcy5sb2cgOiBub29wLFxuICAgICAgdGlwOiBlbmFibGVkLmluY2x1ZGVzKCdpbmZvJykgJiYgZGVwcy5zaG91bGRFbmFibGVUaXAoKSA/IGRlcHMubG9nIDogbm9vcCxcbiAgICB9IGFzIExvZ2dlclxuICApO1xufTtcblxuY29uc3QgY3JlYXRlRGVsZWdhdGluZ0xvZ2dlciA9IChvcHRzOiB7IHBhcmVudDogTG9nZ2VyIH0pOiBMb2dnZXIgPT5cbiAgT2JqZWN0LmZyZWV6ZSh7XG4gICAgZ2V0IGxvZ0xldmVsKCkge1xuICAgICAgcmV0dXJuIG9wdHMucGFyZW50LmxvZ0xldmVsO1xuICAgIH0sXG4gICAgZGVidWcoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmRlYnVnKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBpbmZvKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5pbmZvKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBsb2coLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmxvZyguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgdGlwKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC50aXAoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIHdhcm4oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50Lndhcm4oLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGVycm9yKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZCB7XG4gICAgICBvcHRzLnBhcmVudC5lcnJvciguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgZmF0YWwoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmZhdGFsKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgfSk7XG5cbmxldCBkZWZhdWx0TG9nZ2VyRmFjdG9yeTogKCgpID0+IExvZ2dlcikgfCBudWxsO1xuXG5leHBvcnQgY29uc3QgY29uZmlndXJlRGVmYXVsdExvZ2dlciA9IChmYWN0b3J5OiAoKSA9PiBMb2dnZXIpID0+IHtcbiAgaWYgKGRlZmF1bHRMb2dnZXJGYWN0b3J5KSB7XG4gICAgY29uc3QgZXJyb3IgPSB7XG4gICAgICBzdGFjazogJycsXG4gICAgfTtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShlcnJvcik7XG4gICAgbG9nZ2VyLmRlYnVnKCdDYW5ub3Qgb3ZlcnJpZGUgZGVmYXVsdCBsb2dnZXIgbXVsdGlwbGUgdGltZXMnLCBlcnJvci5zdGFjayk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGRlZmF1bHRMb2dnZXJGYWN0b3J5ID0gZmFjdG9yeTtcbn07XG5cbmNvbnN0IGRlZmF1bHRMb2dnZXIgPSBvbmNlKCgpID0+IHtcbiAgbGV0IGZhY3RvcnkgPSBkZWZhdWx0TG9nZ2VyRmFjdG9yeTtcbiAgaWYgKCFmYWN0b3J5KSB7XG4gICAgZmFjdG9yeSA9ICgpID0+IGNyZWF0ZUxvZ2dlcigpO1xuICB9XG4gIHJldHVybiBmYWN0b3J5KCk7XG59KTtcblxuLyoqXG4gKiBEZWZhdWx0IGxvZ2dlciBpbnN0YW5jZSBjYW4gYmUgY29uZmlndXJlZCBvbmNlIGF0IHN0YXJ0dXBcbiAqL1xuZXhwb3J0IGNvbnN0IGxvZ2dlcjogTG9nZ2VyID0gY3JlYXRlRGVsZWdhdGluZ0xvZ2dlcih7XG4gIGdldCBwYXJlbnQoKSB7XG4gICAgcmV0dXJuIGRlZmF1bHRMb2dnZXIoKTtcbiAgfSxcbn0pO1xuIiwiLyoqXG4gKiBDYXB0dXJlIHRoZSBzdGFjayB0cmFjZSBhbmQgYWxsb3cgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgdGhyb3duIGluIGFzeW5jaHJvbm91cyBjYWxsYmFja3NcbiAqIHdpdGggYWRkaXRpb25hbCBzdGFjayBpbmZvcm1hdGlvbiBjYXB0dXJlZCBhdCB0aGUgbW9tZW50IG9mIHRoZSBjYWxsIG9mIHRoaXMgZnVuY3Rpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhcHR1cmVTdGFja1RyYWNlKHJlbW92ZSA9IDApIHtcbiAgY29uc3Qgc3RhY2tDb250YWluZXIgPSB7XG4gICAgc3RhY2s6ICcnLFxuICB9O1xuICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShzdGFja0NvbnRhaW5lcik7XG4gIGNvbnN0IHN0YWNrVHJhY2UgPSBzdGFja0NvbnRhaW5lci5zdGFja1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuc2xpY2UoNiArIHJlbW92ZSlcbiAgICAuam9pbignXFxuJyk7XG4gIHJldHVybiB7XG4gICAgLyoqXG4gICAgICogQ2FwdHVyZWQgc3RhY2sgdHJhY2UgaW5mb3JtYXRpb25cbiAgICAgKi9cbiAgICBzdGFja1RyYWNlLFxuICAgIC8qKlxuICAgICAqIENhbiBiZSBjYWxsZWQgaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrIHRvIGVucmljaCBleGNlcHRpb25zIHdpdGggYWRkaXRpb25hbCBpbmZvcm1hdGlvblxuICAgICAqIEBwYXJhbSBlcnIgRXhjZXB0aW9uIHRvIGVucmljaCAtIGl0IGlzIGdvaW5nIHRvIGhhdmUgaXRzIGAuc3RhY2tgIHByb3AgbXV0YXRlZFxuICAgICAqIEByZXR1cm5zIFNhbWUgZXhjZXB0aW9uXG4gICAgICovXG4gICAgcHJlcGFyZUZvclJldGhyb3c6IChlcnI6IEVycm9yKSA9PiB7XG4gICAgICBjb25zdCBvbGRTdGFja1RyYWNlID0gZXJyLnN0YWNrID8/ICcnLnNwbGl0KCdcXG4nKS5zbGljZSgxKS5qb2luKCdcXG4nKTtcbiAgICAgIGVyci5zdGFjayA9IGAke2Vyci5uYW1lIHx8ICdFcnJvcid9OiAke1xuICAgICAgICBlcnIubWVzc2FnZVxuICAgICAgfVxcbiR7b2xkU3RhY2tUcmFjZX1cXG4ke3N0YWNrVHJhY2V9YDtcbiAgICAgIHJldHVybiBlcnI7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB0eXBlIHsgU3Bhd25PcHRpb25zIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHNwYXduIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IEFzc2lnbiB9IGZyb20gJ3V0aWxpdHktdHlwZXMnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcbmltcG9ydCB7IGNhcHR1cmVTdGFja1RyYWNlIH0gZnJvbSAnLi4vdXRpbHMvc3RhY2tUcmFjZSc7XG5cbmV4cG9ydCB0eXBlIFNwYXduVG9Qcm9taXNlT3B0cyA9IHtcbiAgLyoqXG4gICAqIFNwZWNpZnkgZXhpdCBjb2RlcyB3aGljaCBzaG91bGQgbm90IHJlc3VsdCBpbiB0aHJvd2luZyBhbiBlcnJvciB3aGVuXG4gICAqIHRoZSBwcm9jZXNzIGhhcyBmaW5pc2hlZCwgZS5nLiBzcGVjaWZ5aW5nIGBbMF1gIG1lYW5zIGlmIHByb2Nlc3MgZmluaXNoZWRcbiAgICogd2l0aCB6ZXJvIGV4aXQgY29kZSB0aGVuIHRoZSBwcm9taXNlIHdpbGwgcmVzb2x2ZSBpbnN0ZWFkIG9mIHJlamVjdGluZy5cbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgc3BlY2lmeSBgaW5oZXJpdGAgdG8gc2F2ZSBzdGF0dXMgY29kZSB0byB0aGUgY3VycmVudCBgcHJvY2Vzcy5leGl0Q29kZWBcbiAgICpcbiAgICogQWx0ZXJuYXRpdmVseSwgY29tcGxldGVseSBpZ25vcmUgdGhlIGV4aXQgY29kZSAoZS5nLiB5b3UgZm9sbG93IHVwIGFuZCBpbnRlcnJvZ2F0ZVxuICAgKiB0aGUgcHJvY2VzcyBjb2RlIG1hbnVhbGx5IGFmdGVyd2FyZHMpXG4gICAqL1xuICBleGl0Q29kZXM6IG51bWJlcltdIHwgJ2luaGVyaXQnIHwgJ2FueSc7XG59O1xuXG50eXBlIFNoYXJlZE9wdHMgPSBQaWNrPFNwYXduT3B0aW9ucywgJ2N3ZCc+O1xuXG50eXBlIFNwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PiA9IFtcbiAgY29tbWFuZDogc3RyaW5nLFxuICBhcmdzOiBSZWFkb25seUFycmF5PHN0cmluZz4sXG4gIG9wdGlvbnM6IEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+XG5dO1xuXG5leHBvcnQgdHlwZSBTcGF3bk9wdGlvbnNXaXRoRXh0cmE8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICBBc3NpZ248U3Bhd25PcHRpb25zLCBFPjtcblxuZXhwb3J0IHR5cGUgU3Bhd25QYXJhbWV0ZXJNaXg8RSBleHRlbmRzIG9iamVjdCA9IFNwYXduVG9Qcm9taXNlT3B0cz4gPVxuICB8IFtjcDogQ2hpbGRQcm9jZXNzLCBleHRyYU9wdHM6IEFzc2lnbjxFLCBTaGFyZWRPcHRzPl1cbiAgfCBTcGF3bkFyZ3M8RT47XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYXduQXJnczxFIGV4dGVuZHMgb2JqZWN0PihcbiAgYXJnczogU3Bhd25QYXJhbWV0ZXJNaXg8RT5cbik6IGFyZ3MgaXMgU3Bhd25BcmdzPEU+IHtcbiAgcmV0dXJuICEoYXJnc1swXSBpbnN0YW5jZW9mIENoaWxkUHJvY2VzcykgJiYgdHlwZW9mIGFyZ3NbMF0gPT09ICdzdHJpbmcnO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzPEUgZXh0ZW5kcyBvYmplY3Q+KFxuICBwYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxFPlxuKSB7XG4gIGNvbnN0IFtjaGlsZCwgW2NvbW1hbmQsIGFyZ3MsIG9wdHNdXSA9IGlzU3Bhd25BcmdzKHBhcmFtZXRlcnMpXG4gICAgPyBbXG4gICAgICAgIHNwYXduKC4uLihwYXJhbWV0ZXJzIGFzIHVua25vd24gYXMgUGFyYW1ldGVyczx0eXBlb2Ygc3Bhd24+KSksXG4gICAgICAgIHBhcmFtZXRlcnMsXG4gICAgICBdXG4gICAgOiBbXG4gICAgICAgIHBhcmFtZXRlcnNbMF0sXG4gICAgICAgIFtcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduZmlsZSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzBdLnNwYXduYXJncy5zbGljZSgxKSxcbiAgICAgICAgICBwYXJhbWV0ZXJzWzFdIGFzIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+LFxuICAgICAgICBdLFxuICAgICAgXTtcbiAgcmV0dXJuIHtcbiAgICBjaGlsZCxcbiAgICBjb21tYW5kLFxuICAgIGFyZ3MsXG4gICAgb3B0cyxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduVG9Qcm9taXNlKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHsgY2hpbGQsIGNvbW1hbmQsIGFyZ3MsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgeyBwcmVwYXJlRm9yUmV0aHJvdyB9ID0gY2FwdHVyZVN0YWNrVHJhY2UoKTtcblxuICBjb25zdCBleGl0Q29kZXMgPSBvcHRzLmV4aXRDb2RlcztcblxuICBjb25zdCBjd2QgPSBvcHRzLmN3ZCA/IG9wdHMuY3dkLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY21kID0gKCkgPT4gW2NvbW1hbmQsIC4uLmFyZ3NdLmpvaW4oJyAnKTtcblxuICBsb2dnZXIuZGVidWcoWyc+JywgY21kKCldLmpvaW4oJyAnKSwgLi4uKGN3ZCA/IFtgaW4gJHtjd2R9YF0gOiBbXSkpO1xuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMsIHJlaikgPT5cbiAgICBjaGlsZFxuICAgICAgLm9uKCdjbG9zZScsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGV4aXRDb2RlcyAhPT0gJ2luaGVyaXQnICYmXG4gICAgICAgICAgICBleGl0Q29kZXMgIT09ICdhbnknICYmXG4gICAgICAgICAgICAhZXhpdENvZGVzLmluY2x1ZGVzKGNvZGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZWooXG4gICAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihgQ29tbWFuZCBcIiR7Y21kKCl9XCIgaGFzIGZhaWxlZCB3aXRoIGNvZGUgJHtjb2RlfWApXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgICByZWooXG4gICAgICAgICAgICBwcmVwYXJlRm9yUmV0aHJvdyhcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBGYWlsZWQgdG8gZXhlY3V0ZSBjb21tYW5kIFwiJHtjbWQoKX1cIiAtICR7c2lnbmFsfWApXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLm9uKCdlcnJvcicsIHJlailcbiAgKTtcbiAgLy8gaW5oZXJpdCBleGl0IGNvZGVcbiAgaWYgKGV4aXRDb2RlcyA9PT0gJ2luaGVyaXQnKSB7XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIGNoaWxkLmV4aXRDb2RlID09PSAnbnVtYmVyJyAmJlxuICAgICAgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJyB8fCBwcm9jZXNzLmV4aXRDb2RlID09PSAwKVxuICAgICkge1xuICAgICAgcHJvY2Vzcy5leGl0Q29kZSA9IGNoaWxkLmV4aXRDb2RlO1xuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuXG5pbXBvcnQgdHlwZSB7IFNwYXduUGFyYW1ldGVyTWl4LCBTcGF3blRvUHJvbWlzZU9wdHMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcblxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRPcHRzID0ge1xuICBvdXRwdXQ/OlxuICAgIHwgQXJyYXk8J3N0ZG91dCcgfCAnc3RkZXJyJz5cbiAgICB8IFsnc3Rkb3V0JyB8ICdzdGRlcnInLCAuLi5BcnJheTwnc3Rkb3V0JyB8ICdzdGRlcnInPl07XG4gIGJ1ZmZlcnM/OiB7XG4gICAgY29tYmluZWQ/OiBzdHJpbmdbXTtcbiAgICBzdGRvdXQ/OiBzdHJpbmdbXTtcbiAgICBzdGRlcnI/OiBzdHJpbmdbXTtcbiAgfTtcbn0gJiBTcGF3blRvUHJvbWlzZU9wdHM7XG5cbmV4cG9ydCB0eXBlIFNwYXduUmVzdWx0UmV0dXJuID0ge1xuICBwaWQ/OiBudW1iZXI7XG4gIG91dHB1dDogc3RyaW5nW107XG4gIHN0ZG91dDogc3RyaW5nO1xuICBzdGRlcnI6IHN0cmluZztcbiAgc3RhdHVzOiBudW1iZXIgfCBudWxsO1xuICBzaWduYWw6IE5vZGVKUy5TaWduYWxzIHwgbnVsbDtcbiAgZXJyb3I/OiBFcnJvciB8IHVuZGVmaW5lZDtcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3blJlc3VsdChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxTcGF3blJlc3VsdFJldHVybj4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IGNvbWJpbmVkRGF0YTogc3RyaW5nW10gPSBvcHRzLmJ1ZmZlcnM/LmNvbWJpbmVkID8/IFtdO1xuICBjb25zdCBzdGRvdXREYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3Rkb3V0ID8/IFtdO1xuICBjb25zdCBzdGRlcnJEYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uc3RkZXJyID8/IFtdO1xuICBjb25zdCBvdXRwdXQgPSBvcHRzLm91dHB1dCA/PyBbJ3N0ZG91dCcsICdzdGRlcnInXTtcbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3Rkb3V0JykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZG91dCxcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRvdXRcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRvdXREYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKG91dHB1dC5pbmNsdWRlcygnc3RkZXJyJykpIHtcbiAgICBhc3NlcnQoXG4gICAgICAhIWNoaWxkLnN0ZGVycixcbiAgICAgICdFeHBlY3RlZCBcIi5zdGRlcnJcIiB0byBiZSBkZWZpbmVkLCB3aGljaCB3aWxsIG9ubHkgYmUgZGVmaW5lZCBpZiBjaGlsZCBwcm9jZXNzIGlzIHNwYXduZWQgd2l0aCBjb3JyZWN0IHBhcmFtZXRlcnMnXG4gICAgKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoJ3V0Zi04Jyk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKCdkYXRhJywgKGRhdGE6IHN0cmluZykgPT4ge1xuICAgICAgY29tYmluZWREYXRhLnB1c2goZGF0YSk7XG4gICAgICBzdGRlcnJEYXRhLnB1c2goZGF0YSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoW3NwYXduVG9Qcm9taXNlKGNoaWxkLCBvcHRzKV0pO1xuICByZXR1cm4ge1xuICAgIHBpZDogY2hpbGQucGlkLFxuICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZSxcbiAgICBzdGF0dXM6IGNoaWxkLmV4aXRDb2RlLFxuICAgIGdldCBvdXRwdXQoKSB7XG4gICAgICByZXR1cm4gY29tYmluZWREYXRhO1xuICAgIH0sXG4gICAgZ2V0IHN0ZGVycigpIHtcbiAgICAgIHJldHVybiBzdGRlcnJEYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IHN0ZG91dCgpIHtcbiAgICAgIHJldHVybiBzdGRvdXREYXRhLmpvaW4oJycpO1xuICAgIH0sXG4gICAgZ2V0IGVycm9yKCkge1xuICAgICAgcmV0dXJuIHJlc3VsdC5zdGF0dXMgPT09ICdyZWplY3RlZCdcbiAgICAgICAgPyAocmVzdWx0LnJlYXNvbiBhcyBFcnJvcilcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgfSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHR5cGUgeyBTcGF3blJlc3VsdE9wdHMsIFNwYXduUmVzdWx0UmV0dXJuIH0gZnJvbSAnLi9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBzcGF3blJlc3VsdCB9IGZyb20gJy4vc3Bhd25SZXN1bHQnO1xuaW1wb3J0IHR5cGUgeyBTcGF3blBhcmFtZXRlck1peCB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dChcbiAgLi4ucGFyYW1ldGVyczogU3Bhd25QYXJhbWV0ZXJNaXg8U3Bhd25SZXN1bHRPcHRzPlxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgeyBjaGlsZCwgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzcGF3blJlc3VsdChjaGlsZCwgb3B0cyk7XG4gIHJldHVybiByZXN1bHQub3V0cHV0LmpvaW4oJycpO1xufVxuXG5jb25zdCBkZWZhdWx0U2hvdWxkT3V0cHV0ID0gKHJlc3VsdDogU3Bhd25SZXN1bHRSZXR1cm4pID0+IHtcbiAgcmV0dXJuIHJlc3VsdC5lcnJvciB8fCByZXN1bHQuc3RhdHVzICE9PSAwIHx8IGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJztcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxcbiAgICBTcGF3blJlc3VsdE9wdHMgJiB7XG4gICAgICAvKipcbiAgICAgICAqIEJ5IGRlZmF1bHQgd2lsbCBvdXRwdXQgdG8gYHN0ZGVycmAgd2hlbiBzcGF3biByZXN1bHQgZmFpbGVkIHdpdGggYW4gZXJyb3IsIHdoZW5cbiAgICAgICAqIHN0YXR1cyBjb2RlIGlzIG5vdCB6ZXJvIG9yIHdoZW4gYExvZ2dlci5sb2dMZXZlbGAgaXMgYGRlYnVnYFxuICAgICAgICovXG4gICAgICBzaG91bGRPdXRwdXQ/OiAocmVzdWx0OiBTcGF3blJlc3VsdFJldHVybikgPT4gYm9vbGVhbjtcbiAgICB9XG4gID5cbikge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcbiAgY29uc3Qgc2hvdWxkT3V0cHV0ID0gb3B0cy5zaG91bGRPdXRwdXQgPz8gZGVmYXVsdFNob3VsZE91dHB1dDtcbiAgaWYgKHNob3VsZE91dHB1dChyZXN1bHQpKSB7XG4gICAgbG9nZ2VyLmVycm9yKHJlc3VsdC5vdXRwdXQuam9pbignJykpO1xuICB9XG4gIGlmIChyZXN1bHQuZXJyb3IpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QocmVzdWx0LmVycm9yKTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG59XG4iLCJpbXBvcnQgeyBkaXJuYW1lLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcblxuaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XG5cbmV4cG9ydCBjb25zdCBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCA9IChvcHRzOiB7XG4gIGltcG9ydE1ldGFVcmw6IHN0cmluZztcbn0pID0+IHtcbiAgLy8gdGhpcyBpcyBoaWdobHkgZGVwZW5kZW50IG9uIHRoZSBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZVxuICAvLyBhbmQgdGhlIGNvbnRleHQgaW4gd2hpY2ggdGhpcyBmdW5jdGlvbiBpcyBydW4gKGJ1bmRsZWQgY29kZSB2cyB0c3ggLi9zcmMvdHNmaWxlLnRzKVxuICBjb25zdCBfX2ZpbGVOYW1lID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICBjb25zdCBwYXJlbnQgPSBkaXJuYW1lKF9fZmlsZU5hbWUpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IGRpcm5hbWUocGFyZW50KTtcblxuICBjb25zdCBpc0J1bmRsZWRJblJvb3QgPSAoKSA9PiBwYXJlbnQuZW5kc1dpdGgoc2VwICsgJ0ByZXBrYS1raXQvdHMnKTtcbiAgY29uc3QgaXNCdW5kbGVkSW5EaXN0ID0gKCkgPT4gcGFyZW50LmVuZHNXaXRoKHNlcCArICdkaXN0Jyk7XG4gIGNvbnN0IGlzQnVuZGxlZEluQmluID0gKCkgPT5cbiAgICBwYXJlbnQuZW5kc1dpdGgoc2VwICsgJ2JpbicpICYmICFzdXBlclBhcmVudC5lbmRzV2l0aChzZXAgKyAnc3JjJyk7XG5cbiAgaWYgKGlzQnVuZGxlZEluUm9vdCgpIHx8IGlzQnVuZGxlZEluQmluKCkgfHwgaXNCdW5kbGVkSW5EaXN0KCkpIHtcbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogJ2J1bmRsZWQnIGFzIGNvbnN0LFxuICAgICAgcGF0aDogZmlsZVVSTFRvUGF0aChuZXcgVVJMKGAuL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpLFxuICAgIH07XG4gIH1cblxuICAvLyBydW4gdmlhIHRzeCB0byBidWlsZCB0aGUgQHJlcGthLWtpdC90cyBpdHNlbGZcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnc291cmNlJyBhcyBjb25zdCxcbiAgICBwYXRoOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uLy4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpLFxuICB9O1xufTtcblxuZXhwb3J0IGNvbnN0IG1vZHVsZVJvb3REaXJlY3RvcnkgPSBvbmNlKFxuICAoKSA9PlxuICAgIGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsKHsgaW1wb3J0TWV0YVVybDogaW1wb3J0Lm1ldGEudXJsIH0pXG4gICAgICAucGF0aFxuKTtcbiIsImltcG9ydCB7IHJlYWRGaWxlLCBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBkaXJuYW1lLCBqb2luLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi9tb2R1bGVSb290RGlyZWN0b3J5JztcblxuYXN5bmMgZnVuY3Rpb24gaXNGaWxlKGZpbGVQYXRoOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGF3YWl0IHN0YXQoZmlsZVBhdGgpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gcmVzdWx0LmlzRmlsZSgpKVxuICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uKiBpdGVyYXRlTm9kZU1vZHVsZXMoc3RhcnRXaXRoOiBzdHJpbmcsIHBhdGg6IHN0cmluZykge1xuICBsZXQgY3VycmVudCA9IHN0YXJ0V2l0aDtcbiAgd2hpbGUgKGN1cnJlbnQgIT09IHNlcCAmJiBjdXJyZW50ICE9PSAnfi8nKSB7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gam9pbihjdXJyZW50LCAnbm9kZV9tb2R1bGVzJywgcGF0aCk7XG4gICAgaWYgKGF3YWl0IGlzRmlsZShjYW5kaWRhdGUpKSB7XG4gICAgICB5aWVsZCBjYW5kaWRhdGU7XG4gICAgfVxuICAgIGlmIChjdXJyZW50ID09PSBkaXJuYW1lKGN1cnJlbnQpKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY3VycmVudCA9IGRpcm5hbWUoY3VycmVudCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmluZEJpblNjcmlwdChzdGFydFdpdGg6IHN0cmluZywgYmluU2NyaXB0UGF0aDogc3RyaW5nKSB7XG4gIGZvciBhd2FpdCAoY29uc3QgcGF0aCBvZiBpdGVyYXRlTm9kZU1vZHVsZXMoc3RhcnRXaXRoLCBiaW5TY3JpcHRQYXRoKSkge1xuICAgIHJldHVybiBwYXRoO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBiaW5QYXRoKG9wdHM6IHtcbiAgYmluTmFtZTogc3RyaW5nO1xuICBiaW5TY3JpcHRQYXRoOiBzdHJpbmc7XG59KSB7XG4gIGNvbnN0IHJvb3QgPSBtb2R1bGVSb290RGlyZWN0b3J5KCk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZpbmRCaW5TY3JpcHQocm9vdCwgb3B0cy5iaW5TY3JpcHRQYXRoKTtcbiAgaWYgKHJlc3VsdCkge1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgZmluZCBiaW4gJHtvcHRzLmJpbk5hbWV9YCk7XG59XG5cbmZ1bmN0aW9uIHNjcmlwdEZyb21QYWNrYWdlSnNvbihvcHRzOiB7XG4gIGJpbk5hbWU6IHN0cmluZztcbiAgcGFja2FnZUpzb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufSkge1xuICBjb25zdCBjYW5kaWRhdGUgPSBvcHRzLnBhY2thZ2VKc29uWydiaW4nXTtcbiAgaWYgKHR5cGVvZiBjYW5kaWRhdGUgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgY2FuZGlkYXRlID09PSAnb2JqZWN0JyAmJiBjYW5kaWRhdGUgIT09IG51bGwpIHtcbiAgICBjb25zdCBlbnRyeSA9IChjYW5kaWRhdGUgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPilbb3B0cy5iaW5OYW1lXTtcbiAgICBpZiAodHlwZW9mIGVudHJ5ID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGVudHJ5O1xuICAgIH1cbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGV0ZXJtaW5lQmluU2NyaXB0UGF0aChvcHRzOiB7XG4gIGJpbk5hbWU6IHN0cmluZztcbiAgYmluUGFja2FnZU5hbWU6IHN0cmluZztcbn0pIHtcbiAgZm9yIGF3YWl0IChjb25zdCBwYXRoIG9mIGl0ZXJhdGVOb2RlTW9kdWxlcyhcbiAgICBtb2R1bGVSb290RGlyZWN0b3J5KCksXG4gICAgam9pbihvcHRzLmJpblBhY2thZ2VOYW1lLCAncGFja2FnZS5qc29uJylcbiAgKSkge1xuICAgIGNvbnN0IHBrZyA9IGF3YWl0IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpXG4gICAgICAudGhlbigodGV4dCkgPT4gSlNPTi5wYXJzZSh0ZXh0KSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgIC5jYXRjaCgoKSA9PiBudWxsKTtcbiAgICBpZiAoIXBrZykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc2NyaXB0UGF0aCA9IHNjcmlwdEZyb21QYWNrYWdlSnNvbih7XG4gICAgICBiaW5OYW1lOiBvcHRzLmJpbk5hbWUsXG4gICAgICBwYWNrYWdlSnNvbjogcGtnLFxuICAgIH0pO1xuICAgIGlmICghc2NyaXB0UGF0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgY2FuZGlkYXRlID0gam9pbihkaXJuYW1lKHBhdGgpLCBzY3JpcHRQYXRoKTtcbiAgICBpZiAoYXdhaXQgaXNGaWxlKGNhbmRpZGF0ZSkpIHtcbiAgICAgIC8vIGRlbm9ybWFsaXplIGFuZCBtYWtlIHRoaXMgY29uc2lzdGVudCBvbiBhbGwgcGxhdGZvcm1zXG4gICAgICAvLyBhcyB0aGUgcGF0aCB3aWxsIHdvcmsgYm90aCBmb3Igd2luZG93cyBhbmQgbm9uLXdpbmRvd3NcbiAgICAgIHJldHVybiBqb2luKG9wdHMuYmluUGFja2FnZU5hbWUsIHNjcmlwdFBhdGgpLnJlcGxhY2VBbGwoc2VwLCAnLycpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiaW1wb3J0IHsgcGVyZm9ybWFuY2UgfSBmcm9tICdub2RlOnBlcmZfaG9va3MnO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcblxuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgYmluUGF0aCB9IGZyb20gJy4vdXRpbHMvYmluUGF0aCc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Uc1NjcmlwdChvcHRzOiB7XG4gIGxvY2F0aW9uOiBzdHJpbmc7XG4gIGltcG9ydE1ldGFVcmw/OiBVUkw7XG4gIGFyZ3M/OiBzdHJpbmdbXTtcbn0pIHtcbiAgY29uc3Qgc3RhcnRlZCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICB0cnkge1xuICAgIGNvbnN0IGxvY2F0aW9uID0gb3B0cy5pbXBvcnRNZXRhVXJsXG4gICAgICA/IGZpbGVVUkxUb1BhdGgobmV3IFVSTChvcHRzLmxvY2F0aW9uLCBvcHRzLmltcG9ydE1ldGFVcmwpKVxuICAgICAgOiBvcHRzLmxvY2F0aW9uO1xuXG4gICAgaWYgKGxvZ2dlci5sb2dMZXZlbCAhPT0gJ2RlYnVnJykge1xuICAgICAgbG9nZ2VyLmxvZyhgUnVubmluZyBcIiR7bG9jYXRpb259XCJgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgc3Bhd25PdXRwdXRDb25kaXRpb25hbChcbiAgICAgIHByb2Nlc3MuZXhlY1BhdGgsXG4gICAgICBbXG4gICAgICAgIGF3YWl0IGJpblBhdGgoe1xuICAgICAgICAgIGJpbk5hbWU6ICd0c3gnLFxuICAgICAgICAgIGJpblNjcmlwdFBhdGg6ICd0c3gvZGlzdC9jbGkuanMnLFxuICAgICAgICB9KSxcbiAgICAgICAgbG9jYXRpb24sXG4gICAgICAgIC4uLihvcHRzLmFyZ3MgfHwgW10pLFxuICAgICAgXSxcbiAgICAgIHtcbiAgICAgICAgZXhpdENvZGVzOiBbMF0sXG4gICAgICAgIC4uLihsb2dnZXIubG9nTGV2ZWwgPT09ICdkZWJ1ZycgJiYge1xuICAgICAgICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgICAgICAgb3V0cHV0OiBbXSxcbiAgICAgICAgfSksXG4gICAgICAgIGVudjoge1xuICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgIExPR19MRVZFTDogbG9nZ2VyLmxvZ0xldmVsLFxuICAgICAgICB9LFxuICAgICAgfVxuICAgICk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGxvZ2dlci5sb2dMZXZlbCAhPT0gJ2RlYnVnJykge1xuICAgICAgbG9nZ2VyLmxvZyhcbiAgICAgICAgYEZpbmlzaGVkIGluICR7KChwZXJmb3JtYW5jZS5ub3coKSAtIHN0YXJ0ZWQpIC8gMTAwMCkudG9GaXhlZCgyKX1zYFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcblxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4uL3V0aWxzL21vZHVsZVJvb3REaXJlY3RvcnknO1xuaW1wb3J0IHR5cGUgeyBQYWNrYWdlSnNvbiB9IGZyb20gJy4vcGFja2FnZUpzb24nO1xuXG5jb25zdCBjd2RQYWNrYWdlSnNvblBhdGggPSAoKSA9PiBqb2luKHByb2Nlc3MuY3dkKCksICcuL3BhY2thZ2UuanNvbicpO1xuXG5hc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb25BdChcbiAgcGF0aDogc3RyaW5nLFxuICBkZXBzID0geyByZWFkRmlsZTogKHBhdGg6IHN0cmluZykgPT4gcmVhZEZpbGUocGF0aCwgJ3V0Zi04JykgfVxuKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xuICByZXR1cm4gYXdhaXQgZGVwc1xuICAgIC5yZWFkRmlsZShwYXRoKVxuICAgIC50aGVuKChyZXN1bHQpID0+IEpTT04ucGFyc2UocmVzdWx0KSBhcyBQYWNrYWdlSnNvbik7XG59XG5cbmV4cG9ydCBjb25zdCByZWFkQ3dkUGFja2FnZUpzb24gPSBvbmNlQXN5bmMoKCkgPT5cbiAgcmVhZFBhY2thZ2VKc29uQXQoY3dkUGFja2FnZUpzb25QYXRoKCkpXG4pO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZFBhY2thZ2VKc29uKFxuICBwYXRoOiBzdHJpbmcsXG4gIGRlcHMgPSB7IHJlYWRGaWxlOiAocGF0aDogc3RyaW5nKSA9PiByZWFkRmlsZShwYXRoLCAndXRmLTgnKSB9XG4pOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIC8vIGFzc3VtaW5nIGN1cnJlbnQgZGlyZWN0b3J5IGRvZXNuJ3QgY2hhbmdlIHdoaWxlIGFwcCBpcyBydW5uaW5nXG4gIHJldHVybiBwYXRoID09PSBjd2RQYWNrYWdlSnNvblBhdGgoKVxuICAgID8gYXdhaXQgcmVhZEN3ZFBhY2thZ2VKc29uKClcbiAgICA6IGF3YWl0IHJlYWRQYWNrYWdlSnNvbkF0KHBhdGgsIGRlcHMpO1xufVxuXG4vKipcbiAqIFJlYWQgcGFja2FnZSBqc29uIG9mIHRoZSBjdXJyZW50IGxpYnJhcnkgKEByZXBrYS1raXQvdHMpXG4gKi9cbmV4cG9ydCBjb25zdCBvdXJQYWNrYWdlSnNvbiA9IG9uY2VBc3luYyhcbiAgYXN5bmMgKFxuICAgIGRlcHMgPSB7XG4gICAgICByZWFkRmlsZTogKHBhdGg6IHN0cmluZykgPT4gcmVhZEZpbGUocGF0aCwgJ3V0Zi04JyksXG4gICAgfVxuICApID0+IHtcbiAgICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSBqb2luKG1vZHVsZVJvb3REaXJlY3RvcnkoKSwgJ3BhY2thZ2UuanNvbicpO1xuICAgIHJldHVybiBhd2FpdCByZWFkUGFja2FnZUpzb25BdChwYWNrYWdlSnNvblBhdGgsIHtcbiAgICAgIHJlYWRGaWxlOiBkZXBzLnJlYWRGaWxlLFxuICAgIH0pO1xuICB9XG4pO1xuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydCc7XG5pbXBvcnQgeyBkaXJuYW1lLCBub3JtYWxpemUsIHNlcCB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IGVzY2FwZVJlZ0V4cCwgaXNUcnV0aHksIG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcblxuY29uc3QgZ2V0UmVwb3NpdG9yeVJvb3RTY2FuQ2FuZGlkYXRlcyA9IChjdXJyZW50RGlyZWN0b3J5OiBzdHJpbmcpID0+IHtcbiAgY29uc3QgZXNjID0gZXNjYXBlUmVnRXhwKHNlcCk7XG4gIC8vIGhhdmluZyAncGFja2FnZXMvKicgaW4gdGhlIHJvb3Qgb2YgYSBtb25vcmVwbyBpcyBzdXBlciBjb21tb25cbiAgY29uc3QgcmVzdWx0ID0gbmV3IFJlZ0V4cChcbiAgICBgKC4qKD89JHtlc2N9cGFja2FnZXMke2VzY30pKXwoLiooPz0ke2VzY31ub2RlX21vZHVsZXMke2VzY30pKXwoLiopYFxuICApLmV4ZWMoY3VycmVudERpcmVjdG9yeSk7XG4gIGFzc2VydCghIXJlc3VsdCk7XG4gIGNvbnN0IFssIHBhY2thZ2VzUm9vdCwgbm9kZU1vZHVsZXNSb290XSA9IHJlc3VsdDtcbiAgcmV0dXJuIFtwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdF0uZmlsdGVyKGlzVHJ1dGh5KTtcbn07XG5cbi8vIHJldHVybnMgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aGljaCBoYXMgbW9ub3JlcG8gbWFya2VycywgbXVsdGlwbGVcbi8vIGRpcmVjdG9yaWVzIGNhbiBoYXZlIHRoZW0gLSB3aGljaGV2ZXIgcmVhZCBmaXJzdCB3aWxsIGJlIHJldHVybmVkXG4vLyBzbyBpZiBvcmRlciBpcyBpbXBvcnRhbnQgLSBzY2FubmluZyBzaG91bGQgYmUgc2VwYXJhdGVkIHRvIG11bHRpcGxlIGpvYnNcbi8vIHZpYSBwcmlvcml0aXplZEhhc01vbm9yZXBvTWFya2Vyc1xuY29uc3QgaGFzUm9vdE1hcmtlcnNGb3IgPSBhc3luYyAoY2FuZGlkYXRlOiBzdHJpbmcpID0+IHtcbiAgY29uc3QgbWFya2VycyA9IFtcbiAgICAnLmdpdCcsXG4gICAgJ3lhcm4ubG9jaycsXG4gICAgJ3BucG0tbG9jay55YW1sJyxcbiAgICAncGFja2FnZS1sb2NrLmpzb24nLFxuICAgICdwbnBtLXdvcmtzcGFjZS55YW1sJyxcbiAgXTtcbiAgY29uc3QgbWFya2Vyc1N0cmVhbSA9IGZnLnN0cmVhbShtYXJrZXJzLCB7XG4gICAgbWFya0RpcmVjdG9yaWVzOiB0cnVlLFxuICAgIG9ubHlGaWxlczogZmFsc2UsXG4gICAgY3dkOiBjYW5kaWRhdGUsXG4gICAgYWJzb2x1dGU6IHRydWUsXG4gIH0pO1xuICBmb3IgYXdhaXQgKGNvbnN0IGVudHJ5IG9mIG1hcmtlcnNTdHJlYW0pIHtcbiAgICBhc3NlcnQodHlwZW9mIGVudHJ5ID09PSAnc3RyaW5nJyk7XG4gICAgcmV0dXJuIGRpcm5hbWUoZW50cnkpO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG5jb25zdCBoYXNSb290TWFya2VycyA9IGFzeW5jIChjYW5kaWRhdGVzOiBzdHJpbmdbXSkgPT4ge1xuICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgY2FuZGlkYXRlcy5tYXAoKGNhbmRpZGF0ZSkgPT4gaGFzUm9vdE1hcmtlcnNGb3IoY2FuZGlkYXRlKSlcbiAgKTtcbiAgcmV0dXJuIHJlc3VsdHMuZmlsdGVyKGlzVHJ1dGh5KVswXTtcbn07XG5cbmNvbnN0IHByaW9yaXRpemVkSGFzTWFya2VycyA9IChqb2JzOiBzdHJpbmdbXVtdKSA9PiB7XG4gIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+KChyZXMpID0+IHtcbiAgICBjb25zdCByZXN1bHRzID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZyB8IHVuZGVmaW5lZD4oKTtcblxuICAgIGNvbnN0IGNoZWNrU2hvdWxkQ29tcGxldGUgPSAoaW5kZXg6IG51bWJlciwgcmVzdWx0OiBzdHJpbmcgfCB1bmRlZmluZWQpID0+IHtcbiAgICAgIHJlc3VsdHMuc2V0KGluZGV4LCByZXN1bHQpO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBqb2JzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGNvbnN0IGhhc1Jlc3VsdCA9IHJlc3VsdHMuaGFzKGkpO1xuICAgICAgICBpZiAoIWhhc1Jlc3VsdCkge1xuICAgICAgICAgIC8vIGlmIGEgam9iIHdpdGggaGlnaGVzdCBwcmlvcml0eSBoYXNuJ3QgZmluaXNoZWQgeWV0XG4gICAgICAgICAgLy8gdGhlbiB3YWl0IGZvciBpdFxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc3VsdHMuZ2V0KGkpO1xuICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgLy8gam9iIGZpbmlzaGVkIGFuZCB3ZSBmb3VuZCBtYXJrZXJzLCBhbHNvIGFsbCBqb2JzXG4gICAgICAgICAgLy8gd2l0aCBoaWdoZXIgcHJpb3JpdHkgZmluaXNoZWQgYW5kIHRoZXkgZG9uJ3QgaGF2ZVxuICAgICAgICAgIC8vIGFueSBtYXJrZXJzIC0gd2UgYXJlIGRvbmVcbiAgICAgICAgICByZXMocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHJlc3VsdHMuc2l6ZSA9PT0gam9icy5sZW5ndGgpIHtcbiAgICAgICAgLy8gYWxsIGpvYnMgZmluaXNoZWQgLSBubyBtYXJrZXJzIGZvdW5kXG4gICAgICAgIHJlcyh1bmRlZmluZWQpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBqb2JzLmZvckVhY2goKGRpcmVjdG9yaWVzLCBpbmRleCkgPT4ge1xuICAgICAgaGFzUm9vdE1hcmtlcnMoZGlyZWN0b3JpZXMpXG4gICAgICAgIC50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgICBjaGVja1Nob3VsZENvbXBsZXRlKGluZGV4LCByZXN1bHQpO1xuICAgICAgICB9KVxuICAgICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgIC8vIGlnbm9yZVxuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufTtcblxuZXhwb3J0IGNvbnN0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4gPSBhc3luYyAoXG4gIGxvb2t1cERpcmVjdG9yeTogc3RyaW5nXG4pID0+IHtcbiAgY29uc3QgdW5pcXVlRGlybmFtZSA9IChwYXRoPzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKCFwYXRoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGRpcm5hbWUocGF0aCk7XG4gICAgaWYgKHJlc3VsdCA9PT0gcGF0aCkge1xuICAgICAgLy8gZS5nLiB0aGUgcGF0aCB3YXMgYWxyZWFkeSBhIHJvb3QgXCIvXCJcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICBjb25zdCBwYXJlbnQgPSB1bmlxdWVEaXJuYW1lKGxvb2t1cERpcmVjdG9yeSk7XG4gIGNvbnN0IHN1cGVyUGFyZW50ID0gdW5pcXVlRGlybmFtZShwYXJlbnQpO1xuXG4gIGNvbnN0IHJlc3VsdCA9XG4gICAgKGF3YWl0IHByaW9yaXRpemVkSGFzTWFya2VycyhcbiAgICAgIC8vIHNjYW4gaW4gbW9zdCBsaWtlbHkgbG9jYXRpb25zIGZpcnN0IHdpdGggY3VycmVudCBsb29rdXAgZGlyZWN0b3J5IHRha2luZyBwcmlvcml0eVxuICAgICAgW1xuICAgICAgICBbbG9va3VwRGlyZWN0b3J5XSxcbiAgICAgICAgZ2V0UmVwb3NpdG9yeVJvb3RTY2FuQ2FuZGlkYXRlcyhsb29rdXBEaXJlY3RvcnkpLFxuICAgICAgICAvLyBzY2FuIDIgZGlyZWN0b3JpZXMgdXB3YXJkc1xuICAgICAgICBbcGFyZW50XSxcbiAgICAgICAgW3N1cGVyUGFyZW50XSxcbiAgICAgIF1cbiAgICAgICAgLm1hcCgoZGlycykgPT4gZGlycy5maWx0ZXIoaXNUcnV0aHkpKVxuICAgICAgICAuZmlsdGVyKChqb2IpID0+IGpvYi5sZW5ndGggPiAwKVxuICAgICkpIHx8IGxvb2t1cERpcmVjdG9yeTsgLyogZmFsbGJhY2sgdG8gY3VycmVudCBkaXJlY3RvcnkgaW4gd29yc2Ugc2NlbmFyaW8gKi9cblxuICByZXR1cm4gbm9ybWFsaXplKHJlc3VsdCk7XG59O1xuXG4vKipcbiAqIERldGVybWluZSByZXBvc2l0b3J5IHJvb3QgcGF0aCBieSBzY2FubmluZyBjdXJyZW50IGFuZCBwYXJlbnQgZGlyZWN0b3JpZXNcbiAqIGFuZCBsb29raW5nIGZvciBtYXJrZXIgZmlsZXMvZGlycyBsaWtlOlxuICpcbiAqIC0gLmdpdFxuICogLSBwYWNrYWdlLWxvY2suanNvblxuICogLSB5YXJuLmxvY2tcbiAqIC0gcG5wbS1sb2NrLnlhbWxcbiAqIC0gcG5wbS13b3Jrc3BhY2UueWFtbFxuICovXG5leHBvcnQgY29uc3QgcmVwb3NpdG9yeVJvb3RQYXRoID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3Qgcm9vdFBhdGggPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuKHByb2Nlc3MuY3dkKCkpO1xuICByZXR1cm4gcm9vdFBhdGg7XG59KTtcbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcbmltcG9ydCB7IGxvYWQgfSBmcm9tICdqcy15YW1sJztcblxuaW1wb3J0IHsgcmVhZFBhY2thZ2VKc29uIH0gZnJvbSAnLi4vcGFja2FnZS1qc29uL3JlYWRQYWNrYWdlSnNvbic7XG5pbXBvcnQgeyByZXBvc2l0b3J5Um9vdFBhdGggfSBmcm9tICcuL3JlcG9zaXRvcnlSb290UGF0aCc7XG5cbmFzeW5jIGZ1bmN0aW9uIHRyeVJlYWRpbmdQbnBtV29ya3NwYWNlWWFtbChtb25vcmVwb1Jvb3Q6IHN0cmluZykge1xuICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVhZEZpbGUoXG4gICAgam9pbihtb25vcmVwb1Jvb3QsICdwbnBtLXdvcmtzcGFjZS55YW1sJyksXG4gICAgJ3V0Zi04J1xuICApO1xuICBjb25zdCByb290UGF0aCA9IGxvYWQodGV4dCkgYXMge1xuICAgIHBhY2thZ2VzPzogc3RyaW5nW107XG4gIH07XG4gIHJldHVybiBBcnJheS5pc0FycmF5KHJvb3RQYXRoLnBhY2thZ2VzKSAmJiByb290UGF0aC5wYWNrYWdlcy5sZW5ndGggPiAwXG4gICAgPyByb290UGF0aC5wYWNrYWdlc1xuICAgIDogdW5kZWZpbmVkO1xufVxuXG5hc3luYyBmdW5jdGlvbiB0cnlSZWFkaW5nUGFja2FnZUpzb25Xb3Jrc3BhY2VzKG1vbm9yZXBvUm9vdDogc3RyaW5nKSB7XG4gIGNvbnN0IHBhY2thZ2VKc29uID0gYXdhaXQgcmVhZFBhY2thZ2VKc29uKGpvaW4obW9ub3JlcG9Sb290LCAncGFja2FnZS5qc29uJykpO1xuICBjb25zdCB3b3Jrc3BhY2VzID0gcGFja2FnZUpzb25bJ3dvcmtzcGFjZXMnXTtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkod29ya3NwYWNlcykgJiYgd29ya3NwYWNlcy5sZW5ndGggPiAwXG4gICAgPyB3b3Jrc3BhY2VzLmZsYXRNYXAoKGVudHJ5KSA9PiAodHlwZW9mIGVudHJ5ID09PSAnc3RyaW5nJyA/IFtlbnRyeV0gOiBbXSkpXG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbmNvbnN0IHJlYWRQYWNrYWdlc0dsb2JzQXQgPSBhc3luYyAobW9ub3JlcG9Sb290OiBzdHJpbmcpID0+IHtcbiAgY29uc3QgW3BucG1Xb3Jrc3BhY2VzLCBwYWNrYWdlSnNvbldvcmtzcGFjZXNdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHRyeVJlYWRpbmdQbnBtV29ya3NwYWNlWWFtbChtb25vcmVwb1Jvb3QpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCksXG4gICAgdHJ5UmVhZGluZ1BhY2thZ2VKc29uV29ya3NwYWNlcyhtb25vcmVwb1Jvb3QpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCksXG4gIF0pO1xuICByZXR1cm4gcG5wbVdvcmtzcGFjZXMgfHwgcGFja2FnZUpzb25Xb3Jrc3BhY2VzIHx8IFtdO1xufTtcblxuLyoqXG4gKiBEZXRlcm1pbmUgbW9ub3JlcG8gcGFja2FnZXMgZ2xvYiBieSByZWFkaW5nIG9uZSBvZiB0aGUgc3VwcG9ydGVkXG4gKiBmaWxlc1xuICpcbiAqIE5PVEU6IG9ubHkgcG5wbSBpcyBzdXBwb3J0ZWQgYXQgdGhlIG1vbWVudFxuICovXG5leHBvcnQgY29uc3QgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHJvb3QgPSBhd2FpdCByZXBvc2l0b3J5Um9vdFBhdGgoKTtcbiAgY29uc3QgcGFja2FnZXNHbG9icyA9IGF3YWl0IHJlYWRQYWNrYWdlc0dsb2JzQXQocm9vdCk7XG4gIHJldHVybiB7XG4gICAgcm9vdCxcbiAgICBwYWNrYWdlc0dsb2JzLFxuICB9O1xufSk7XG4iLCJpbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5cbmltcG9ydCB7IHJlYWRNb25vcmVwb1BhY2thZ2VzR2xvYnMgfSBmcm9tICcuL3JlYWRQYWNrYWdlc0dsb2JzJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbigpIHtcbiAgY29uc3QgW3sgcm9vdCwgcGFja2FnZXNHbG9icyB9XSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzKCksXG4gIF0pO1xuXG4gIGlmIChwYWNrYWdlc0dsb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB7XG4gICAgICByb290LFxuICAgICAgcGFja2FnZXNHbG9icyxcbiAgICAgIHBhY2thZ2VMb2NhdGlvbnM6IFtdLFxuICAgICAgdHlwZTogJ3NpbmdsZS1wYWNrYWdlJyBhcyBjb25zdCxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgcGFja2FnZUxvY2F0aW9ucyA9IGF3YWl0IGZnKFxuICAgIHBhY2thZ2VzR2xvYnMubWFwKChnbG9iKSA9PiBgJHtnbG9ifS9wYWNrYWdlLmpzb25gKSxcbiAgICB7XG4gICAgICBjd2Q6IHJvb3QsXG4gICAgfVxuICApO1xuXG4gIHJldHVybiB7XG4gICAgcm9vdCxcbiAgICBwYWNrYWdlc0dsb2JzLFxuICAgIHBhY2thZ2VMb2NhdGlvbnM6IHBhY2thZ2VMb2NhdGlvbnMubWFwKChsb2NhdGlvbikgPT4gZGlybmFtZShsb2NhdGlvbikpLFxuICAgIHR5cGU6ICdtdWx0aXBsZS1wYWNrYWdlcycgYXMgY29uc3QsXG4gIH07XG59XG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBDb25maWcgfSBmcm9tICdqZXN0JztcbmltcG9ydCB7IGRlZmF1bHRzIH0gZnJvbSAnamVzdC1jb25maWcnO1xuXG5leHBvcnQgY29uc3QgZXh0ZW5zaW9ucyA9IFtcbiAgJ2pzJyxcbiAgJ2NqcycsXG4gICdtanMnLFxuICAnanN4JyxcbiAgJ3RzJyxcbiAgJ2N0cycsXG4gICdtdHMnLFxuICAndHN4Jyxcbl07XG5cbmV4cG9ydCBjb25zdCBpZ25vcmVEaXJzID0gWycvbm9kZV9tb2R1bGVzLycsICcvZGlzdC8nLCAnLy50c2Mtb3V0LyddO1xuXG5leHBvcnQgY29uc3QgamVzdFRyYW5zZm9ybUNvbmZpZ1Byb3AgPSAoXG4gIGplc3RQbHVnaW5Sb290Pzogc3RyaW5nXG4pOiBQaWNrPENvbmZpZywgJ3RyYW5zZm9ybSc+ID0+IHtcbiAgY29uc3QgZXNidWlsZCA9IGplc3RQbHVnaW5Sb290XG4gICAgPyBqb2luKGplc3RQbHVnaW5Sb290LCAnZXNidWlsZC1qZXN0JylcbiAgICA6ICdlc2J1aWxkLWplc3QnO1xuXG4gIGNvbnN0IGVzYnVpbGREZWZhdWx0T3B0cyA9IHtcbiAgICB0YXJnZXQ6IGBub2RlJHtwcm9jZXNzLnZlcnNpb25zLm5vZGV9YCxcbiAgICBzb3VyY2VtYXA6IHRydWUsXG4gIH07XG5cbiAgY29uc3QgbG9hZGVyQnlFeHQgPSB7XG4gICAgdHM6IHsgbG9hZGVyOiAndHMnLCBmb3JtYXQ6ICdlc20nIH0sXG4gICAgY3RzOiB7IGxvYWRlcjogJ3RzJywgZm9ybWF0OiAnY2pzJyB9LFxuICAgIG10czogeyBsb2FkZXI6ICd0cycsIGZvcm1hdDogJ2VzbScgfSxcbiAgICBjdHN4OiB7IGxvYWRlcjogJ3RzeCcsIGZvcm1hdDogJ2NqcycgfSxcbiAgICBtdHN4OiB7IGxvYWRlcjogJ3RzeCcsIGZvcm1hdDogJ2VzbScgfSxcbiAgICB0c3g6IHsgbG9hZGVyOiAndHN4JywgZm9ybWF0OiAnZXNtJyB9LFxuICB9O1xuXG4gIHJldHVybiB7XG4gICAgdHJhbnNmb3JtOiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICBPYmplY3QuZW50cmllcyhsb2FkZXJCeUV4dCkubWFwKChbZXh0LCBvcHRzXSkgPT4gW1xuICAgICAgICBgXi4rXFxcXC4ke2V4dH0kYCxcbiAgICAgICAgW1xuICAgICAgICAgIGVzYnVpbGQsXG4gICAgICAgICAge1xuICAgICAgICAgICAgLi4uZXNidWlsZERlZmF1bHRPcHRzLFxuICAgICAgICAgICAgZm9ybWF0OiBvcHRzLmZvcm1hdCxcbiAgICAgICAgICAgIGxvYWRlcnM6IHtcbiAgICAgICAgICAgICAgW2AuJHtleHR9YF06IG9wdHMubG9hZGVyLFxuICAgICAgICAgICAgICBbYC50ZXN0LiR7ZXh0fWBdOiBvcHRzLmxvYWRlcixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIF0pXG4gICAgKSxcbiAgfTtcbn07XG5cbmV4cG9ydCBjb25zdCBjb21tb25EZWZhdWx0czogQ29uZmlnID0ge1xuICBjYWNoZURpcmVjdG9yeTogJ25vZGVfbW9kdWxlcy8uamVzdC1jYWNoZScsXG4gIHRlc3RQYXRoSWdub3JlUGF0dGVybnM6IFtcbiAgICAuLi5pZ25vcmVEaXJzLm1hcCgoZGlyKSA9PiBgPHJvb3REaXI+JHtkaXJ9YCksXG4gICAgJzxyb290RGlyPi8uKi90ZXN0LWNhc2VzLycsXG4gIF0sXG4gIHRyYW5zZm9ybUlnbm9yZVBhdHRlcm5zOiBbLi4uaWdub3JlRGlycy5tYXAoKGRpcikgPT4gYDxyb290RGlyPiR7ZGlyfWApXSxcbiAgY292ZXJhZ2VQYXRoSWdub3JlUGF0dGVybnM6IFsuLi5pZ25vcmVEaXJzLm1hcCgoZGlyKSA9PiBgPHJvb3REaXI+JHtkaXJ9YCldLFxuICBtb2R1bGVQYXRoSWdub3JlUGF0dGVybnM6IFsuLi5pZ25vcmVEaXJzLm1hcCgoZGlyKSA9PiBgPHJvb3REaXI+JHtkaXJ9YCldLFxuICBtb2R1bGVGaWxlRXh0ZW5zaW9uczogW1xuICAgIC4uLm5ldyBTZXQoWy4uLmRlZmF1bHRzLm1vZHVsZUZpbGVFeHRlbnNpb25zLCAuLi5leHRlbnNpb25zXSksXG4gIF0sXG4gIGV4dGVuc2lvbnNUb1RyZWF0QXNFc206IFsnLmpzeCcsICcudHMnLCAnLm10cycsICcudHN4J10sXG4gIHJvb3REaXI6IHByb2Nlc3MuY3dkKCksXG59O1xuXG5jb25zdCBmbGF2b3JSZWdleCA9IC9cXHcrLztcblxuZXhwb3J0IGZ1bmN0aW9uIGN1c3RvbUZsYXZvclRlc3REZWZhdWx0cyhmbGF2b3I6IHN0cmluZyk6IENvbmZpZyB7XG4gIGlmIChmbGF2b3IgPT09ICd1bml0Jykge1xuICAgIHRocm93IG5ldyBFcnJvcignRmxhdm9yIGNhbm5vdCBiZSB1bml0Jyk7XG4gIH1cbiAgaWYgKCFmbGF2b3JSZWdleC50ZXN0KGZsYXZvcikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEZsYXZvciBzaG91bGQgbWF0Y2ggLyR7Zmxhdm9yUmVnZXguc291cmNlfS9gKTtcbiAgfVxuICBjb25zdCByb290cyA9IFsnPHJvb3REaXI+JywgJzxyb290RGlyPi9zcmMnXTtcbiAgY29uc3QgZmxhdm9yVGVzdEdsb2JzID0gW2BfXyR7Zmxhdm9yfV9fLyoqYF07XG4gIGNvbnN0IGV4dHMgPSBleHRlbnNpb25zLmpvaW4oJywnKTtcbiAgY29uc3QgZmxhdm9yVGVzdE1hdGNoID0gZmxhdm9yVGVzdEdsb2JzXG4gICAgLmZsYXRNYXAoKGdsb2IpID0+XG4gICAgICByb290cy5tYXAoKHJvb3QpID0+IFtyb290LCBnbG9iXS5maWx0ZXIoQm9vbGVhbikuam9pbignLycpKVxuICAgIClcbiAgICAubWFwKChnbG9iKSA9PiBbZ2xvYiwgYCoudGVzdC57JHtleHRzfX1gXS5qb2luKCcvJykpO1xuXG4gIHJldHVybiB7XG4gICAgdGVzdE1hdGNoOiBmbGF2b3JUZXN0TWF0Y2gsXG4gICAgdGVzdFRpbWVvdXQ6IDQ1XzAwMCxcbiAgICBzbG93VGVzdFRocmVzaG9sZDogMzBfMDAwLFxuICAgIGNvdmVyYWdlRGlyZWN0b3J5OiBgbm9kZV9tb2R1bGVzLy5jb3ZlcmFnZS0ke2ZsYXZvcn1gLFxuICAgIC4uLmNvbW1vbkRlZmF1bHRzLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdW5pdFRlc3REZWZhdWx0cygpOiBDb25maWcge1xuICBjb25zdCByb290cyA9IFsnPHJvb3REaXI+J107XG4gIGNvbnN0IHVuaXRUZXN0R2xvYnMgPSBbJyoqL19fdGVzdHNfXy8qKicsICcqKiddO1xuICBjb25zdCBleHRzID0gZXh0ZW5zaW9ucy5qb2luKCcsJyk7XG4gIGNvbnN0IHVuaXRUZXN0TWF0Y2ggPSB1bml0VGVzdEdsb2JzXG4gICAgLmZsYXRNYXAoKGdsb2IpID0+XG4gICAgICByb290cy5tYXAoKHJvb3QpID0+IFtyb290LCBnbG9iXS5maWx0ZXIoQm9vbGVhbikuam9pbignLycpKVxuICAgIClcbiAgICAubWFwKChnbG9iKSA9PiBbZ2xvYiwgYCoudGVzdC57JHtleHRzfX1gXS5qb2luKCcvJykpO1xuXG4gIHJldHVybiB7XG4gICAgdGVzdE1hdGNoOiB1bml0VGVzdE1hdGNoLFxuICAgIGNvdmVyYWdlRGlyZWN0b3J5OiAnbm9kZV9tb2R1bGVzLy5jb3ZlcmFnZS11bml0JyxcbiAgICAuLi5jb21tb25EZWZhdWx0cyxcbiAgICB0ZXN0UGF0aElnbm9yZVBhdHRlcm5zOiBbXG4gICAgICAuLi4oY29tbW9uRGVmYXVsdHMudGVzdFBhdGhJZ25vcmVQYXR0ZXJucyB8fCBbXSksXG4gICAgICBgPHJvb3REaXI+Lyg/IV9fdGVzdHNfXykoX19bYS16QS1aMC05XStfXykvYCxcbiAgICAgIGA8cm9vdERpcj4vc3JjLyg/IV9fdGVzdHNfXykoX19bYS16QS1aMC05XStfXykvYCxcbiAgICBdLFxuICB9O1xufVxuIiwiaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gJ25vZGU6Y3J5cHRvJztcbmltcG9ydCB7IG1rZGlyLCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0IHsgam9pbiwgcmVzb2x2ZSwgc2VwIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IGZnIGZyb20gJ2Zhc3QtZ2xvYic7XG5cbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuLi91dGlscy9tb2R1bGVSb290RGlyZWN0b3J5JztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdlbmVyYXRlU2NyaXB0KG9wdHM6IHtcbiAgc2NyaXB0OiAnc2V0dXAnIHwgJ3RlYXJkb3duJztcbiAgZmxhdm9yOiBzdHJpbmc7XG4gIHJvb3REaXI6IHN0cmluZztcbn0pIHtcbiAgY29uc3QgeyBmbGF2b3IsIHNjcmlwdCwgcm9vdERpciB9ID0gb3B0cztcblxuICBjb25zdCBzdHJlYW0gPSBmZy5zdHJlYW0oXG4gICAgW2BfXyR7Zmxhdm9yfV9fLyR7c2NyaXB0fS50c2AsIGBzcmMvX18ke2ZsYXZvcn1fXy8ke3NjcmlwdH0udHNgXSxcbiAgICB7XG4gICAgICBjd2Q6IHJvb3REaXIsXG4gICAgfVxuICApIGFzIEFzeW5jSXRlcmFibGU8c3RyaW5nPjtcblxuICBmb3IgYXdhaXQgKGNvbnN0IHNjcmlwdExvYyBvZiBzdHJlYW0pIHtcbiAgICBpZiAoc2NyaXB0TG9jKSB7XG4gICAgICBjb25zdCByb290ID0gbW9kdWxlUm9vdERpcmVjdG9yeSgpO1xuICAgICAgY29uc3QgbG9jYXRpb24gPSByZXNvbHZlKGpvaW4ocm9vdERpciwgc2NyaXB0TG9jKSk7XG5cbiAgICAgIGNvbnN0IG1vZHVsZVBhdGggPSAoaW5wdXQ6IHN0cmluZykgPT5cbiAgICAgICAgcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJ1xuICAgICAgICAgID8gYGZpbGU6Ly8ke2lucHV0LnJlcGxhY2VBbGwoc2VwLCAnLycpfWBcbiAgICAgICAgICA6IGlucHV0O1xuXG4gICAgICBjb25zdCBzY3JpcHQgPSBgaW1wb3J0IHsgcnVuVHNTY3JpcHQgfSBmcm9tICR7SlNPTi5zdHJpbmdpZnkoXG4gICAgICAgIG1vZHVsZVBhdGgoam9pbihyb290LCAnY29uZmlncy9qZXN0L2plc3RDb25maWdIZWxwZXJzLmdlbi5tanMnKSlcbiAgICAgICl9O1xuXG5leHBvcnQgZGVmYXVsdCBhc3luYyAoKSA9PiB7XG5hd2FpdCBydW5Uc1NjcmlwdCh7XG4gIGxvY2F0aW9uOiAke0pTT04uc3RyaW5naWZ5KGxvY2F0aW9uKX1cbn0pXG59YDtcblxuICAgICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTEnKVxuICAgICAgICAudXBkYXRlKHJvb3REaXIpXG4gICAgICAgIC51cGRhdGUoZmxhdm9yKVxuICAgICAgICAudXBkYXRlKHNjcmlwdClcbiAgICAgICAgLmRpZ2VzdCgpXG4gICAgICAgIC50b1N0cmluZygnaGV4Jyk7XG5cbiAgICAgIGNvbnN0IGRpciA9IGpvaW4odG1wZGlyKCksICdqZXN0LXNjcmlwdHMnKTtcbiAgICAgIGNvbnN0IGZpbGUgPSBqb2luKGRpciwgYCR7aGFzaH0ubWpzYCk7XG5cbiAgICAgIGF3YWl0IG1rZGlyKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG5cbiAgICAgIGF3YWl0IHdyaXRlRmlsZShmaWxlLCBzY3JpcHQpO1xuXG4gICAgICByZXR1cm4gZmlsZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaXNEaXJlY3RvcnkocGF0aDogc3RyaW5nKSB7XG4gIHJldHVybiBzdGF0KHBhdGgpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gcmVzdWx0LmlzRGlyZWN0b3J5KCkpXG4gICAgLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG59XG4iLCJpbXBvcnQgeyBkaXJuYW1lLCBqb2luIH0gZnJvbSAncGF0aCc7XG5cbnR5cGUgVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMgPSB7XG4gIHN0YXJ0OiBzdHJpbmc7XG4gIHN0b3BzPzogc3RyaW5nW107XG4gIGFwcGVuZFBhdGg/OiBzdHJpbmc7XG4gIHRlc3Q6IChwYXRoOiBzdHJpbmcpID0+IFByb21pc2U8Ym9vbGVhbiB8IHN0cmluZyB8IHVuZGVmaW5lZD47XG59O1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24qIHVwd2FyZERpcmVjdG9yeVdhbGsob3B0czogVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMpIHtcbiAgbGV0IGN1cnJlbnQgPSBvcHRzLnN0YXJ0O1xuICB3aGlsZSAoXG4gICAgY3VycmVudCAhPT0gJy8nICYmXG4gICAgY3VycmVudCAhPT0gJ34vJyAmJlxuICAgICEob3B0cy5zdG9wcz8uaW5jbHVkZXMoY3VycmVudCkgPz8gZmFsc2UpXG4gICkge1xuICAgIGNvbnN0IHBhdGggPSBvcHRzLmFwcGVuZFBhdGggPyBqb2luKGN1cnJlbnQsIG9wdHMuYXBwZW5kUGF0aCkgOiBjdXJyZW50O1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGF3YWl0IG9wdHMudGVzdChwYXRoKTtcbiAgICBpZiAoY2FuZGlkYXRlKSB7XG4gICAgICB5aWVsZCB0eXBlb2YgY2FuZGlkYXRlID09PSAnc3RyaW5nJyA/IGNhbmRpZGF0ZSA6IHBhdGg7XG4gICAgfVxuICAgIGN1cnJlbnQgPSBkaXJuYW1lKGN1cnJlbnQpO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cHdhcmREaXJlY3RvcnlTZWFyY2gob3B0czogVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMpIHtcbiAgY29uc3Qgd2FsayA9IHVwd2FyZERpcmVjdG9yeVdhbGsob3B0cyk7XG4gIGZvciBhd2FpdCAoY29uc3QgZGlyIG9mIHdhbGspIHtcbiAgICByZXR1cm4gZGlyO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgaXNEaXJlY3RvcnkgfSBmcm9tICcuL2lzRGlyZWN0b3J5JztcbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuL21vZHVsZVJvb3REaXJlY3RvcnknO1xuaW1wb3J0IHsgdXB3YXJkRGlyZWN0b3J5U2VhcmNoIH0gZnJvbSAnLi91cHdhcmREaXJlY3RvcnlTZWFyY2gnO1xuXG5leHBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmV4cG9ydCB7IGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbiB9IGZyb20gJy4vbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uJztcbmV4cG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuYXN5bmMgZnVuY3Rpb24gbG9va3VwKG9wdHM6IHsgcGF0aDogc3RyaW5nOyBsb29rdXBQYWNrYWdlTmFtZTogc3RyaW5nIH0pIHtcbiAgcmV0dXJuIGF3YWl0IHVwd2FyZERpcmVjdG9yeVNlYXJjaCh7XG4gICAgc3RhcnQ6IG1vZHVsZVJvb3REaXJlY3RvcnkoKSxcbiAgICBhcHBlbmRQYXRoOiBqb2luKCdub2RlX21vZHVsZXMnLCBvcHRzLmxvb2t1cFBhY2thZ2VOYW1lKSxcbiAgICB0ZXN0OiBpc0RpcmVjdG9yeSxcbiAgfSk7XG59XG5cbi8qKlxuICogTG9va3VwIGxvY2F0aW9uIGZvciBkZXZEZXBlbmRlbmNpZXMgb2YgXCJAcmVwa2Eta2l0L3RzXCIgLSB0aGlzIGZ1bmN0aW9uIHdpbGxcbiAqIGxvb2t1cCBmb3IgXCJvcHRzLmxvb2t1cFBhY2thZ2VOYW1lXCJcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZpbmREZXZEZXBlbmRlbmN5KG9wdHM6IHsgbG9va3VwUGFja2FnZU5hbWU6IHN0cmluZyB9KSB7XG4gIGNvbnN0IGxvb2t1cFBhY2thZ2VOYW1lID0gb3B0cy5sb29rdXBQYWNrYWdlTmFtZTtcblxuICByZXR1cm4gYXdhaXQgbG9va3VwKHtcbiAgICBwYXRoOiBtb2R1bGVSb290RGlyZWN0b3J5KCksXG4gICAgbG9va3VwUGFja2FnZU5hbWUsXG4gIH0pO1xufVxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XG5cbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgZmluZERldkRlcGVuZGVuY3kgfSBmcm9tICcuLi91dGlscy9maW5kRGV2RGVwZW5kZW5jeSc7XG5cbmV4cG9ydCBjb25zdCBqZXN0UGx1Z2luUm9vdCA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZpbmREZXZEZXBlbmRlbmN5KHtcbiAgICBsb29rdXBQYWNrYWdlTmFtZTogJ2VzYnVpbGQtamVzdCcsXG4gIH0pO1xuICBpZiAoIXJlc3VsdCkge1xuICAgIGxvZ2dlci53YXJuKFxuICAgICAgJ0plc3QgcGx1Z2lucyByb290IGNhbm5vdCBiZSBkZXRlcm1pbmVkLiBEbyB5b3UgaGF2ZSBcIkByZXBrYS1raXQvdHNcIiBpbiBkZXZEZXBlbmRlbmNpZXMgYXQgdGhlIG1vbm9yZXBvIHJvb3Qgb3IgYXQgdGhlIGxvY2FsIHBhY2thZ2U/J1xuICAgICk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJykge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdGb3VuZCBqZXN0IHBsdWdpbnMgcm9vdCBhdCcsIGRpcm5hbWUocmVzdWx0KSk7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQgPyBkaXJuYW1lKHJlc3VsdCkgOiAnLic7XG59KTtcbiIsImltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgdHlwZSB7IENvbmZpZyB9IGZyb20gJ2plc3QnO1xuaW1wb3J0IHsgcmVhZEluaXRpYWxPcHRpb25zIH0gZnJvbSAnamVzdC1jb25maWcnO1xuXG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmltcG9ydCB7IGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbiB9IGZyb20gJy4uL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbic7XG5pbXBvcnQge1xuICBjdXN0b21GbGF2b3JUZXN0RGVmYXVsdHMsXG4gIGplc3RUcmFuc2Zvcm1Db25maWdQcm9wLFxuICB1bml0VGVzdERlZmF1bHRzLFxufSBmcm9tICcuL2NvbmZpZ0J1aWxkaW5nQmxvY2tzJztcbmltcG9ydCB7IGdlbmVyYXRlU2NyaXB0IH0gZnJvbSAnLi9nZW5lcmF0ZVNjcmlwdCc7XG5pbXBvcnQgeyBqZXN0UGx1Z2luUm9vdCB9IGZyb20gJy4vamVzdFBsdWdpblJvb3QnO1xuXG5leHBvcnQgdHlwZSBUZXN0Rmxhdm9yID1cbiAgfCAndW5pdCdcbiAgfCAnaW50ZWdyYXRpb24nXG4gIHwgKHN0cmluZyAmIHtcbiAgICAgICQkY3VzdG9tOiBuZXZlcjtcbiAgICB9KTtcblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQ29uZmlnKFxuICBmbGF2b3I6IFRlc3RGbGF2b3IsXG4gIHJvb3REaXI6IHN0cmluZyxcbiAgcGFyZW50Um9vdERpcj86IHN0cmluZ1xuKSB7XG4gIGNvbnN0IHBsdWdpblJvb3QgPSBqZXN0UGx1Z2luUm9vdCgpO1xuXG4gIGNvbnN0IGJhc2VDb25maWcgPVxuICAgIGZsYXZvciA9PT0gJ3VuaXQnID8gdW5pdFRlc3REZWZhdWx0cygpIDogY3VzdG9tRmxhdm9yVGVzdERlZmF1bHRzKGZsYXZvcik7XG5cbiAgY29uc3QgZ2xvYmFsU2V0dXAgPSBnZW5lcmF0ZVNjcmlwdCh7XG4gICAgc2NyaXB0OiAnc2V0dXAnLFxuICAgIGZsYXZvcixcbiAgICByb290RGlyLFxuICB9KTtcblxuICBjb25zdCBnbG9iYWxUZWFyZG93biA9IGdlbmVyYXRlU2NyaXB0KHtcbiAgICBzY3JpcHQ6ICd0ZWFyZG93bicsXG4gICAgZmxhdm9yLFxuICAgIHJvb3REaXIsXG4gIH0pO1xuXG4gIHByb2Nlc3MuZW52WydURVNUX0ZMQVZPUiddID0gZmxhdm9yO1xuXG4gIGNvbnN0IGplc3RDb25maWcgPSByZWFkSW5pdGlhbE9wdGlvbnModW5kZWZpbmVkLCB7XG4gICAgcGFja2FnZVJvb3RPckNvbmZpZzogcm9vdERpcixcbiAgICBwYXJlbnRDb25maWdEaXJuYW1lOiBwYXJlbnRSb290RGlyLFxuICAgIHJlYWRGcm9tQ3dkOiBmYWxzZSxcbiAgICBza2lwTXVsdGlwbGVDb25maWdFcnJvcjogdHJ1ZSxcbiAgfSk7XG5cbiAgY29uc3QgcmVzb2x2ZWRDb25maWcgPSAoYXdhaXQgamVzdENvbmZpZykuY29uZmlnO1xuXG4gIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAuLi5iYXNlQ29uZmlnLFxuICAgIC4uLmplc3RUcmFuc2Zvcm1Db25maWdQcm9wKGF3YWl0IHBsdWdpblJvb3QpLFxuICAgIC4uLnJlc29sdmVkQ29uZmlnLFxuICAgIGdsb2JhbFNldHVwOiBhd2FpdCBnbG9iYWxTZXR1cCxcbiAgICBnbG9iYWxUZWFyZG93bjogYXdhaXQgZ2xvYmFsVGVhcmRvd24sXG4gIH07XG5cbiAgcmV0dXJuIGNvbmZpZztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUplc3RDb25maWdGb3JTaW5nbGVQYWNrYWdlKHtcbiAgZmxhdm9yID0gJ3VuaXQnLFxuICByb290RGlyID0gcHJvY2Vzcy5jd2QoKSxcbn06IHtcbiAgZmxhdm9yOiBUZXN0Rmxhdm9yO1xuICByb290RGlyPzogc3RyaW5nO1xufSk6IFByb21pc2U8Q29uZmlnPiB7XG4gIHJldHVybiBhd2FpdCBjcmVhdGVDb25maWcoZmxhdm9yLCByb290RGlyKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUplc3RDb25maWdGb3JNb25vcmVwbyh7XG4gIGZsYXZvciA9ICd1bml0JyxcbiAgY3dkID0gcHJvY2Vzcy5jd2QoKSxcbn06IHtcbiAgZmxhdm9yOiBUZXN0Rmxhdm9yO1xuICBjd2Q6IHN0cmluZztcbn0pOiBQcm9taXNlPENvbmZpZz4ge1xuICBjb25zdCByZXBvQ29uZmlnID0gYXdhaXQgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uKCk7XG5cbiAgaWYgKHJlcG9Db25maWcudHlwZSA9PT0gJ3NpbmdsZS1wYWNrYWdlJykge1xuICAgIHJldHVybiBjcmVhdGVKZXN0Q29uZmlnRm9yU2luZ2xlUGFja2FnZSh7XG4gICAgICBmbGF2b3IsXG4gICAgICByb290RGlyOiByZXBvQ29uZmlnLnJvb3QsXG4gICAgfSk7XG4gIH1cblxuICBpZiAocmVwb0NvbmZpZy5yb290ICE9PSBjd2QpIHtcbiAgICByZXR1cm4gY3JlYXRlSmVzdENvbmZpZ0ZvclNpbmdsZVBhY2thZ2UoeyBmbGF2b3IsIHJvb3REaXI6IGN3ZCB9KTtcbiAgfVxuXG4gIGNvbnN0IHByb2plY3RzID0gKFxuICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgcmVwb0NvbmZpZy5wYWNrYWdlTG9jYXRpb25zLm1hcChhc3luYyAobG9jYXRpb24pID0+IHtcbiAgICAgICAgY29uc3QgYmFzZUNvbmZpZyA9IGNyZWF0ZUNvbmZpZyhmbGF2b3IsIGxvY2F0aW9uLCBjd2QpO1xuICAgICAgICBjb25zdCBwYWNrYWdlSnNvbiA9IHJlYWRQYWNrYWdlSnNvbihqb2luKGxvY2F0aW9uLCAncGFja2FnZS5qc29uJykpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIC4uLihhd2FpdCBiYXNlQ29uZmlnKSxcbiAgICAgICAgICByb290RGlyOiBsb2NhdGlvbixcbiAgICAgICAgICBkaXNwbGF5TmFtZTogKGF3YWl0IHBhY2thZ2VKc29uKS5uYW1lLFxuICAgICAgICB9O1xuICAgICAgfSlcbiAgICApXG4gICkuZmlsdGVyKEJvb2xlYW4pO1xuXG4gIGNvbnN0IHRlc3RUaW1lb3V0ID0gcHJvamVjdHMucmVkdWNlKFxuICAgIChhY2MsIHByb2plY3QpID0+XG4gICAgICBNYXRoLm1heChcbiAgICAgICAgYWNjLFxuICAgICAgICB0eXBlb2YgcHJvamVjdC50ZXN0VGltZW91dCA9PT0gJ251bWJlcicgPyBwcm9qZWN0LnRlc3RUaW1lb3V0IDogMFxuICAgICAgKSxcbiAgICAwXG4gICk7XG5cbiAgcmV0dXJuIHtcbiAgICAuLi4odGVzdFRpbWVvdXQgIT09IDAgJiYge1xuICAgICAgdGVzdFRpbWVvdXQsXG4gICAgfSksXG4gICAgcHJvamVjdHM6IHByb2plY3RzLm1hcChcbiAgICAgICh7IGNvdmVyYWdlRGlyZWN0b3J5LCB0ZXN0VGltZW91dCwgLi4ucHJvamVjdCB9KSA9PiBwcm9qZWN0XG4gICAgKSxcbiAgfTtcbn1cbiJdLCJuYW1lcyI6WyJwYXRoIiwicmVzdWx0Iiwic2NyaXB0IiwidGVzdFRpbWVvdXQiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7QUFDTyxTQUFTLGFBQWEsR0FBcUIsRUFBQTtBQUNoRCxFQUFPLE9BQUEsR0FBQSxDQUFJLE9BQVEsQ0FBQSxxQkFBQSxFQUF1QixNQUFNLENBQUEsQ0FBQTtBQUNsRDs7QUNITyxTQUFTLFNBQ2QsS0FDeUIsRUFBQTtBQUN6QixFQUFBLE9BQU8sUUFBUSxLQUFLLENBQUEsQ0FBQTtBQUN0Qjs7QUNKTyxTQUFTLEtBQVEsRUFBc0IsRUFBQTtBQUM1QyxFQUFJLElBQUEsS0FBQSxDQUFBO0FBQ0osRUFBQSxJQUFJLFVBQWEsR0FBQSxLQUFBLENBQUE7QUFDakIsRUFBQSxPQUFPLE1BQVM7QUFDZCxJQUFBLElBQUksVUFBWSxFQUFBO0FBQ2QsTUFBTyxPQUFBLEtBQUEsQ0FBQTtBQUFBLEtBQ1Q7QUFDQSxJQUFBLEtBQUEsR0FBUSxFQUFHLEVBQUEsQ0FBQTtBQUNYLElBQWEsVUFBQSxHQUFBLElBQUEsQ0FBQTtBQUNiLElBQU8sT0FBQSxLQUFBLENBQUE7QUFBQSxHQUNULENBQUE7QUFDRjs7QUNYTyxTQUFTLFVBQWEsRUFBNEMsRUFBQTtBQUN2RSxFQUFJLElBQUEsS0FBQSxDQUFBO0FBQ0osRUFBSSxJQUFBLFFBQUEsQ0FBQTtBQUNKLEVBQUEsSUFBSSxV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
