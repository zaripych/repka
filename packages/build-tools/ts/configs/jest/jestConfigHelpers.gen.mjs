// This file is bundled up from './src/*' and needs to be committed
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { defaults, readInitialOptions } from 'jest-config';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import fg from 'fast-glob';
import { load } from 'js-yaml';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

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

async function runTsScript(opts) {
  const started = performance.now();
  try {
    const location = opts.importMetaUrl ? fileURLToPath(new URL(opts.location, opts.importMetaUrl)) : opts.location;
    if (logger.logLevel !== "debug") {
      logger.log(`Running "${location}"`);
    }
    return await spawnOutputConditional(
      "tsx",
      [location, ...opts.args || []],
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

const getModuleRootDirectoryForImportMetaUrl = (opts) => {
  const __fileName = fileURLToPath(new URL(opts.importMetaUrl));
  const parent = dirname(__fileName);
  const superParent = dirname(parent);
  const isBundledInDist = () => parent.endsWith("/dist");
  const isBundledInBin = () => parent.endsWith("/bin") && !superParent.endsWith("/src");
  if (isBundledInDist() || isBundledInBin()) {
    return fileURLToPath(new URL(`../`, opts.importMetaUrl));
  }
  return fileURLToPath(new URL(`../../`, opts.importMetaUrl));
};
const moduleRootDirectory = once(
  () => getModuleRootDirectoryForImportMetaUrl({ importMetaUrl: import.meta.url })
);

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
  const result = /(.*(?=\/packages\/))|(.*(?=\/node_modules\/))|(.*)/.exec(
    currentDirectory
  );
  assert(!!result);
  const [, packagesRoot, nodeModulesRoot] = result;
  return [packagesRoot, nodeModulesRoot].filter(isTruthy);
};
const hasRootMarkers = async (candidates) => {
  const markers = [
    ".git",
    "yarn.lock",
    "pnpm-lock.yaml",
    "package-lock.json",
    "pnpm-workspace.yaml"
  ];
  const markersStream = fg.stream(
    candidates.flatMap((dir) => markers.map((marker) => join(dir, marker))),
    {
      markDirectories: true,
      onlyFiles: false
    }
  );
  for await (const entry of markersStream) {
    assert(typeof entry === "string");
    return dirname(entry);
  }
  return void 0;
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
    const result = dirname(path);
    if (result === path) {
      return;
    }
    return result;
  };
  const parent = uniqueDirname(lookupDirectory);
  const superParent = uniqueDirname(parent);
  return await prioritizedHasMarkers(
    // scan in most likely locations first with current lookup directory taking priority
    [
      [lookupDirectory],
      getRepositoryRootScanCandidates(lookupDirectory),
      // scan 2 directories upwards
      [parent],
      [superParent]
    ].map((dirs) => dirs.filter(isTruthy)).filter((job) => job.length > 0)
  ) || lookupDirectory;
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
      `<rootDir>/(?!__tests__)__${flavorRegex.source}__/`,
      `<rootDir>/src/(?!__tests__)__${flavorRegex.source}__/`
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
  for await (const script2 of stream) {
    if (script2) {
      const hash = createHash("sha1").update(rootDir).update(flavor).update(script2).digest().toString("hex");
      const dir = join(tmpdir(), "jest-scripts");
      const file = join(dir, `${hash}.mjs`);
      await mkdir(dir, { recursive: true });
      const root = moduleRootDirectory();
      await writeFile(
        file,
        `import { runTsScript } from '${join(
          root,
          "configs/jest/jestConfigHelpers.gen.mjs"
        )}';

export default async () => {
  await runTsScript({
    location: '${resolve(join(rootDir, script2))}'
  })
}`
      );
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL2lzVHJ1dGh5LnRzIiwiLi4vLi4vLi4vLi4vdXRpbHMvdHMvc3JjL29uY2UudHMiLCIuLi8uLi8uLi8uLi91dGlscy90cy9zcmMvb25jZUFzeW5jLnRzIiwiLi4vLi4vc3JjL2xvZ2dlci9sb2dnZXIudHMiLCIuLi8uLi9zcmMvdXRpbHMvc3RhY2tUcmFjZS50cyIsIi4uLy4uL3NyYy9jaGlsZC1wcm9jZXNzL3NwYXduVG9Qcm9taXNlLnRzIiwiLi4vLi4vc3JjL2NoaWxkLXByb2Nlc3Mvc3Bhd25SZXN1bHQudHMiLCIuLi8uLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3bk91dHB1dC50cyIsIi4uLy4uL3NyYy9ydW5Uc1NjcmlwdC50cyIsIi4uLy4uL3NyYy91dGlscy9tb2R1bGVSb290RGlyZWN0b3J5LnRzIiwiLi4vLi4vc3JjL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24udHMiLCIuLi8uLi9zcmMvdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoLnRzIiwiLi4vLi4vc3JjL3R1cmJvLnRzIiwiLi4vLi4vc3JjL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbi50cyIsIi4uLy4uL3NyYy9qZXN0L2NvbmZpZ0J1aWxkaW5nQmxvY2tzLnRzIiwiLi4vLi4vc3JjL2plc3QvZ2VuZXJhdGVTY3JpcHQudHMiLCIuLi8uLi9zcmMvdXRpbHMvaXNEaXJlY3RvcnkudHMiLCIuLi8uLi9zcmMvdXRpbHMvdXB3YXJkRGlyZWN0b3J5U2VhcmNoLnRzIiwiLi4vLi4vc3JjL3V0aWxzL2ZpbmREZXZEZXBlbmRlbmN5LnRzIiwiLi4vLi4vc3JjL2plc3QvamVzdFBsdWdpblJvb3QudHMiLCIuLi8uLi9zcmMvamVzdC9jcmVhdGVKZXN0Q29uZmlnLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBpc1RydXRoeTxUPihcbiAgdmFsdWU6IE5vbk51bGxhYmxlPFQ+IHwgZmFsc2UgfCBudWxsIHwgdW5kZWZpbmVkIHwgJycgfCAwXG4pOiB2YWx1ZSBpcyBOb25OdWxsYWJsZTxUPiB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlKTtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBvbmNlPFQ+KGZuOiAoKSA9PiBUKTogKCkgPT4gVCB7XG4gIGxldCB2YWx1ZTogVDtcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcbiAgcmV0dXJuICgpOiBUID0+IHtcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICB2YWx1ZSA9IGZuKCk7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIG9uY2VBc3luYzxUPihmbjogKCkgPT4gVCB8IFByb21pc2U8VD4pOiAoKSA9PiBQcm9taXNlPFQ+IHtcbiAgbGV0IHZhbHVlOiBUO1xuICBsZXQgaW5GbGlnaHQ6IFByb21pc2U8VD4gfCBudWxsO1xuICBsZXQgY2FsY3VsYXRlZCA9IGZhbHNlO1xuICByZXR1cm4gYXN5bmMgKCk6IFByb21pc2U8VD4gPT4ge1xuICAgIGlmIChjYWxjdWxhdGVkKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGlmIChpbkZsaWdodCkge1xuICAgICAgcmV0dXJuIGluRmxpZ2h0O1xuICAgIH1cbiAgICBpbkZsaWdodCA9IFByb21pc2UucmVzb2x2ZShmbigpKTtcbiAgICB2YWx1ZSA9IGF3YWl0IGluRmxpZ2h0O1xuICAgIGNhbGN1bGF0ZWQgPSB0cnVlO1xuICAgIGluRmxpZ2h0ID0gbnVsbDtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG59XG4iLCJpbXBvcnQgeyBvbmNlIH0gZnJvbSAnQHV0aWxzL3RzJztcblxuY29uc3QgbGV2ZWxzID0gWydkZWJ1ZycsICdpbmZvJywgJ3dhcm4nLCAnZXJyb3InLCAnZmF0YWwnXSBhcyBjb25zdDtcblxudHlwZSBMb2dMZXZlbCA9IHR5cGVvZiBsZXZlbHNbbnVtYmVyXTtcblxudHlwZSBQYXJhbXMgPSBQYXJhbWV0ZXJzPHR5cGVvZiBjb25zb2xlLmxvZz47XG5cbnR5cGUgTG9nZ2VyID0ge1xuICBsb2dMZXZlbDogTG9nTGV2ZWw7XG4gIGRlYnVnKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgaW5mbyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIC8vIGFsaWFzIGZvciBpbmZvXG4gIGxvZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIC8vIHNwZWNpYWwgdHJlYXRtZW50LCBkaXNhYmxlZCBvbiBDSS9UVFlcbiAgdGlwKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgd2FybiguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQ7XG4gIGVycm9yKC4uLnBhcmFtczogUGFyYW1zKTogdm9pZDtcbiAgZmF0YWwoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkO1xufTtcblxuY29uc3QgZW5hYmxlZExldmVsc0FmdGVyID0gKGxldmVsOiBMb2dMZXZlbCB8ICdvZmYnKSA9PiB7XG4gIGlmIChsZXZlbCA9PT0gJ29mZicpIHtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgY29uc3QgaW5kZXggPSBsZXZlbHMuZmluZEluZGV4KChpdGVtKSA9PiBpdGVtID09PSBsZXZlbCk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbGV2ZWwnKTtcbiAgfVxuICByZXR1cm4gbGV2ZWxzLnNsaWNlKGluZGV4KTtcbn07XG5cbmNvbnN0IGlzTGV2ZWwgPSAobGV2ZWw/OiBzdHJpbmcpOiBsZXZlbCBpcyBMb2dMZXZlbCA9PiB7XG4gIHJldHVybiBsZXZlbHMuaW5jbHVkZXMobGV2ZWwgYXMgTG9nTGV2ZWwpO1xufTtcblxuY29uc3QgdmVyYm9zaXR5RnJvbVByb2Nlc3NBcmdzID0gKFxuICBhcmdzID0gcHJvY2Vzcy5hcmd2XG4pOiBMb2dMZXZlbCB8ICdvZmYnIHwgdW5kZWZpbmVkID0+IHtcbiAgY29uc3QgaW5kZXggPSBhcmdzLmZpbmRJbmRleCgodmFsdWUpID0+IHZhbHVlID09PSAnLS1sb2ctbGV2ZWwnKTtcbiAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgY29uc3QgbGV2ZWwgPSBhcmdzW2luZGV4ICsgMV07XG4gIGlmIChsZXZlbCA9PT0gJ3NpbGVudCcgfHwgbGV2ZWwgPT09ICdvZmYnKSB7XG4gICAgcmV0dXJuICdvZmYnO1xuICB9XG4gIGlmICghaXNMZXZlbChsZXZlbCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBsZXZlbDtcbn07XG5cbmNvbnN0IHZlcmJvc2l0eUZyb21FbnYgPSAoKTogTG9nTGV2ZWwgfCAnb2ZmJyB8IHVuZGVmaW5lZCA9PiB7XG4gIGNvbnN0IGxldmVsID0gcHJvY2Vzcy5lbnZbJ0xPR19MRVZFTCddO1xuICBpZiAobGV2ZWwgPT09ICdzaWxlbnQnIHx8IGxldmVsID09PSAnb2ZmJykge1xuICAgIHJldHVybiAnb2ZmJztcbiAgfVxuICBpZiAoIWlzTGV2ZWwobGV2ZWwpKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5jb25zdCBnZXRWZXJib3NpdHlDb25maWcgPSAoKSA9PiB7XG4gIGNvbnN0IGFyZ3NMZXZlbCA9IHZlcmJvc2l0eUZyb21Qcm9jZXNzQXJncygpO1xuICBjb25zdCBlbnZMZXZlbCA9IHZlcmJvc2l0eUZyb21FbnYoKTtcbiAgcmV0dXJuIGFyZ3NMZXZlbCA/PyBlbnZMZXZlbCA/PyAnaW5mbyc7XG59O1xuXG5jb25zdCBub29wID0gKC4uLl9hcmdzOiBQYXJhbXMpID0+IHtcbiAgcmV0dXJuO1xufTtcblxuY29uc3QgbG9nID0gKC4uLmFyZ3M6IFBhcmFtcykgPT4ge1xuICBjb25zb2xlLmxvZyguLi5hcmdzKTtcbn07XG5cbmNvbnN0IGVycm9yID0gKC4uLmFyZ3M6IFBhcmFtcykgPT4ge1xuICBjb25zb2xlLmVycm9yKC4uLmFyZ3MpO1xufTtcblxuY29uc3Qgc2hvdWxkRW5hYmxlVGlwID0gKCkgPT4gIXByb2Nlc3MuZW52WydDSSddICYmICFwcm9jZXNzLnN0ZG91dC5pc1RUWTtcblxuZXhwb3J0IGNvbnN0IGNyZWF0ZUxvZ2dlciA9IChcbiAgZGVwcyA9IHsgZ2V0VmVyYm9zaXR5Q29uZmlnLCBsb2csIGVycm9yLCBzaG91bGRFbmFibGVUaXAgfVxuKSA9PiB7XG4gIGNvbnN0IGxvZ0xldmVsID0gZGVwcy5nZXRWZXJib3NpdHlDb25maWcoKTtcbiAgY29uc3QgZW5hYmxlZCA9IGVuYWJsZWRMZXZlbHNBZnRlcihsb2dMZXZlbCk7XG4gIHJldHVybiBsZXZlbHMucmVkdWNlKFxuICAgIChhY2MsIGx2bCkgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uYWNjLFxuICAgICAgICBbbHZsXTogZW5hYmxlZC5pbmNsdWRlcyhsdmwpXG4gICAgICAgICAgPyBbJ2ZhdGFsJywgJ2Vycm9yJ10uaW5jbHVkZXMobHZsKVxuICAgICAgICAgICAgPyBkZXBzLmVycm9yXG4gICAgICAgICAgICA6IGRlcHMubG9nXG4gICAgICAgICAgOiBub29wLFxuICAgICAgfTtcbiAgICB9LFxuICAgIHtcbiAgICAgIGxvZ0xldmVsLFxuICAgICAgbG9nOiBlbmFibGVkLmluY2x1ZGVzKCdpbmZvJykgPyBkZXBzLmxvZyA6IG5vb3AsXG4gICAgICB0aXA6IGVuYWJsZWQuaW5jbHVkZXMoJ2luZm8nKSAmJiBkZXBzLnNob3VsZEVuYWJsZVRpcCgpID8gZGVwcy5sb2cgOiBub29wLFxuICAgIH0gYXMgTG9nZ2VyXG4gICk7XG59O1xuXG5jb25zdCBjcmVhdGVEZWxlZ2F0aW5nTG9nZ2VyID0gKG9wdHM6IHsgcGFyZW50OiBMb2dnZXIgfSk6IExvZ2dlciA9PlxuICBPYmplY3QuZnJlZXplKHtcbiAgICBnZXQgbG9nTGV2ZWwoKSB7XG4gICAgICByZXR1cm4gb3B0cy5wYXJlbnQubG9nTGV2ZWw7XG4gICAgfSxcbiAgICBkZWJ1ZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuZGVidWcoLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGluZm8oLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmluZm8oLi4ucGFyYW1zKTtcbiAgICB9LFxuICAgIGxvZyguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQubG9nKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICB0aXAoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LnRpcCguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgd2FybiguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQud2FybiguLi5wYXJhbXMpO1xuICAgIH0sXG4gICAgZXJyb3IoLi4ucGFyYW1zOiBQYXJhbXMpOiB2b2lkIHtcbiAgICAgIG9wdHMucGFyZW50LmVycm9yKC4uLnBhcmFtcyk7XG4gICAgfSxcbiAgICBmYXRhbCguLi5wYXJhbXM6IFBhcmFtcyk6IHZvaWQge1xuICAgICAgb3B0cy5wYXJlbnQuZmF0YWwoLi4ucGFyYW1zKTtcbiAgICB9LFxuICB9KTtcblxubGV0IGRlZmF1bHRMb2dnZXJGYWN0b3J5OiAoKCkgPT4gTG9nZ2VyKSB8IG51bGw7XG5cbmV4cG9ydCBjb25zdCBjb25maWd1cmVEZWZhdWx0TG9nZ2VyID0gKGZhY3Rvcnk6ICgpID0+IExvZ2dlcikgPT4ge1xuICBpZiAoZGVmYXVsdExvZ2dlckZhY3RvcnkpIHtcbiAgICBjb25zdCBlcnJvciA9IHtcbiAgICAgIHN0YWNrOiAnJyxcbiAgICB9O1xuICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKGVycm9yKTtcbiAgICBsb2dnZXIuZGVidWcoJ0Nhbm5vdCBvdmVycmlkZSBkZWZhdWx0IGxvZ2dlciBtdWx0aXBsZSB0aW1lcycsIGVycm9yLnN0YWNrKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZGVmYXVsdExvZ2dlckZhY3RvcnkgPSBmYWN0b3J5O1xufTtcblxuY29uc3QgZGVmYXVsdExvZ2dlciA9IG9uY2UoKCkgPT4ge1xuICBsZXQgZmFjdG9yeSA9IGRlZmF1bHRMb2dnZXJGYWN0b3J5O1xuICBpZiAoIWZhY3RvcnkpIHtcbiAgICBmYWN0b3J5ID0gKCkgPT4gY3JlYXRlTG9nZ2VyKCk7XG4gIH1cbiAgcmV0dXJuIGZhY3RvcnkoKTtcbn0pO1xuXG4vKipcbiAqIERlZmF1bHQgbG9nZ2VyIGluc3RhbmNlIGNhbiBiZSBjb25maWd1cmVkIG9uY2UgYXQgc3RhcnR1cFxuICovXG5leHBvcnQgY29uc3QgbG9nZ2VyOiBMb2dnZXIgPSBjcmVhdGVEZWxlZ2F0aW5nTG9nZ2VyKHtcbiAgZ2V0IHBhcmVudCgpIHtcbiAgICByZXR1cm4gZGVmYXVsdExvZ2dlcigpO1xuICB9LFxufSk7XG4iLCIvKipcbiAqIENhcHR1cmUgdGhlIHN0YWNrIHRyYWNlIGFuZCBhbGxvdyB0byBlbnJpY2ggZXhjZXB0aW9ucyB0aHJvd24gaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrc1xuICogd2l0aCBhZGRpdGlvbmFsIHN0YWNrIGluZm9ybWF0aW9uIGNhcHR1cmVkIGF0IHRoZSBtb21lbnQgb2YgdGhlIGNhbGwgb2YgdGhpcyBmdW5jdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZVN0YWNrVHJhY2UocmVtb3ZlID0gMCkge1xuICBjb25zdCBzdGFja0NvbnRhaW5lciA9IHtcbiAgICBzdGFjazogJycsXG4gIH07XG4gIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHN0YWNrQ29udGFpbmVyKTtcbiAgY29uc3Qgc3RhY2tUcmFjZSA9IHN0YWNrQ29udGFpbmVyLnN0YWNrXG4gICAgLnNwbGl0KCdcXG4nKVxuICAgIC5zbGljZSg2ICsgcmVtb3ZlKVxuICAgIC5qb2luKCdcXG4nKTtcbiAgcmV0dXJuIHtcbiAgICAvKipcbiAgICAgKiBDYXB0dXJlZCBzdGFjayB0cmFjZSBpbmZvcm1hdGlvblxuICAgICAqL1xuICAgIHN0YWNrVHJhY2UsXG4gICAgLyoqXG4gICAgICogQ2FuIGJlIGNhbGxlZCBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2sgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgd2l0aCBhZGRpdGlvbmFsIGluZm9ybWF0aW9uXG4gICAgICogQHBhcmFtIGVyciBFeGNlcHRpb24gdG8gZW5yaWNoIC0gaXQgaXMgZ29pbmcgdG8gaGF2ZSBpdHMgYC5zdGFja2AgcHJvcCBtdXRhdGVkXG4gICAgICogQHJldHVybnMgU2FtZSBleGNlcHRpb25cbiAgICAgKi9cbiAgICBwcmVwYXJlRm9yUmV0aHJvdzogKGVycjogRXJyb3IpID0+IHtcbiAgICAgIGNvbnN0IG9sZFN0YWNrVHJhY2UgPSBlcnIuc3RhY2sgPz8gJycuc3BsaXQoJ1xcbicpLnNsaWNlKDEpLmpvaW4oJ1xcbicpO1xuICAgICAgZXJyLnN0YWNrID0gYCR7ZXJyLm5hbWUgfHwgJ0Vycm9yJ306ICR7XG4gICAgICAgIGVyci5tZXNzYWdlXG4gICAgICB9XFxuJHtvbGRTdGFja1RyYWNlfVxcbiR7c3RhY2tUcmFjZX1gO1xuICAgICAgcmV0dXJuIGVycjtcbiAgICB9LFxuICB9O1xufVxuIiwiaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IENoaWxkUHJvY2VzcyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB0eXBlIHsgQXNzaWduIH0gZnJvbSAndXRpbGl0eS10eXBlcyc7XG5cbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgY2FwdHVyZVN0YWNrVHJhY2UgfSBmcm9tICcuLi91dGlscy9zdGFja1RyYWNlJztcblxuZXhwb3J0IHR5cGUgU3Bhd25Ub1Byb21pc2VPcHRzID0ge1xuICAvKipcbiAgICogU3BlY2lmeSBleGl0IGNvZGVzIHdoaWNoIHNob3VsZCBub3QgcmVzdWx0IGluIHRocm93aW5nIGFuIGVycm9yIHdoZW5cbiAgICogdGhlIHByb2Nlc3MgaGFzIGZpbmlzaGVkLCBlLmcuIHNwZWNpZnlpbmcgYFswXWAgbWVhbnMgaWYgcHJvY2VzcyBmaW5pc2hlZFxuICAgKiB3aXRoIHplcm8gZXhpdCBjb2RlIHRoZW4gdGhlIHByb21pc2Ugd2lsbCByZXNvbHZlIGluc3RlYWQgb2YgcmVqZWN0aW5nLlxuICAgKlxuICAgKiBBbHRlcm5hdGl2ZWx5LCBzcGVjaWZ5IGBpbmhlcml0YCB0byBzYXZlIHN0YXR1cyBjb2RlIHRvIHRoZSBjdXJyZW50IGBwcm9jZXNzLmV4aXRDb2RlYFxuICAgKlxuICAgKiBBbHRlcm5hdGl2ZWx5LCBjb21wbGV0ZWx5IGlnbm9yZSB0aGUgZXhpdCBjb2RlIChlLmcuIHlvdSBmb2xsb3cgdXAgYW5kIGludGVycm9nYXRlXG4gICAqIHRoZSBwcm9jZXNzIGNvZGUgbWFudWFsbHkgYWZ0ZXJ3YXJkcylcbiAgICovXG4gIGV4aXRDb2RlczogbnVtYmVyW10gfCAnaW5oZXJpdCcgfCAnYW55Jztcbn07XG5cbnR5cGUgU2hhcmVkT3B0cyA9IFBpY2s8U3Bhd25PcHRpb25zLCAnY3dkJz47XG5cbnR5cGUgU3Bhd25BcmdzPEUgZXh0ZW5kcyBvYmplY3Q+ID0gW1xuICBjb21tYW5kOiBzdHJpbmcsXG4gIGFyZ3M6IFJlYWRvbmx5QXJyYXk8c3RyaW5nPixcbiAgb3B0aW9uczogQXNzaWduPFNwYXduT3B0aW9ucywgRT5cbl07XG5cbmV4cG9ydCB0eXBlIFNwYXduT3B0aW9uc1dpdGhFeHRyYTxFIGV4dGVuZHMgb2JqZWN0ID0gU3Bhd25Ub1Byb21pc2VPcHRzPiA9XG4gIEFzc2lnbjxTcGF3bk9wdGlvbnMsIEU+O1xuXG5leHBvcnQgdHlwZSBTcGF3blBhcmFtZXRlck1peDxFIGV4dGVuZHMgb2JqZWN0ID0gU3Bhd25Ub1Byb21pc2VPcHRzPiA9XG4gIHwgW2NwOiBDaGlsZFByb2Nlc3MsIGV4dHJhT3B0czogQXNzaWduPEUsIFNoYXJlZE9wdHM+XVxuICB8IFNwYXduQXJnczxFPjtcblxuZXhwb3J0IGZ1bmN0aW9uIGlzU3Bhd25BcmdzPEUgZXh0ZW5kcyBvYmplY3Q+KFxuICBhcmdzOiBTcGF3blBhcmFtZXRlck1peDxFPlxuKTogYXJncyBpcyBTcGF3bkFyZ3M8RT4ge1xuICByZXR1cm4gIShhcmdzWzBdIGluc3RhbmNlb2YgQ2hpbGRQcm9jZXNzKSAmJiB0eXBlb2YgYXJnc1swXSA9PT0gJ3N0cmluZyc7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnM8RSBleHRlbmRzIG9iamVjdD4oXG4gIHBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4PEU+XG4pIHtcbiAgY29uc3QgW2NoaWxkLCBbY29tbWFuZCwgYXJncywgb3B0c11dID0gaXNTcGF3bkFyZ3MocGFyYW1ldGVycylcbiAgICA/IFtcbiAgICAgICAgc3Bhd24oLi4uKHBhcmFtZXRlcnMgYXMgdW5rbm93biBhcyBQYXJhbWV0ZXJzPHR5cGVvZiBzcGF3bj4pKSxcbiAgICAgICAgcGFyYW1ldGVycyxcbiAgICAgIF1cbiAgICA6IFtcbiAgICAgICAgcGFyYW1ldGVyc1swXSxcbiAgICAgICAgW1xuICAgICAgICAgIHBhcmFtZXRlcnNbMF0uc3Bhd25maWxlLFxuICAgICAgICAgIHBhcmFtZXRlcnNbMF0uc3Bhd25hcmdzLnNsaWNlKDEpLFxuICAgICAgICAgIHBhcmFtZXRlcnNbMV0gYXMgQXNzaWduPFNwYXduT3B0aW9ucywgRT4sXG4gICAgICAgIF0sXG4gICAgICBdO1xuICByZXR1cm4ge1xuICAgIGNoaWxkLFxuICAgIGNvbW1hbmQsXG4gICAgYXJncyxcbiAgICBvcHRzLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3Bhd25Ub1Byb21pc2UoXG4gIC4uLnBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4XG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgeyBjaGlsZCwgY29tbWFuZCwgYXJncywgb3B0cyB9ID0gc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICBjb25zdCB7IHByZXBhcmVGb3JSZXRocm93IH0gPSBjYXB0dXJlU3RhY2tUcmFjZSgpO1xuXG4gIGNvbnN0IGV4aXRDb2RlcyA9IG9wdHMuZXhpdENvZGVzO1xuXG4gIGNvbnN0IGN3ZCA9IG9wdHMuY3dkID8gb3B0cy5jd2QudG9TdHJpbmcoKSA6IHVuZGVmaW5lZDtcblxuICBjb25zdCBjbWQgPSAoKSA9PiBbY29tbWFuZCwgLi4uYXJnc10uam9pbignICcpO1xuXG4gIGxvZ2dlci5kZWJ1ZyhbJz4nLCBjbWQoKV0uam9pbignICcpLCAuLi4oY3dkID8gW2BpbiAke2N3ZH1gXSA6IFtdKSk7XG5cbiAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlcywgcmVqKSA9PlxuICAgIGNoaWxkXG4gICAgICAub24oJ2Nsb3NlJywgKGNvZGUsIHNpZ25hbCkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIGNvZGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgZXhpdENvZGVzICE9PSAnaW5oZXJpdCcgJiZcbiAgICAgICAgICAgIGV4aXRDb2RlcyAhPT0gJ2FueScgJiZcbiAgICAgICAgICAgICFleGl0Q29kZXMuaW5jbHVkZXMoY29kZSlcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHJlaihcbiAgICAgICAgICAgICAgcHJlcGFyZUZvclJldGhyb3coXG4gICAgICAgICAgICAgICAgbmV3IEVycm9yKGBDb21tYW5kIFwiJHtjbWQoKX1cIiBoYXMgZmFpbGVkIHdpdGggY29kZSAke2NvZGV9YClcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHNpZ25hbCkge1xuICAgICAgICAgIHJlaihcbiAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICBuZXcgRXJyb3IoYEZhaWxlZCB0byBleGVjdXRlIGNvbW1hbmQgXCIke2NtZCgpfVwiIC0gJHtzaWduYWx9YClcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IHByZXBhcmVGb3JSZXRocm93KG5ldyBFcnJvcignRXhwZWN0ZWQgc2lnbmFsIG9yIGVycm9yIGNvZGUnKSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAub24oJ2Vycm9yJywgcmVqKVxuICApO1xuICAvLyBpbmhlcml0IGV4aXQgY29kZVxuICBpZiAoZXhpdENvZGVzID09PSAnaW5oZXJpdCcpIHtcbiAgICBpZiAoXG4gICAgICB0eXBlb2YgY2hpbGQuZXhpdENvZGUgPT09ICdudW1iZXInICYmXG4gICAgICAodHlwZW9mIHByb2Nlc3MuZXhpdENvZGUgIT09ICdudW1iZXInIHx8IHByb2Nlc3MuZXhpdENvZGUgPT09IDApXG4gICAgKSB7XG4gICAgICBwcm9jZXNzLmV4aXRDb2RlID0gY2hpbGQuZXhpdENvZGU7XG4gICAgfVxuICB9XG59XG4iLCJpbXBvcnQgYXNzZXJ0IGZyb20gJ2Fzc2VydCc7XG5cbmltcG9ydCB0eXBlIHsgU3Bhd25QYXJhbWV0ZXJNaXgsIFNwYXduVG9Qcm9taXNlT3B0cyB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuaW1wb3J0IHsgc3Bhd25XaXRoU3Bhd25QYXJhbWV0ZXJzIH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5pbXBvcnQgeyBzcGF3blRvUHJvbWlzZSB9IGZyb20gJy4vc3Bhd25Ub1Byb21pc2UnO1xuXG5leHBvcnQgdHlwZSBTcGF3blJlc3VsdE9wdHMgPSB7XG4gIG91dHB1dD86XG4gICAgfCBBcnJheTwnc3Rkb3V0JyB8ICdzdGRlcnInPlxuICAgIHwgWydzdGRvdXQnIHwgJ3N0ZGVycicsIC4uLkFycmF5PCdzdGRvdXQnIHwgJ3N0ZGVycic+XTtcbiAgYnVmZmVycz86IHtcbiAgICBjb21iaW5lZD86IHN0cmluZ1tdO1xuICAgIHN0ZG91dD86IHN0cmluZ1tdO1xuICAgIHN0ZGVycj86IHN0cmluZ1tdO1xuICB9O1xufSAmIFNwYXduVG9Qcm9taXNlT3B0cztcblxuZXhwb3J0IHR5cGUgU3Bhd25SZXN1bHRSZXR1cm4gPSB7XG4gIHBpZD86IG51bWJlcjtcbiAgb3V0cHV0OiBzdHJpbmdbXTtcbiAgc3Rkb3V0OiBzdHJpbmc7XG4gIHN0ZGVycjogc3RyaW5nO1xuICBzdGF0dXM6IG51bWJlciB8IG51bGw7XG4gIHNpZ25hbDogTm9kZUpTLlNpZ25hbHMgfCBudWxsO1xuICBlcnJvcj86IEVycm9yIHwgdW5kZWZpbmVkO1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduUmVzdWx0KFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxTcGF3blJlc3VsdE9wdHM+XG4pOiBQcm9taXNlPFNwYXduUmVzdWx0UmV0dXJuPiB7XG4gIGNvbnN0IHsgY2hpbGQsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgY29tYmluZWREYXRhOiBzdHJpbmdbXSA9IG9wdHMuYnVmZmVycz8uY29tYmluZWQgPz8gW107XG4gIGNvbnN0IHN0ZG91dERhdGE6IHN0cmluZ1tdID0gb3B0cy5idWZmZXJzPy5zdGRvdXQgPz8gW107XG4gIGNvbnN0IHN0ZGVyckRhdGE6IHN0cmluZ1tdID0gb3B0cy5idWZmZXJzPy5zdGRlcnIgPz8gW107XG4gIGNvbnN0IG91dHB1dCA9IG9wdHMub3V0cHV0ID8/IFsnc3Rkb3V0JywgJ3N0ZGVyciddO1xuICBpZiAob3V0cHV0LmluY2x1ZGVzKCdzdGRvdXQnKSkge1xuICAgIGFzc2VydChcbiAgICAgICEhY2hpbGQuc3Rkb3V0LFxuICAgICAgJ0V4cGVjdGVkIFwiLnN0ZG91dFwiIHRvIGJlIGRlZmluZWQsIHdoaWNoIHdpbGwgb25seSBiZSBkZWZpbmVkIGlmIGNoaWxkIHByb2Nlc3MgaXMgc3Bhd25lZCB3aXRoIGNvcnJlY3QgcGFyYW1ldGVycydcbiAgICApO1xuICAgIGNoaWxkLnN0ZG91dC5zZXRFbmNvZGluZygndXRmLTgnKTtcbiAgICBjaGlsZC5zdGRvdXQub24oJ2RhdGEnLCAoZGF0YTogc3RyaW5nKSA9PiB7XG4gICAgICBjb21iaW5lZERhdGEucHVzaChkYXRhKTtcbiAgICAgIHN0ZG91dERhdGEucHVzaChkYXRhKTtcbiAgICB9KTtcbiAgfVxuICBpZiAob3V0cHV0LmluY2x1ZGVzKCdzdGRlcnInKSkge1xuICAgIGFzc2VydChcbiAgICAgICEhY2hpbGQuc3RkZXJyLFxuICAgICAgJ0V4cGVjdGVkIFwiLnN0ZGVyclwiIHRvIGJlIGRlZmluZWQsIHdoaWNoIHdpbGwgb25seSBiZSBkZWZpbmVkIGlmIGNoaWxkIHByb2Nlc3MgaXMgc3Bhd25lZCB3aXRoIGNvcnJlY3QgcGFyYW1ldGVycydcbiAgICApO1xuICAgIGNoaWxkLnN0ZGVyci5zZXRFbmNvZGluZygndXRmLTgnKTtcbiAgICBjaGlsZC5zdGRlcnIub24oJ2RhdGEnLCAoZGF0YTogc3RyaW5nKSA9PiB7XG4gICAgICBjb21iaW5lZERhdGEucHVzaChkYXRhKTtcbiAgICAgIHN0ZGVyckRhdGEucHVzaChkYXRhKTtcbiAgICB9KTtcbiAgfVxuICBjb25zdCBbcmVzdWx0XSA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbc3Bhd25Ub1Byb21pc2UoY2hpbGQsIG9wdHMpXSk7XG4gIHJldHVybiB7XG4gICAgcGlkOiBjaGlsZC5waWQsXG4gICAgc2lnbmFsOiBjaGlsZC5zaWduYWxDb2RlLFxuICAgIHN0YXR1czogY2hpbGQuZXhpdENvZGUsXG4gICAgZ2V0IG91dHB1dCgpIHtcbiAgICAgIHJldHVybiBjb21iaW5lZERhdGE7XG4gICAgfSxcbiAgICBnZXQgc3RkZXJyKCkge1xuICAgICAgcmV0dXJuIHN0ZGVyckRhdGEuam9pbignJyk7XG4gICAgfSxcbiAgICBnZXQgc3Rkb3V0KCkge1xuICAgICAgcmV0dXJuIHN0ZG91dERhdGEuam9pbignJyk7XG4gICAgfSxcbiAgICBnZXQgZXJyb3IoKSB7XG4gICAgICByZXR1cm4gcmVzdWx0LnN0YXR1cyA9PT0gJ3JlamVjdGVkJ1xuICAgICAgICA/IChyZXN1bHQucmVhc29uIGFzIEVycm9yKVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICB9LFxuICB9O1xufVxuIiwiaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgdHlwZSB7IFNwYXduUmVzdWx0T3B0cywgU3Bhd25SZXN1bHRSZXR1cm4gfSBmcm9tICcuL3NwYXduUmVzdWx0JztcbmltcG9ydCB7IHNwYXduUmVzdWx0IH0gZnJvbSAnLi9zcGF3blJlc3VsdCc7XG5pbXBvcnQgdHlwZSB7IFNwYXduUGFyYW1ldGVyTWl4IH0gZnJvbSAnLi9zcGF3blRvUHJvbWlzZSc7XG5pbXBvcnQgeyBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMgfSBmcm9tICcuL3NwYXduVG9Qcm9taXNlJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduT3V0cHV0KFxuICAuLi5wYXJhbWV0ZXJzOiBTcGF3blBhcmFtZXRlck1peDxTcGF3blJlc3VsdE9wdHM+XG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCB7IGNoaWxkLCBvcHRzIH0gPSBzcGF3bldpdGhTcGF3blBhcmFtZXRlcnMocGFyYW1ldGVycyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduUmVzdWx0KGNoaWxkLCBvcHRzKTtcbiAgcmV0dXJuIHJlc3VsdC5vdXRwdXQuam9pbignJyk7XG59XG5cbmNvbnN0IGRlZmF1bHRTaG91bGRPdXRwdXQgPSAocmVzdWx0OiBTcGF3blJlc3VsdFJldHVybikgPT4ge1xuICByZXR1cm4gcmVzdWx0LmVycm9yIHx8IHJlc3VsdC5zdGF0dXMgIT09IDAgfHwgbG9nZ2VyLmxvZ0xldmVsID09PSAnZGVidWcnO1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduT3V0cHV0Q29uZGl0aW9uYWwoXG4gIC4uLnBhcmFtZXRlcnM6IFNwYXduUGFyYW1ldGVyTWl4PFxuICAgIFNwYXduUmVzdWx0T3B0cyAmIHtcbiAgICAgIC8qKlxuICAgICAgICogQnkgZGVmYXVsdCB3aWxsIG91dHB1dCB0byBgc3RkZXJyYCB3aGVuIHNwYXduIHJlc3VsdCBmYWlsZWQgd2l0aCBhbiBlcnJvciwgd2hlblxuICAgICAgICogc3RhdHVzIGNvZGUgaXMgbm90IHplcm8gb3Igd2hlbiBgTG9nZ2VyLmxvZ0xldmVsYCBpcyBgZGVidWdgXG4gICAgICAgKi9cbiAgICAgIHNob3VsZE91dHB1dD86IChyZXN1bHQ6IFNwYXduUmVzdWx0UmV0dXJuKSA9PiBib29sZWFuO1xuICAgIH1cbiAgPlxuKSB7XG4gIGNvbnN0IHsgY2hpbGQsIG9wdHMgfSA9IHNwYXduV2l0aFNwYXduUGFyYW1ldGVycyhwYXJhbWV0ZXJzKTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc3Bhd25SZXN1bHQoY2hpbGQsIG9wdHMpO1xuICBjb25zdCBzaG91bGRPdXRwdXQgPSBvcHRzLnNob3VsZE91dHB1dCA/PyBkZWZhdWx0U2hvdWxkT3V0cHV0O1xuICBpZiAoc2hvdWxkT3V0cHV0KHJlc3VsdCkpIHtcbiAgICBsb2dnZXIuZXJyb3IocmVzdWx0Lm91dHB1dC5qb2luKCcnKSk7XG4gIH1cbiAgaWYgKHJlc3VsdC5lcnJvcikge1xuICAgIHJldHVybiBQcm9taXNlLnJlamVjdChyZXN1bHQuZXJyb3IpO1xuICB9XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzdWx0KTtcbn1cbiIsImltcG9ydCB7IHBlcmZvcm1hbmNlIH0gZnJvbSAnbm9kZTpwZXJmX2hvb2tzJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmltcG9ydCB7IHNwYXduT3V0cHV0Q29uZGl0aW9uYWwgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi9sb2dnZXIvbG9nZ2VyJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRzU2NyaXB0KG9wdHM6IHtcbiAgbG9jYXRpb246IHN0cmluZztcbiAgaW1wb3J0TWV0YVVybD86IFVSTDtcbiAgYXJncz86IHN0cmluZ1tdO1xufSkge1xuICBjb25zdCBzdGFydGVkID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gIHRyeSB7XG4gICAgY29uc3QgbG9jYXRpb24gPSBvcHRzLmltcG9ydE1ldGFVcmxcbiAgICAgID8gZmlsZVVSTFRvUGF0aChuZXcgVVJMKG9wdHMubG9jYXRpb24sIG9wdHMuaW1wb3J0TWV0YVVybCkpXG4gICAgICA6IG9wdHMubG9jYXRpb247XG5cbiAgICBpZiAobG9nZ2VyLmxvZ0xldmVsICE9PSAnZGVidWcnKSB7XG4gICAgICBsb2dnZXIubG9nKGBSdW5uaW5nIFwiJHtsb2NhdGlvbn1cImApO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAgICAgJ3RzeCcsXG4gICAgICBbbG9jYXRpb24sIC4uLihvcHRzLmFyZ3MgfHwgW10pXSxcbiAgICAgIHtcbiAgICAgICAgZXhpdENvZGVzOiBbMF0sXG4gICAgICAgIC4uLihsb2dnZXIubG9nTGV2ZWwgPT09ICdkZWJ1ZycgJiYge1xuICAgICAgICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgICAgICAgb3V0cHV0OiBbXSxcbiAgICAgICAgfSksXG4gICAgICAgIGVudjoge1xuICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgIExPR19MRVZFTDogbG9nZ2VyLmxvZ0xldmVsLFxuICAgICAgICB9LFxuICAgICAgfVxuICAgICk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGxvZ2dlci5sb2dMZXZlbCAhPT0gJ2RlYnVnJykge1xuICAgICAgbG9nZ2VyLmxvZyhcbiAgICAgICAgYEZpbmlzaGVkIGluICR7KChwZXJmb3JtYW5jZS5ub3coKSAtIHN0YXJ0ZWQpIC8gMTAwMCkudG9GaXhlZCgyKX1zYFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cbiIsImltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcblxuaW1wb3J0IHsgb25jZSB9IGZyb20gJ0B1dGlscy90cyc7XG5cbmV4cG9ydCBjb25zdCBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCA9IChvcHRzOiB7XG4gIGltcG9ydE1ldGFVcmw6IHN0cmluZztcbn0pID0+IHtcbiAgLy8gdGhpcyBpcyBoaWdobHkgZGVwZW5kZW50IG9uIHRoZSBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZVxuICAvLyBhbmQgdGhlIGNvbnRleHQgaW4gd2hpY2ggdGhpcyBmdW5jdGlvbiBpcyBydW4gKGJ1bmRsZWQgY29kZSB2cyB0c3ggLi9zcmMvdHNmaWxlLnRzKVxuICBjb25zdCBfX2ZpbGVOYW1lID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICBjb25zdCBwYXJlbnQgPSBkaXJuYW1lKF9fZmlsZU5hbWUpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IGRpcm5hbWUocGFyZW50KTtcblxuICBjb25zdCBpc0J1bmRsZWRJbkRpc3QgPSAoKSA9PiBwYXJlbnQuZW5kc1dpdGgoJy9kaXN0Jyk7XG4gIGNvbnN0IGlzQnVuZGxlZEluQmluID0gKCkgPT5cbiAgICBwYXJlbnQuZW5kc1dpdGgoJy9iaW4nKSAmJiAhc3VwZXJQYXJlbnQuZW5kc1dpdGgoJy9zcmMnKTtcblxuICBpZiAoaXNCdW5kbGVkSW5EaXN0KCkgfHwgaXNCdW5kbGVkSW5CaW4oKSkge1xuICAgIHJldHVybiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpO1xuICB9XG5cbiAgLy8gcnVuIHZpYSB0c3ggdG8gYnVpbGQgdGhlIEByZXBrYS1raXQvdHMgaXRzZWxmXG4gIHJldHVybiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4uLy4uL2AsIG9wdHMuaW1wb3J0TWV0YVVybCkpO1xufTtcblxuZXhwb3J0IGNvbnN0IG1vZHVsZVJvb3REaXJlY3RvcnkgPSBvbmNlKCgpID0+XG4gIGdldE1vZHVsZVJvb3REaXJlY3RvcnlGb3JJbXBvcnRNZXRhVXJsKHsgaW1wb3J0TWV0YVVybDogaW1wb3J0Lm1ldGEudXJsIH0pXG4pO1xuIiwiaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBvbmNlQXN5bmMgfSBmcm9tICdAdXRpbHMvdHMnO1xuXG5pbXBvcnQgeyBtb2R1bGVSb290RGlyZWN0b3J5IH0gZnJvbSAnLi4vdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5pbXBvcnQgdHlwZSB7IFBhY2thZ2VKc29uIH0gZnJvbSAnLi9wYWNrYWdlSnNvbic7XG5cbmNvbnN0IGN3ZFBhY2thZ2VKc29uUGF0aCA9ICgpID0+IGpvaW4ocHJvY2Vzcy5jd2QoKSwgJy4vcGFja2FnZS5qc29uJyk7XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRQYWNrYWdlSnNvbkF0KFxuICBwYXRoOiBzdHJpbmcsXG4gIGRlcHMgPSB7IHJlYWRGaWxlOiAocGF0aDogc3RyaW5nKSA9PiByZWFkRmlsZShwYXRoLCAndXRmLTgnKSB9XG4pOiBQcm9taXNlPFBhY2thZ2VKc29uPiB7XG4gIHJldHVybiBhd2FpdCBkZXBzXG4gICAgLnJlYWRGaWxlKHBhdGgpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gSlNPTi5wYXJzZShyZXN1bHQpIGFzIFBhY2thZ2VKc29uKTtcbn1cblxuZXhwb3J0IGNvbnN0IHJlYWRDd2RQYWNrYWdlSnNvbiA9IG9uY2VBc3luYygoKSA9PlxuICByZWFkUGFja2FnZUpzb25BdChjd2RQYWNrYWdlSnNvblBhdGgoKSlcbik7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb24oXG4gIHBhdGg6IHN0cmluZyxcbiAgZGVwcyA9IHsgcmVhZEZpbGU6IChwYXRoOiBzdHJpbmcpID0+IHJlYWRGaWxlKHBhdGgsICd1dGYtOCcpIH1cbik6IFByb21pc2U8UGFja2FnZUpzb24+IHtcbiAgLy8gYXNzdW1pbmcgY3VycmVudCBkaXJlY3RvcnkgZG9lc24ndCBjaGFuZ2Ugd2hpbGUgYXBwIGlzIHJ1bm5pbmdcbiAgcmV0dXJuIHByb2Nlc3MuY3dkKCkgPT09IGN3ZFBhY2thZ2VKc29uUGF0aCgpXG4gICAgPyBhd2FpdCByZWFkQ3dkUGFja2FnZUpzb24oKVxuICAgIDogYXdhaXQgcmVhZFBhY2thZ2VKc29uQXQocGF0aCwgZGVwcyk7XG59XG5cbi8qKlxuICogUmVhZCBwYWNrYWdlIGpzb24gb2YgdGhlIGN1cnJlbnQgbGlicmFyeSAoQHJlcGthLWtpdC90cylcbiAqL1xuZXhwb3J0IGNvbnN0IG91clBhY2thZ2VKc29uID0gb25jZUFzeW5jKFxuICBhc3luYyAoXG4gICAgZGVwcyA9IHtcbiAgICAgIHJlYWRGaWxlOiAocGF0aDogc3RyaW5nKSA9PiByZWFkRmlsZShwYXRoLCAndXRmLTgnKSxcbiAgICB9XG4gICkgPT4ge1xuICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IGpvaW4obW9kdWxlUm9vdERpcmVjdG9yeSgpLCAncGFja2FnZS5qc29uJyk7XG4gICAgcmV0dXJuIGF3YWl0IHJlYWRQYWNrYWdlSnNvbkF0KHBhY2thZ2VKc29uUGF0aCwge1xuICAgICAgcmVhZEZpbGU6IGRlcHMucmVhZEZpbGUsXG4gICAgfSk7XG4gIH1cbik7XG4iLCJpbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0JztcbmltcG9ydCB7IGRpcm5hbWUsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBpc1RydXRoeSwgb25jZUFzeW5jIH0gZnJvbSAnQHV0aWxzL3RzJztcbmltcG9ydCBmZyBmcm9tICdmYXN0LWdsb2InO1xuXG5jb25zdCBnZXRSZXBvc2l0b3J5Um9vdFNjYW5DYW5kaWRhdGVzID0gKGN1cnJlbnREaXJlY3Rvcnk6IHN0cmluZykgPT4ge1xuICAvLyBoYXZpbmcgJ3BhY2thZ2VzLyonIGluIHRoZSByb290IG9mIGEgbW9ub3JlcG8gaXMgc3VwZXIgY29tbW9uXG4gIGNvbnN0IHJlc3VsdCA9IC8oLiooPz1cXC9wYWNrYWdlc1xcLykpfCguKig/PVxcL25vZGVfbW9kdWxlc1xcLykpfCguKikvLmV4ZWMoXG4gICAgY3VycmVudERpcmVjdG9yeVxuICApO1xuICBhc3NlcnQoISFyZXN1bHQpO1xuICBjb25zdCBbLCBwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdF0gPSByZXN1bHQ7XG4gIHJldHVybiBbcGFja2FnZXNSb290LCBub2RlTW9kdWxlc1Jvb3RdLmZpbHRlcihpc1RydXRoeSk7XG59O1xuXG4vLyByZXR1cm5zIHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2hpY2ggaGFzIG1vbm9yZXBvIG1hcmtlcnMsIG11bHRpcGxlXG4vLyBkaXJlY3RvcmllcyBjYW4gaGF2ZSB0aGVtIC0gd2hpY2hldmVyIHJlYWQgZmlyc3Qgd2lsbCBiZSByZXR1cm5lZFxuLy8gc28gaWYgb3JkZXIgaXMgaW1wb3J0YW50IC0gc2Nhbm5pbmcgc2hvdWxkIGJlIHNlcGFyYXRlZCB0byBtdWx0aXBsZSBqb2JzXG4vLyB2aWEgcHJpb3JpdGl6ZWRIYXNNb25vcmVwb01hcmtlcnNcbmNvbnN0IGhhc1Jvb3RNYXJrZXJzID0gYXN5bmMgKGNhbmRpZGF0ZXM6IHN0cmluZ1tdKSA9PiB7XG4gIGNvbnN0IG1hcmtlcnMgPSBbXG4gICAgJy5naXQnLFxuICAgICd5YXJuLmxvY2snLFxuICAgICdwbnBtLWxvY2sueWFtbCcsXG4gICAgJ3BhY2thZ2UtbG9jay5qc29uJyxcbiAgICAncG5wbS13b3Jrc3BhY2UueWFtbCcsXG4gIF07XG4gIGNvbnN0IG1hcmtlcnNTdHJlYW0gPSBmZy5zdHJlYW0oXG4gICAgY2FuZGlkYXRlcy5mbGF0TWFwKChkaXIpID0+IG1hcmtlcnMubWFwKChtYXJrZXIpID0+IGpvaW4oZGlyLCBtYXJrZXIpKSksXG4gICAge1xuICAgICAgbWFya0RpcmVjdG9yaWVzOiB0cnVlLFxuICAgICAgb25seUZpbGVzOiBmYWxzZSxcbiAgICB9XG4gICk7XG4gIGZvciBhd2FpdCAoY29uc3QgZW50cnkgb2YgbWFya2Vyc1N0cmVhbSkge1xuICAgIGFzc2VydCh0eXBlb2YgZW50cnkgPT09ICdzdHJpbmcnKTtcbiAgICByZXR1cm4gZGlybmFtZShlbnRyeSk7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbmNvbnN0IHByaW9yaXRpemVkSGFzTWFya2VycyA9IChqb2JzOiBzdHJpbmdbXVtdKSA9PiB7XG4gIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKTtcbiAgfVxuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPigocmVzKSA9PiB7XG4gICAgY29uc3QgcmVzdWx0cyA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmcgfCB1bmRlZmluZWQ+KCk7XG5cbiAgICBjb25zdCBjaGVja1Nob3VsZENvbXBsZXRlID0gKGluZGV4OiBudW1iZXIsIHJlc3VsdDogc3RyaW5nIHwgdW5kZWZpbmVkKSA9PiB7XG4gICAgICByZXN1bHRzLnNldChpbmRleCwgcmVzdWx0KTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgam9icy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBoYXNSZXN1bHQgPSByZXN1bHRzLmhhcyhpKTtcbiAgICAgICAgaWYgKCFoYXNSZXN1bHQpIHtcbiAgICAgICAgICAvLyBpZiBhIGpvYiB3aXRoIGhpZ2hlc3QgcHJpb3JpdHkgaGFzbid0IGZpbmlzaGVkIHlldFxuICAgICAgICAgIC8vIHRoZW4gd2FpdCBmb3IgaXRcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXN1bHQgPSByZXN1bHRzLmdldChpKTtcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIC8vIGpvYiBmaW5pc2hlZCBhbmQgd2UgZm91bmQgbWFya2VycywgYWxzbyBhbGwgam9ic1xuICAgICAgICAgIC8vIHdpdGggaGlnaGVyIHByaW9yaXR5IGZpbmlzaGVkIGFuZCB0aGV5IGRvbid0IGhhdmVcbiAgICAgICAgICAvLyBhbnkgbWFya2VycyAtIHdlIGFyZSBkb25lXG4gICAgICAgICAgcmVzKHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHRzLnNpemUgPT09IGpvYnMubGVuZ3RoKSB7XG4gICAgICAgIC8vIGFsbCBqb2JzIGZpbmlzaGVkIC0gbm8gbWFya2VycyBmb3VuZFxuICAgICAgICByZXModW5kZWZpbmVkKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgam9icy5mb3JFYWNoKChkaXJlY3RvcmllcywgaW5kZXgpID0+IHtcbiAgICAgIGhhc1Jvb3RNYXJrZXJzKGRpcmVjdG9yaWVzKVxuICAgICAgICAudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgICAgY2hlY2tTaG91bGRDb21wbGV0ZShpbmRleCwgcmVzdWx0KTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBpZ25vcmVcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn07XG5cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGhWaWFEaXJlY3RvcnlTY2FuID0gYXN5bmMgKFxuICBsb29rdXBEaXJlY3Rvcnk6IHN0cmluZ1xuKSA9PiB7XG4gIGNvbnN0IHVuaXF1ZURpcm5hbWUgPSAocGF0aD86IHN0cmluZykgPT4ge1xuICAgIGlmICghcGF0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBkaXJuYW1lKHBhdGgpO1xuICAgIGlmIChyZXN1bHQgPT09IHBhdGgpIHtcbiAgICAgIC8vIGUuZy4gdGhlIHBhdGggd2FzIGFscmVhZHkgYSByb290IFwiL1wiXG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgY29uc3QgcGFyZW50ID0gdW5pcXVlRGlybmFtZShsb29rdXBEaXJlY3RvcnkpO1xuICBjb25zdCBzdXBlclBhcmVudCA9IHVuaXF1ZURpcm5hbWUocGFyZW50KTtcblxuICByZXR1cm4gKFxuICAgIChhd2FpdCBwcmlvcml0aXplZEhhc01hcmtlcnMoXG4gICAgICAvLyBzY2FuIGluIG1vc3QgbGlrZWx5IGxvY2F0aW9ucyBmaXJzdCB3aXRoIGN1cnJlbnQgbG9va3VwIGRpcmVjdG9yeSB0YWtpbmcgcHJpb3JpdHlcbiAgICAgIFtcbiAgICAgICAgW2xvb2t1cERpcmVjdG9yeV0sXG4gICAgICAgIGdldFJlcG9zaXRvcnlSb290U2NhbkNhbmRpZGF0ZXMobG9va3VwRGlyZWN0b3J5KSxcbiAgICAgICAgLy8gc2NhbiAyIGRpcmVjdG9yaWVzIHVwd2FyZHNcbiAgICAgICAgW3BhcmVudF0sXG4gICAgICAgIFtzdXBlclBhcmVudF0sXG4gICAgICBdXG4gICAgICAgIC5tYXAoKGRpcnMpID0+IGRpcnMuZmlsdGVyKGlzVHJ1dGh5KSlcbiAgICAgICAgLmZpbHRlcigoam9iKSA9PiBqb2IubGVuZ3RoID4gMClcbiAgICApKSB8fCBsb29rdXBEaXJlY3RvcnkgLyogZmFsbGJhY2sgdG8gY3VycmVudCBkaXJlY3RvcnkgaW4gd29yc2Ugc2NlbmFyaW8gKi9cbiAgKTtcbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIHJlcG9zaXRvcnkgcm9vdCBwYXRoIGJ5IHNjYW5uaW5nIGN1cnJlbnQgYW5kIHBhcmVudCBkaXJlY3Rvcmllc1xuICogYW5kIGxvb2tpbmcgZm9yIG1hcmtlciBmaWxlcy9kaXJzIGxpa2U6XG4gKlxuICogLSAuZ2l0XG4gKiAtIHBhY2thZ2UtbG9jay5qc29uXG4gKiAtIHlhcm4ubG9ja1xuICogLSBwbnBtLWxvY2sueWFtbFxuICogLSBwbnBtLXdvcmtzcGFjZS55YW1sXG4gKi9cbmV4cG9ydCBjb25zdCByZXBvc2l0b3J5Um9vdFBhdGggPSBvbmNlQXN5bmMoYXN5bmMgKCkgPT4ge1xuICBjb25zdCByb290UGF0aCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aFZpYURpcmVjdG9yeVNjYW4ocHJvY2Vzcy5jd2QoKSk7XG4gIHJldHVybiByb290UGF0aDtcbn0pO1xuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHR5cGUgeyBTcGF3bk9wdGlvbnNXaXRoRXh0cmEgfSBmcm9tICcuL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd25PdXRwdXRDb25kaXRpb25hbCB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQgdHlwZSB7IFNwYXduUmVzdWx0T3B0cyB9IGZyb20gJy4vY2hpbGQtcHJvY2Vzcy9zcGF3blJlc3VsdCc7XG5pbXBvcnQgeyBiaW5QYXRoIH0gZnJvbSAnLi91dGlscy9iaW5QYXRoJztcbmltcG9ydCB0eXBlIHsgQ2xpQXJncyB9IGZyb20gJy4vdXRpbHMvY2xpQXJnc1BpcGUnO1xuaW1wb3J0IHsgY2xpQXJnc1BpcGUgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGluc2VydEFmdGVyQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IGluY2x1ZGVzQW55T2YgfSBmcm9tICcuL3V0aWxzL2NsaUFyZ3NQaXBlJztcbmltcG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vdXRpbHMvcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuZXhwb3J0IHR5cGUgVGFza1R5cGVzID1cbiAgfCAnbGludCdcbiAgfCAnYnVpbGQnXG4gIHwgJ3Rlc3QnXG4gIHwgJ2RlY2xhcmF0aW9ucydcbiAgfCAnaW50ZWdyYXRpb24nXG4gIHwgJ3NldHVwOmludGVncmF0aW9uJ1xuICB8IChzdHJpbmcgJiB7XG4gICAgICBfYWxsb3dTdHJpbmdzPzogdW5kZWZpbmVkO1xuICAgIH0pO1xuXG5leHBvcnQgY29uc3QgdHVyYm9CaW5QYXRoID0gKCkgPT5cbiAgYmluUGF0aCh7XG4gICAgYmluTmFtZTogJ3R1cmJvJyxcbiAgICBiaW5TY3JpcHRQYXRoOiAndHVyYm8vYmluL3R1cmJvJyxcbiAgfSk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYXNUdXJib0pzb24oKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGN3ZCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICByZXR1cm4gYXdhaXQgc3RhdChqb2luKGN3ZCwgJ3R1cmJvLmpzb24nKSlcbiAgICAudGhlbigocmVzKSA9PiByZXMuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhc3NUdXJib0ZvcmNlRW52KGFyZ3M6IHN0cmluZ1tdKSB7XG4gIHJldHVybiBpbmNsdWRlc0FueU9mKGFyZ3MsIFsncnVuJ10pICYmIGluY2x1ZGVzQW55T2YoYXJncywgWyctLWZvcmNlJ10pXG4gICAgPyB7XG4gICAgICAgIFRVUkJPX0ZPUkNFOiAnMScsXG4gICAgICB9XG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbmhlcml0VHVyYm9Gb3JjZUFyZ0Zyb21FbnYoKSB7XG4gIHJldHVybiAoc3RhdGU6IENsaUFyZ3MpID0+ICh7XG4gICAgLi4uc3RhdGUsXG4gICAgaW5wdXRBcmdzOlxuICAgICAgaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsncnVuJ10pICYmXG4gICAgICAhaW5jbHVkZXNBbnlPZihzdGF0ZS5pbnB1dEFyZ3MsIFsnLS1mb3JjZSddKSAmJlxuICAgICAgcHJvY2Vzcy5lbnZbJ1RVUkJPX0ZPUkNFJ11cbiAgICAgICAgPyBpbnNlcnRBZnRlckFueU9mKHN0YXRlLmlucHV0QXJncywgWyctLWZvcmNlJ10sIFsncnVuJ10pXG4gICAgICAgIDogc3RhdGUuaW5wdXRBcmdzLFxuICB9KTtcbn1cblxuLyoqXG4gKiBSdW4gb25lIG9mIHRoZSBkZXYgcGlwZWxpbmUgdGFza3MgdXNpbmcgVHVyYm8gZm9yIGEgc2luZ2xlIHBhY2thZ2VcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blR1cmJvVGFza3NGb3JTaW5nbGVQYWNrYWdlKG9wdHM6IHtcbiAgdGFza3M6IFtUYXNrVHlwZXMsIC4uLlRhc2tUeXBlc1tdXTtcbiAgcGFja2FnZURpcj86IHN0cmluZztcbiAgc3Bhd25PcHRzOiBPbWl0PFNwYXduT3B0aW9uc1dpdGhFeHRyYTxTcGF3blJlc3VsdE9wdHM+LCAnY3dkJz47XG59KSB7XG4gIGNvbnN0IHJvb3REaXIgPSBvcHRzLnBhY2thZ2VEaXIgPz8gcHJvY2Vzcy5jd2QoKTtcbiAgY29uc3QgY3dkID0gYXdhaXQgcmVwb3NpdG9yeVJvb3RQYXRoKCk7XG4gIHJldHVybiBhd2FpdCBzcGF3bk91dHB1dENvbmRpdGlvbmFsKFxuICAgIGF3YWl0IHR1cmJvQmluUGF0aCgpLFxuICAgIGNsaUFyZ3NQaXBlKFxuICAgICAgW2luaGVyaXRUdXJib0ZvcmNlQXJnRnJvbUVudigpXSxcbiAgICAgIFtcbiAgICAgICAgJ3J1bicsXG4gICAgICAgIC4uLm9wdHMudGFza3MsXG4gICAgICAgICctLWZpbHRlcj0nICsgcm9vdERpci5yZXBsYWNlKGN3ZCwgJy4nKSxcbiAgICAgICAgJy0tb3V0cHV0LWxvZ3M9bmV3LW9ubHknLFxuICAgICAgICAnLS1jb2xvcicsXG4gICAgICBdXG4gICAgKSxcbiAgICB7XG4gICAgICAuLi5vcHRzLnNwYXduT3B0cyxcbiAgICAgIGN3ZCxcbiAgICB9XG4gICk7XG59XG4iLCJpbXBvcnQgeyByZWFkRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XG5pbXBvcnQgeyBsb2FkIH0gZnJvbSAnanMteWFtbCc7XG5cbmltcG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuYXN5bmMgZnVuY3Rpb24gdHJ5UmVhZGluZ1BucG1Xb3Jrc3BhY2VZYW1sKG1vbm9yZXBvUm9vdDogc3RyaW5nKSB7XG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShcbiAgICBqb2luKG1vbm9yZXBvUm9vdCwgJ3BucG0td29ya3NwYWNlLnlhbWwnKSxcbiAgICAndXRmLTgnXG4gICk7XG4gIGNvbnN0IHJvb3RQYXRoID0gbG9hZCh0ZXh0KSBhcyB7XG4gICAgcGFja2FnZXM/OiBzdHJpbmdbXTtcbiAgfTtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkocm9vdFBhdGgucGFja2FnZXMpICYmIHJvb3RQYXRoLnBhY2thZ2VzLmxlbmd0aCA+IDBcbiAgICA/IHJvb3RQYXRoLnBhY2thZ2VzXG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHRyeVJlYWRpbmdQYWNrYWdlSnNvbldvcmtzcGFjZXMobW9ub3JlcG9Sb290OiBzdHJpbmcpIHtcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHJlYWRGaWxlKGpvaW4obW9ub3JlcG9Sb290LCAncGFja2FnZS5qc29uJyksICd1dGYtOCcpO1xuICBjb25zdCBwYWNrYWdlSnNvbiA9IEpTT04ucGFyc2UodGV4dCkgYXMge1xuICAgIHdvcmtzcGFjZXM/OiBzdHJpbmdbXTtcbiAgfTtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkocGFja2FnZUpzb24ud29ya3NwYWNlcykgJiZcbiAgICBwYWNrYWdlSnNvbi53b3Jrc3BhY2VzLmxlbmd0aCA+IDBcbiAgICA/IHBhY2thZ2VKc29uLndvcmtzcGFjZXNcbiAgICA6IHVuZGVmaW5lZDtcbn1cblxuY29uc3QgcmVhZFBhY2thZ2VzR2xvYnNBdCA9IGFzeW5jIChtb25vcmVwb1Jvb3Q6IHN0cmluZykgPT4ge1xuICBjb25zdCBbcG5wbVdvcmtzcGFjZXMsIHBhY2thZ2VKc29uV29ya3NwYWNlc10gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgdHJ5UmVhZGluZ1BucG1Xb3Jrc3BhY2VZYW1sKG1vbm9yZXBvUm9vdCkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKSxcbiAgICB0cnlSZWFkaW5nUGFja2FnZUpzb25Xb3Jrc3BhY2VzKG1vbm9yZXBvUm9vdCkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKSxcbiAgXSk7XG4gIHJldHVybiBwbnBtV29ya3NwYWNlcyB8fCBwYWNrYWdlSnNvbldvcmtzcGFjZXMgfHwgW107XG59O1xuXG4vKipcbiAqIERldGVybWluZSBtb25vcmVwbyBwYWNrYWdlcyBnbG9iIGJ5IHJlYWRpbmcgb25lIG9mIHRoZSBzdXBwb3J0ZWRcbiAqIGZpbGVzXG4gKlxuICogTk9URTogb25seSBwbnBtIGlzIHN1cHBvcnRlZCBhdCB0aGUgbW9tZW50XG4gKi9cbmV4cG9ydCBjb25zdCByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzID0gb25jZUFzeW5jKGFzeW5jICgpID0+IHtcbiAgY29uc3Qgcm9vdCA9IGF3YWl0IHJlcG9zaXRvcnlSb290UGF0aCgpO1xuICBjb25zdCBwYWNrYWdlc0dsb2JzID0gYXdhaXQgcmVhZFBhY2thZ2VzR2xvYnNBdChyb290KTtcbiAgcmV0dXJuIHtcbiAgICByb290LFxuICAgIHBhY2thZ2VzR2xvYnMsXG4gIH07XG59KTtcbiIsImltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcblxuaW1wb3J0IHsgaGFzVHVyYm9Kc29uIH0gZnJvbSAnLi4vdHVyYm8nO1xuaW1wb3J0IHsgcmVhZE1vbm9yZXBvUGFja2FnZXNHbG9icyB9IGZyb20gJy4vcmVhZFBhY2thZ2VzR2xvYnMnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uKCkge1xuICBjb25zdCBbeyByb290LCBwYWNrYWdlc0dsb2JzIH0sIGhhc1R1cmJvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICByZWFkTW9ub3JlcG9QYWNrYWdlc0dsb2JzKCksXG4gICAgaGFzVHVyYm9Kc29uKCksXG4gIF0pO1xuICBpZiAocGFja2FnZXNHbG9icy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4ge1xuICAgICAgcm9vdCxcbiAgICAgIHBhY2thZ2VzR2xvYnMsXG4gICAgICBwYWNrYWdlTG9jYXRpb25zOiBbXSxcbiAgICAgIGhhc1R1cmJvLFxuICAgICAgdHlwZTogJ3NpbmdsZS1wYWNrYWdlJyBhcyBjb25zdCxcbiAgICB9O1xuICB9XG4gIGNvbnN0IHBhY2thZ2VMb2NhdGlvbnMgPSBhd2FpdCBmZyhcbiAgICBwYWNrYWdlc0dsb2JzLm1hcCgoZ2xvYikgPT4gYCR7Z2xvYn0vcGFja2FnZS5qc29uYCksXG4gICAge1xuICAgICAgY3dkOiByb290LFxuICAgIH1cbiAgKTtcbiAgcmV0dXJuIHtcbiAgICByb290LFxuICAgIHBhY2thZ2VzR2xvYnMsXG4gICAgcGFja2FnZUxvY2F0aW9uczogcGFja2FnZUxvY2F0aW9ucy5tYXAoKGxvY2F0aW9uKSA9PiBkaXJuYW1lKGxvY2F0aW9uKSksXG4gICAgaGFzVHVyYm8sXG4gICAgdHlwZTogJ211bHRpcGxlLXBhY2thZ2VzJyBhcyBjb25zdCxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgdHlwZSB7IENvbmZpZyB9IGZyb20gJ2plc3QnO1xuaW1wb3J0IHsgZGVmYXVsdHMgfSBmcm9tICdqZXN0LWNvbmZpZyc7XG5cbmV4cG9ydCBjb25zdCBleHRlbnNpb25zID0gW1xuICAnanMnLFxuICAnY2pzJyxcbiAgJ21qcycsXG4gICdqc3gnLFxuICAndHMnLFxuICAnY3RzJyxcbiAgJ210cycsXG4gICd0c3gnLFxuXTtcblxuZXhwb3J0IGNvbnN0IGlnbm9yZURpcnMgPSBbJy9ub2RlX21vZHVsZXMvJywgJy9kaXN0LycsICcvLnRzYy1vdXQvJ107XG5cbmV4cG9ydCBjb25zdCBqZXN0VHJhbnNmb3JtQ29uZmlnUHJvcCA9IChcbiAgamVzdFBsdWdpblJvb3Q/OiBzdHJpbmdcbik6IFBpY2s8Q29uZmlnLCAndHJhbnNmb3JtJz4gPT4ge1xuICBjb25zdCBlc2J1aWxkID0gamVzdFBsdWdpblJvb3RcbiAgICA/IGpvaW4oamVzdFBsdWdpblJvb3QsICdlc2J1aWxkLWplc3QnKVxuICAgIDogJ2VzYnVpbGQtamVzdCc7XG5cbiAgY29uc3QgZXNidWlsZERlZmF1bHRPcHRzID0ge1xuICAgIHRhcmdldDogYG5vZGUke3Byb2Nlc3MudmVyc2lvbnMubm9kZX1gLFxuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgfTtcblxuICBjb25zdCBsb2FkZXJCeUV4dCA9IHtcbiAgICB0czogeyBsb2FkZXI6ICd0cycsIGZvcm1hdDogJ2VzbScgfSxcbiAgICBjdHM6IHsgbG9hZGVyOiAndHMnLCBmb3JtYXQ6ICdjanMnIH0sXG4gICAgbXRzOiB7IGxvYWRlcjogJ3RzJywgZm9ybWF0OiAnZXNtJyB9LFxuICAgIGN0c3g6IHsgbG9hZGVyOiAndHN4JywgZm9ybWF0OiAnY2pzJyB9LFxuICAgIG10c3g6IHsgbG9hZGVyOiAndHN4JywgZm9ybWF0OiAnZXNtJyB9LFxuICAgIHRzeDogeyBsb2FkZXI6ICd0c3gnLCBmb3JtYXQ6ICdlc20nIH0sXG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICB0cmFuc2Zvcm06IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIE9iamVjdC5lbnRyaWVzKGxvYWRlckJ5RXh0KS5tYXAoKFtleHQsIG9wdHNdKSA9PiBbXG4gICAgICAgIGBeLitcXFxcLiR7ZXh0fSRgLFxuICAgICAgICBbXG4gICAgICAgICAgZXNidWlsZCxcbiAgICAgICAgICB7XG4gICAgICAgICAgICAuLi5lc2J1aWxkRGVmYXVsdE9wdHMsXG4gICAgICAgICAgICBmb3JtYXQ6IG9wdHMuZm9ybWF0LFxuICAgICAgICAgICAgbG9hZGVyczoge1xuICAgICAgICAgICAgICBbYC4ke2V4dH1gXTogb3B0cy5sb2FkZXIsXG4gICAgICAgICAgICAgIFtgLnRlc3QuJHtleHR9YF06IG9wdHMubG9hZGVyLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgXSlcbiAgICApLFxuICB9O1xufTtcblxuZXhwb3J0IGNvbnN0IGNvbW1vbkRlZmF1bHRzOiBDb25maWcgPSB7XG4gIGNhY2hlRGlyZWN0b3J5OiAnbm9kZV9tb2R1bGVzLy5qZXN0LWNhY2hlJyxcbiAgdGVzdFBhdGhJZ25vcmVQYXR0ZXJuczogW1xuICAgIC4uLmlnbm9yZURpcnMubWFwKChkaXIpID0+IGA8cm9vdERpcj4ke2Rpcn1gKSxcbiAgICAnPHJvb3REaXI+Ly4qL3Rlc3QtY2FzZXMvJyxcbiAgXSxcbiAgdHJhbnNmb3JtSWdub3JlUGF0dGVybnM6IFsuLi5pZ25vcmVEaXJzLm1hcCgoZGlyKSA9PiBgPHJvb3REaXI+JHtkaXJ9YCldLFxuICBjb3ZlcmFnZVBhdGhJZ25vcmVQYXR0ZXJuczogWy4uLmlnbm9yZURpcnMubWFwKChkaXIpID0+IGA8cm9vdERpcj4ke2Rpcn1gKV0sXG4gIG1vZHVsZVBhdGhJZ25vcmVQYXR0ZXJuczogWy4uLmlnbm9yZURpcnMubWFwKChkaXIpID0+IGA8cm9vdERpcj4ke2Rpcn1gKV0sXG4gIG1vZHVsZUZpbGVFeHRlbnNpb25zOiBbXG4gICAgLi4ubmV3IFNldChbLi4uZGVmYXVsdHMubW9kdWxlRmlsZUV4dGVuc2lvbnMsIC4uLmV4dGVuc2lvbnNdKSxcbiAgXSxcbiAgZXh0ZW5zaW9uc1RvVHJlYXRBc0VzbTogWycuanN4JywgJy50cycsICcubXRzJywgJy50c3gnXSxcbiAgcm9vdERpcjogcHJvY2Vzcy5jd2QoKSxcbn07XG5cbmNvbnN0IGZsYXZvclJlZ2V4ID0gL1xcdysvO1xuXG5leHBvcnQgZnVuY3Rpb24gY3VzdG9tRmxhdm9yVGVzdERlZmF1bHRzKGZsYXZvcjogc3RyaW5nKTogQ29uZmlnIHtcbiAgaWYgKGZsYXZvciA9PT0gJ3VuaXQnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdGbGF2b3IgY2Fubm90IGJlIHVuaXQnKTtcbiAgfVxuICBpZiAoIWZsYXZvclJlZ2V4LnRlc3QoZmxhdm9yKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRmxhdm9yIHNob3VsZCBtYXRjaCAvJHtmbGF2b3JSZWdleC5zb3VyY2V9L2ApO1xuICB9XG4gIGNvbnN0IHJvb3RzID0gWyc8cm9vdERpcj4nLCAnPHJvb3REaXI+L3NyYyddO1xuICBjb25zdCBmbGF2b3JUZXN0R2xvYnMgPSBbYF9fJHtmbGF2b3J9X18vKipgXTtcbiAgY29uc3QgZXh0cyA9IGV4dGVuc2lvbnMuam9pbignLCcpO1xuICBjb25zdCBmbGF2b3JUZXN0TWF0Y2ggPSBmbGF2b3JUZXN0R2xvYnNcbiAgICAuZmxhdE1hcCgoZ2xvYikgPT5cbiAgICAgIHJvb3RzLm1hcCgocm9vdCkgPT4gW3Jvb3QsIGdsb2JdLmZpbHRlcihCb29sZWFuKS5qb2luKCcvJykpXG4gICAgKVxuICAgIC5tYXAoKGdsb2IpID0+IFtnbG9iLCBgKi50ZXN0Lnske2V4dHN9fWBdLmpvaW4oJy8nKSk7XG5cbiAgcmV0dXJuIHtcbiAgICB0ZXN0TWF0Y2g6IGZsYXZvclRlc3RNYXRjaCxcbiAgICB0ZXN0VGltZW91dDogNDVfMDAwLFxuICAgIHNsb3dUZXN0VGhyZXNob2xkOiAzMF8wMDAsXG4gICAgY292ZXJhZ2VEaXJlY3Rvcnk6IGBub2RlX21vZHVsZXMvLmNvdmVyYWdlLSR7Zmxhdm9yfWAsXG4gICAgLi4uY29tbW9uRGVmYXVsdHMsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1bml0VGVzdERlZmF1bHRzKCk6IENvbmZpZyB7XG4gIGNvbnN0IHJvb3RzID0gWyc8cm9vdERpcj4nXTtcbiAgY29uc3QgdW5pdFRlc3RHbG9icyA9IFsnKiovX190ZXN0c19fLyoqJywgJyoqJ107XG4gIGNvbnN0IGV4dHMgPSBleHRlbnNpb25zLmpvaW4oJywnKTtcbiAgY29uc3QgdW5pdFRlc3RNYXRjaCA9IHVuaXRUZXN0R2xvYnNcbiAgICAuZmxhdE1hcCgoZ2xvYikgPT5cbiAgICAgIHJvb3RzLm1hcCgocm9vdCkgPT4gW3Jvb3QsIGdsb2JdLmZpbHRlcihCb29sZWFuKS5qb2luKCcvJykpXG4gICAgKVxuICAgIC5tYXAoKGdsb2IpID0+IFtnbG9iLCBgKi50ZXN0Lnske2V4dHN9fWBdLmpvaW4oJy8nKSk7XG5cbiAgcmV0dXJuIHtcbiAgICB0ZXN0TWF0Y2g6IHVuaXRUZXN0TWF0Y2gsXG4gICAgY292ZXJhZ2VEaXJlY3Rvcnk6ICdub2RlX21vZHVsZXMvLmNvdmVyYWdlLXVuaXQnLFxuICAgIC4uLmNvbW1vbkRlZmF1bHRzLFxuICAgIHRlc3RQYXRoSWdub3JlUGF0dGVybnM6IFtcbiAgICAgIC4uLihjb21tb25EZWZhdWx0cy50ZXN0UGF0aElnbm9yZVBhdHRlcm5zIHx8IFtdKSxcbiAgICAgIGA8cm9vdERpcj4vKD8hX190ZXN0c19fKV9fJHtmbGF2b3JSZWdleC5zb3VyY2V9X18vYCxcbiAgICAgIGA8cm9vdERpcj4vc3JjLyg/IV9fdGVzdHNfXylfXyR7Zmxhdm9yUmVnZXguc291cmNlfV9fL2AsXG4gICAgXSxcbiAgfTtcbn1cbiIsImltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgeyBta2Rpciwgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyB0bXBkaXIgfSBmcm9tICdub2RlOm9zJztcbmltcG9ydCB7IGpvaW4sIHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcblxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4uL3V0aWxzL21vZHVsZVJvb3REaXJlY3RvcnknO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVTY3JpcHQob3B0czoge1xuICBzY3JpcHQ6ICdzZXR1cCcgfCAndGVhcmRvd24nO1xuICBmbGF2b3I6IHN0cmluZztcbiAgcm9vdERpcjogc3RyaW5nO1xufSkge1xuICBjb25zdCB7IGZsYXZvciwgc2NyaXB0LCByb290RGlyIH0gPSBvcHRzO1xuXG4gIGNvbnN0IHN0cmVhbSA9IGZnLnN0cmVhbShcbiAgICBbYF9fJHtmbGF2b3J9X18vJHtzY3JpcHR9LnRzYCwgYHNyYy9fXyR7Zmxhdm9yfV9fLyR7c2NyaXB0fS50c2BdLFxuICAgIHtcbiAgICAgIGN3ZDogcm9vdERpcixcbiAgICB9XG4gICkgYXMgQXN5bmNJdGVyYWJsZTxzdHJpbmc+O1xuXG4gIGZvciBhd2FpdCAoY29uc3Qgc2NyaXB0IG9mIHN0cmVhbSkge1xuICAgIGlmIChzY3JpcHQpIHtcbiAgICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKCdzaGExJylcbiAgICAgICAgLnVwZGF0ZShyb290RGlyKVxuICAgICAgICAudXBkYXRlKGZsYXZvcilcbiAgICAgICAgLnVwZGF0ZShzY3JpcHQpXG4gICAgICAgIC5kaWdlc3QoKVxuICAgICAgICAudG9TdHJpbmcoJ2hleCcpO1xuXG4gICAgICBjb25zdCBkaXIgPSBqb2luKHRtcGRpcigpLCAnamVzdC1zY3JpcHRzJyk7XG4gICAgICBjb25zdCBmaWxlID0gam9pbihkaXIsIGAke2hhc2h9Lm1qc2ApO1xuXG4gICAgICBhd2FpdCBta2RpcihkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuXG4gICAgICBjb25zdCByb290ID0gbW9kdWxlUm9vdERpcmVjdG9yeSgpO1xuXG4gICAgICBhd2FpdCB3cml0ZUZpbGUoXG4gICAgICAgIGZpbGUsXG4gICAgICAgIGBpbXBvcnQgeyBydW5Uc1NjcmlwdCB9IGZyb20gJyR7am9pbihcbiAgICAgICAgICByb290LFxuICAgICAgICAgICdjb25maWdzL2plc3QvamVzdENvbmZpZ0hlbHBlcnMuZ2VuLm1qcydcbiAgICAgICAgKX0nO1xuXG5leHBvcnQgZGVmYXVsdCBhc3luYyAoKSA9PiB7XG4gIGF3YWl0IHJ1blRzU2NyaXB0KHtcbiAgICBsb2NhdGlvbjogJyR7cmVzb2x2ZShqb2luKHJvb3REaXIsIHNjcmlwdCkpfSdcbiAgfSlcbn1gXG4gICAgICApO1xuXG4gICAgICByZXR1cm4gZmlsZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiaW1wb3J0IHsgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaXNEaXJlY3RvcnkocGF0aDogc3RyaW5nKSB7XG4gIHJldHVybiBzdGF0KHBhdGgpXG4gICAgLnRoZW4oKHJlc3VsdCkgPT4gcmVzdWx0LmlzRGlyZWN0b3J5KCkpXG4gICAgLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG59XG4iLCJpbXBvcnQgeyBkaXJuYW1lLCBqb2luIH0gZnJvbSAncGF0aCc7XG5cbnR5cGUgVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMgPSB7XG4gIHN0YXJ0OiBzdHJpbmc7XG4gIHN0b3BzPzogc3RyaW5nW107XG4gIGFwcGVuZFBhdGg/OiBzdHJpbmc7XG4gIHRlc3Q6IChwYXRoOiBzdHJpbmcpID0+IFByb21pc2U8Ym9vbGVhbiB8IHN0cmluZyB8IHVuZGVmaW5lZD47XG59O1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24qIHVwd2FyZERpcmVjdG9yeVdhbGsob3B0czogVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMpIHtcbiAgbGV0IGN1cnJlbnQgPSBvcHRzLnN0YXJ0O1xuICB3aGlsZSAoXG4gICAgY3VycmVudCAhPT0gJy8nICYmXG4gICAgY3VycmVudCAhPT0gJ34vJyAmJlxuICAgICEob3B0cy5zdG9wcz8uaW5jbHVkZXMoY3VycmVudCkgPz8gZmFsc2UpXG4gICkge1xuICAgIGNvbnN0IHBhdGggPSBvcHRzLmFwcGVuZFBhdGggPyBqb2luKGN1cnJlbnQsIG9wdHMuYXBwZW5kUGF0aCkgOiBjdXJyZW50O1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGF3YWl0IG9wdHMudGVzdChwYXRoKTtcbiAgICBpZiAoY2FuZGlkYXRlKSB7XG4gICAgICB5aWVsZCB0eXBlb2YgY2FuZGlkYXRlID09PSAnc3RyaW5nJyA/IGNhbmRpZGF0ZSA6IHBhdGg7XG4gICAgfVxuICAgIGN1cnJlbnQgPSBkaXJuYW1lKGN1cnJlbnQpO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cHdhcmREaXJlY3RvcnlTZWFyY2gob3B0czogVXB3YXJkRGlyZWN0b3J5V2Fsa09wdHMpIHtcbiAgY29uc3Qgd2FsayA9IHVwd2FyZERpcmVjdG9yeVdhbGsob3B0cyk7XG4gIGZvciBhd2FpdCAoY29uc3QgZGlyIG9mIHdhbGspIHtcbiAgICByZXR1cm4gZGlyO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgaXNEaXJlY3RvcnkgfSBmcm9tICcuL2lzRGlyZWN0b3J5JztcbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuL21vZHVsZVJvb3REaXJlY3RvcnknO1xuaW1wb3J0IHsgdXB3YXJkRGlyZWN0b3J5U2VhcmNoIH0gZnJvbSAnLi91cHdhcmREaXJlY3RvcnlTZWFyY2gnO1xuXG5leHBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmV4cG9ydCB7IGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbiB9IGZyb20gJy4vbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uJztcbmV4cG9ydCB7IHJlcG9zaXRvcnlSb290UGF0aCB9IGZyb20gJy4vcmVwb3NpdG9yeVJvb3RQYXRoJztcblxuYXN5bmMgZnVuY3Rpb24gbG9va3VwKG9wdHM6IHsgcGF0aDogc3RyaW5nOyBsb29rdXBQYWNrYWdlTmFtZTogc3RyaW5nIH0pIHtcbiAgcmV0dXJuIGF3YWl0IHVwd2FyZERpcmVjdG9yeVNlYXJjaCh7XG4gICAgc3RhcnQ6IG1vZHVsZVJvb3REaXJlY3RvcnkoKSxcbiAgICBhcHBlbmRQYXRoOiBqb2luKCdub2RlX21vZHVsZXMnLCBvcHRzLmxvb2t1cFBhY2thZ2VOYW1lKSxcbiAgICB0ZXN0OiBpc0RpcmVjdG9yeSxcbiAgfSk7XG59XG5cbi8qKlxuICogTG9va3VwIGxvY2F0aW9uIGZvciBkZXZEZXBlbmRlbmNpZXMgb2YgXCJAcmVwa2Eta2l0L3RzXCIgLSB0aGlzIGZ1bmN0aW9uIHdpbGxcbiAqIGxvb2t1cCBmb3IgXCJvcHRzLmxvb2t1cFBhY2thZ2VOYW1lXCJcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZpbmREZXZEZXBlbmRlbmN5KG9wdHM6IHsgbG9va3VwUGFja2FnZU5hbWU6IHN0cmluZyB9KSB7XG4gIGNvbnN0IGxvb2t1cFBhY2thZ2VOYW1lID0gb3B0cy5sb29rdXBQYWNrYWdlTmFtZTtcblxuICByZXR1cm4gYXdhaXQgbG9va3VwKHtcbiAgICBwYXRoOiBtb2R1bGVSb290RGlyZWN0b3J5KCksXG4gICAgbG9va3VwUGFja2FnZU5hbWUsXG4gIH0pO1xufVxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG9uY2VBc3luYyB9IGZyb20gJ0B1dGlscy90cyc7XG5cbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uL2xvZ2dlci9sb2dnZXInO1xuaW1wb3J0IHsgZmluZERldkRlcGVuZGVuY3kgfSBmcm9tICcuLi91dGlscy9maW5kRGV2RGVwZW5kZW5jeSc7XG5cbmV4cG9ydCBjb25zdCBqZXN0UGx1Z2luUm9vdCA9IG9uY2VBc3luYyhhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZpbmREZXZEZXBlbmRlbmN5KHtcbiAgICBsb29rdXBQYWNrYWdlTmFtZTogJ2VzYnVpbGQtamVzdCcsXG4gIH0pO1xuICBpZiAoIXJlc3VsdCkge1xuICAgIGxvZ2dlci53YXJuKFxuICAgICAgJ0plc3QgcGx1Z2lucyByb290IGNhbm5vdCBiZSBkZXRlcm1pbmVkLiBEbyB5b3UgaGF2ZSBcIkByZXBrYS1raXQvdHNcIiBpbiBkZXZEZXBlbmRlbmNpZXMgYXQgdGhlIG1vbm9yZXBvIHJvb3Qgb3IgYXQgdGhlIGxvY2FsIHBhY2thZ2U/J1xuICAgICk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKGxvZ2dlci5sb2dMZXZlbCA9PT0gJ2RlYnVnJykge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdGb3VuZCBqZXN0IHBsdWdpbnMgcm9vdCBhdCcsIGRpcm5hbWUocmVzdWx0KSk7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQgPyBkaXJuYW1lKHJlc3VsdCkgOiAnLic7XG59KTtcbiIsImltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgdHlwZSB7IENvbmZpZyB9IGZyb20gJ2plc3QnO1xuaW1wb3J0IHsgcmVhZEluaXRpYWxPcHRpb25zIH0gZnJvbSAnamVzdC1jb25maWcnO1xuXG5pbXBvcnQgeyByZWFkUGFja2FnZUpzb24gfSBmcm9tICcuLi9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uJztcbmltcG9ydCB7IGxvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbiB9IGZyb20gJy4uL3V0aWxzL2xvYWRSZXBvc2l0b3J5Q29uZmlndXJhdGlvbic7XG5pbXBvcnQge1xuICBjdXN0b21GbGF2b3JUZXN0RGVmYXVsdHMsXG4gIGplc3RUcmFuc2Zvcm1Db25maWdQcm9wLFxuICB1bml0VGVzdERlZmF1bHRzLFxufSBmcm9tICcuL2NvbmZpZ0J1aWxkaW5nQmxvY2tzJztcbmltcG9ydCB7IGdlbmVyYXRlU2NyaXB0IH0gZnJvbSAnLi9nZW5lcmF0ZVNjcmlwdCc7XG5pbXBvcnQgeyBqZXN0UGx1Z2luUm9vdCB9IGZyb20gJy4vamVzdFBsdWdpblJvb3QnO1xuXG5leHBvcnQgdHlwZSBUZXN0Rmxhdm9yID1cbiAgfCAndW5pdCdcbiAgfCAnaW50ZWdyYXRpb24nXG4gIHwgKHN0cmluZyAmIHtcbiAgICAgICQkY3VzdG9tOiBuZXZlcjtcbiAgICB9KTtcblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQ29uZmlnKFxuICBmbGF2b3I6IFRlc3RGbGF2b3IsXG4gIHJvb3REaXI6IHN0cmluZyxcbiAgcGFyZW50Um9vdERpcj86IHN0cmluZ1xuKSB7XG4gIGNvbnN0IHBsdWdpblJvb3QgPSBqZXN0UGx1Z2luUm9vdCgpO1xuXG4gIGNvbnN0IGJhc2VDb25maWcgPVxuICAgIGZsYXZvciA9PT0gJ3VuaXQnID8gdW5pdFRlc3REZWZhdWx0cygpIDogY3VzdG9tRmxhdm9yVGVzdERlZmF1bHRzKGZsYXZvcik7XG5cbiAgY29uc3QgZ2xvYmFsU2V0dXAgPSBnZW5lcmF0ZVNjcmlwdCh7XG4gICAgc2NyaXB0OiAnc2V0dXAnLFxuICAgIGZsYXZvcixcbiAgICByb290RGlyLFxuICB9KTtcblxuICBjb25zdCBnbG9iYWxUZWFyZG93biA9IGdlbmVyYXRlU2NyaXB0KHtcbiAgICBzY3JpcHQ6ICd0ZWFyZG93bicsXG4gICAgZmxhdm9yLFxuICAgIHJvb3REaXIsXG4gIH0pO1xuXG4gIHByb2Nlc3MuZW52WydURVNUX0ZMQVZPUiddID0gZmxhdm9yO1xuXG4gIGNvbnN0IGplc3RDb25maWcgPSByZWFkSW5pdGlhbE9wdGlvbnModW5kZWZpbmVkLCB7XG4gICAgcGFja2FnZVJvb3RPckNvbmZpZzogcm9vdERpcixcbiAgICBwYXJlbnRDb25maWdEaXJuYW1lOiBwYXJlbnRSb290RGlyLFxuICAgIHJlYWRGcm9tQ3dkOiBmYWxzZSxcbiAgICBza2lwTXVsdGlwbGVDb25maWdFcnJvcjogdHJ1ZSxcbiAgfSk7XG5cbiAgY29uc3QgcmVzb2x2ZWRDb25maWcgPSAoYXdhaXQgamVzdENvbmZpZykuY29uZmlnO1xuXG4gIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAuLi5iYXNlQ29uZmlnLFxuICAgIC4uLmplc3RUcmFuc2Zvcm1Db25maWdQcm9wKGF3YWl0IHBsdWdpblJvb3QpLFxuICAgIC4uLnJlc29sdmVkQ29uZmlnLFxuICAgIGdsb2JhbFNldHVwOiBhd2FpdCBnbG9iYWxTZXR1cCxcbiAgICBnbG9iYWxUZWFyZG93bjogYXdhaXQgZ2xvYmFsVGVhcmRvd24sXG4gIH07XG5cbiAgcmV0dXJuIGNvbmZpZztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUplc3RDb25maWdGb3JTaW5nbGVQYWNrYWdlKHtcbiAgZmxhdm9yID0gJ3VuaXQnLFxuICByb290RGlyID0gcHJvY2Vzcy5jd2QoKSxcbn06IHtcbiAgZmxhdm9yOiBUZXN0Rmxhdm9yO1xuICByb290RGlyPzogc3RyaW5nO1xufSk6IFByb21pc2U8Q29uZmlnPiB7XG4gIHJldHVybiBhd2FpdCBjcmVhdGVDb25maWcoZmxhdm9yLCByb290RGlyKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUplc3RDb25maWdGb3JNb25vcmVwbyh7XG4gIGZsYXZvciA9ICd1bml0JyxcbiAgY3dkID0gcHJvY2Vzcy5jd2QoKSxcbn06IHtcbiAgZmxhdm9yOiBUZXN0Rmxhdm9yO1xuICBjd2Q6IHN0cmluZztcbn0pOiBQcm9taXNlPENvbmZpZz4ge1xuICBjb25zdCByZXBvQ29uZmlnID0gYXdhaXQgbG9hZFJlcG9zaXRvcnlDb25maWd1cmF0aW9uKCk7XG5cbiAgaWYgKHJlcG9Db25maWcudHlwZSA9PT0gJ3NpbmdsZS1wYWNrYWdlJykge1xuICAgIHJldHVybiBjcmVhdGVKZXN0Q29uZmlnRm9yU2luZ2xlUGFja2FnZSh7XG4gICAgICBmbGF2b3IsXG4gICAgICByb290RGlyOiByZXBvQ29uZmlnLnJvb3QsXG4gICAgfSk7XG4gIH1cblxuICBpZiAocmVwb0NvbmZpZy5yb290ICE9PSBjd2QpIHtcbiAgICByZXR1cm4gY3JlYXRlSmVzdENvbmZpZ0ZvclNpbmdsZVBhY2thZ2UoeyBmbGF2b3IsIHJvb3REaXI6IGN3ZCB9KTtcbiAgfVxuXG4gIGNvbnN0IHByb2plY3RzID0gKFxuICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgcmVwb0NvbmZpZy5wYWNrYWdlTG9jYXRpb25zLm1hcChhc3luYyAobG9jYXRpb24pID0+IHtcbiAgICAgICAgY29uc3QgYmFzZUNvbmZpZyA9IGNyZWF0ZUNvbmZpZyhmbGF2b3IsIGxvY2F0aW9uLCBjd2QpO1xuICAgICAgICBjb25zdCBwYWNrYWdlSnNvbiA9IHJlYWRQYWNrYWdlSnNvbihqb2luKGxvY2F0aW9uLCAncGFja2FnZS5qc29uJykpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIC4uLihhd2FpdCBiYXNlQ29uZmlnKSxcbiAgICAgICAgICByb290RGlyOiBsb2NhdGlvbixcbiAgICAgICAgICBkaXNwbGF5TmFtZTogKGF3YWl0IHBhY2thZ2VKc29uKS5uYW1lLFxuICAgICAgICB9O1xuICAgICAgfSlcbiAgICApXG4gICkuZmlsdGVyKEJvb2xlYW4pO1xuXG4gIGNvbnN0IHRlc3RUaW1lb3V0ID0gcHJvamVjdHMucmVkdWNlKFxuICAgIChhY2MsIHByb2plY3QpID0+XG4gICAgICBNYXRoLm1heChcbiAgICAgICAgYWNjLFxuICAgICAgICB0eXBlb2YgcHJvamVjdC50ZXN0VGltZW91dCA9PT0gJ251bWJlcicgPyBwcm9qZWN0LnRlc3RUaW1lb3V0IDogMFxuICAgICAgKSxcbiAgICAwXG4gICk7XG5cbiAgcmV0dXJuIHtcbiAgICAuLi4odGVzdFRpbWVvdXQgIT09IDAgJiYge1xuICAgICAgdGVzdFRpbWVvdXQsXG4gICAgfSksXG4gICAgcHJvamVjdHM6IHByb2plY3RzLm1hcChcbiAgICAgICh7IGNvdmVyYWdlRGlyZWN0b3J5LCB0ZXN0VGltZW91dCwgLi4ucHJvamVjdCB9KSA9PiBwcm9qZWN0XG4gICAgKSxcbiAgfTtcbn1cbiJdLCJuYW1lcyI6WyJwYXRoIiwicmVzdWx0Iiwic2NyaXB0IiwidGVzdFRpbWVvdXQiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7QUFBTyxTQUFTLFNBQ2QsS0FDeUIsRUFBQTtBQUN6QixFQUFBLE9BQU8sUUFBUSxL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
