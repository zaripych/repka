import type {
  Transformer,
  TransformerCreator,
  TransformOptions,
} from '@jest/transform';
import type {
  Loader,
  TransformOptions as EsbuildTransformOptions,
} from 'esbuild';
import { transform, transformSync } from 'esbuild';
import { basename, extname } from 'path';

const getExtensionAndPrefix = (filePath: string): string | undefined => {
  const regex = /\.[^.]+/g;

  const segments = [...basename(filePath).matchAll(regex)];

  if (segments.length > 0) {
    return segments.slice(-2).join('');
  } else {
    return undefined;
  }
};

type Config = Omit<EsbuildTransformOptions, 'loader' | 'sourcefile'> & {
  loadersByExtension?: {
    [extension: string]: Loader | undefined;
  };
};

type EsbuildTransform = Transformer<Config>;

const loaderByExt: Record<string, { loader: Loader }> = {
  ['.json']: { loader: 'json' },
  ['.js']: { loader: 'js' },
  ['.mjs']: { loader: 'js' },
  ['.cjs']: { loader: 'js' },
  ['.jsx']: { loader: 'jsx' },
  ['.ts']: { loader: 'ts' },
  ['.cts']: { loader: 'ts' },
  ['.mts']: { loader: 'ts' },
  ['.tsx']: { loader: 'tsx' },
};

const getOptions = (
  filename: string,
  options: TransformOptions<Config>,
  defaultOpts?: Config
) => {
  const prefix = getExtensionAndPrefix(filename);
  const ext = extname(filename);
  const transformerConfig = options.transformerConfig;

  const loaderFromOpts = prefix
    ? transformerConfig.loadersByExtension?.[prefix] ||
      transformerConfig.loadersByExtension?.[ext]
    : transformerConfig.loadersByExtension?.[ext];

  const loaderFromExt = loaderByExt[ext]?.loader;

  const loader = loaderFromOpts || loaderFromExt || 'text';

  const format = options.supportsStaticESM ? 'esm' : 'cjs';

  const esbuildOptions: EsbuildTransformOptions = {
    format,
    loader,
    target: `node${process.versions.node}`,
    platform: 'node',
    sourcemap: true,
    sourcesContent: false,
    sourcefile: filename,
    ...defaultOpts,
    ...transformerConfig,
  };

  return esbuildOptions;
};

const createTransformer: TransformerCreator<EsbuildTransform, Config> = (
  opts?: Config
) => {
  return {
    process: (content, filename, options) => {
      const esbuildOptions = getOptions(filename, options, opts);
      return transformSync(content, esbuildOptions);
    },
    processAsync: async (content, filename, options) => {
      const esbuildOptions = getOptions(filename, options, opts);
      return await transform(content, esbuildOptions);
    },
  };
};

const factory = {
  createTransformer,
};

export default factory;
