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
const jestTransformConfigProp = () => {
  const esbuild = fileURLToPath(
    new URL("./esbuildJestTransform.gen.mjs", import.meta.url)
  );
  return {
    transform: {
      [`^.+\\.${extensions.join("|")}$`]: esbuild
    }
  };
};
const commonDefaults = {
  cacheDirectory: "node_modules/.jest-cache",
  testPathIgnorePatterns: [
    ...ignoreDirs.map((dir) => `<rootDir>${dir}`),
    "<rootDir>/.*/test-cases/"
  ],
  transformIgnorePatterns: [
    ...ignoreDirs,
    ...ignoreDirs.map((dir) => `<rootDir>${dir}`)
  ],
  coveragePathIgnorePatterns: [
    ...ignoreDirs,
    ...ignoreDirs.map((dir) => `<rootDir>${dir}`)
  ],
  modulePathIgnorePatterns: [
    ...ignoreDirs,
    ...ignoreDirs.map((dir) => `<rootDir>${dir}`)
  ],
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

async function createConfig(flavor, rootDir, parentRootDir) {
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
    ...jestTransformConfigProp(),
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
