// This file is bundled up from './src/*' and needs to be committed
import { transformSync, transform } from 'esbuild';
import { extname, basename } from 'node:path';

const getExtensionAndPrefix = (filePath) => {
  const regex = /\.[^.]+/g;
  const segments = [...basename(filePath).matchAll(regex)];
  if (segments.length > 0) {
    return segments.slice(-2).join("");
  } else {
    return void 0;
  }
};
const loaderByExt = {
  [".json"]: { loader: "json" },
  [".js"]: { loader: "js" },
  [".mjs"]: { loader: "js" },
  [".cjs"]: { loader: "js" },
  [".jsx"]: { loader: "jsx" },
  [".ts"]: { loader: "ts" },
  [".cts"]: { loader: "ts" },
  [".mts"]: { loader: "ts" },
  [".tsx"]: { loader: "tsx" }
};
const getOptions = (filename, options, defaultOpts) => {
  var _a, _b, _c, _d;
  const prefix = getExtensionAndPrefix(filename);
  const ext = extname(filename);
  const transformerConfig = options.transformerConfig;
  const loaderFromOpts = prefix ? ((_a = transformerConfig.loadersByExtension) == null ? void 0 : _a[prefix]) || ((_b = transformerConfig.loadersByExtension) == null ? void 0 : _b[ext]) : (_c = transformerConfig.loadersByExtension) == null ? void 0 : _c[ext];
  const loaderFromExt = (_d = loaderByExt[ext]) == null ? void 0 : _d.loader;
  const loader = loaderFromOpts || loaderFromExt || "text";
  const format = options.supportsStaticESM ? "esm" : "cjs";
  const esbuildOptions = {
    format,
    loader,
    target: `node${process.versions.node}`,
    platform: "node",
    sourcemap: true,
    sourcesContent: false,
    sourcefile: filename,
    ...defaultOpts,
    ...transformerConfig
  };
  return esbuildOptions;
};
const createTransformer = (opts) => {
  return {
    process: (content, filename, options) => {
      const esbuildOptions = getOptions(filename, options, opts);
      return transformSync(content, esbuildOptions);
    },
    processAsync: async (content, filename, options) => {
      const esbuildOptions = getOptions(filename, options, opts);
      return await transform(content, esbuildOptions);
    }
  };
};
const factory = {
  createTransformer
};
var esbuildJestTransform_default = factory;

export { esbuildJestTransform_default as default };
