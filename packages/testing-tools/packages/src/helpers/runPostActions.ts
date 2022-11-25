import assert from 'node:assert';
import { dirname, isAbsolute, join } from 'node:path';

import type { CopyGlobOpts } from './copyFiles';
import { copyFiles } from './copyFiles';
import type { ReplaceTextOpts } from './replaceTextInFiles';
import { replaceTextInFiles } from './replaceTextInFiles';
import { transformPackageJsonInWorkspace } from './transformPackageJsonInWorkspace';

type OptionallyAsync<Props, T> =
  | T
  | Promise<T>
  | ((props: Props) => T | Promise<T>);

async function unwrap<Props, T extends OptionallyAsync<unknown, unknown>>(
  props: Props,
  value: T
): Promise<T extends OptionallyAsync<Props, infer U> ? U : never> {
  return (await Promise.resolve(
    typeof value === 'function' ? value(props) : value
  )) as T extends OptionallyAsync<Props, infer U> ? U : never;
}

export type PostActionsOpts<Props> = {
  copyFiles?: OptionallyAsync<
    Props,
    Array<Omit<CopyGlobOpts, 'destination'> & { destination?: string }>
  >;
  replaceTextInFiles?: OptionallyAsync<Props, Array<ReplaceTextOpts>>;
  packageJson?: (
    entries: Record<string, unknown>,
    packageJsonPath: string,
    props: Props
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
};

export async function runPostActions<Props>(
  props: Props,
  opts: {
    testFilePath: string;
    targetDirectory: string;
  } & PostActionsOpts<Props>
) {
  if (opts.copyFiles) {
    const copyFilesOpt = await unwrap(props, opts.copyFiles);
    assert(
      !copyFilesOpt.some(
        (opt) => opt.destination && isAbsolute(opt.destination)
      ),
      'destination copy paths cannot be absolute, please specify directory relative to the target directory'
    );
    await Promise.all(
      copyFilesOpt.map((copyOpts) =>
        copyFiles({
          ...copyOpts,
          source:
            copyOpts.source && !isAbsolute(copyOpts.source)
              ? join(dirname(opts.testFilePath), copyOpts.source)
              : copyOpts.source,
          destination: join(opts.targetDirectory, copyOpts.destination || './'),
        })
      )
    );
  }

  if (opts.replaceTextInFiles) {
    const replaceTextInFilesOpt = await unwrap(props, opts.replaceTextInFiles);
    assert(
      !replaceTextInFilesOpt.some(
        (opt) => opt.target && isAbsolute(opt.target)
      ),
      'replace target paths cannot be absolute, please specify directory relative to the target directory'
    );
    await Promise.all(
      replaceTextInFilesOpt.map((replaceOpts) =>
        replaceTextInFiles({
          ...replaceOpts,
          target: join(opts.targetDirectory, replaceOpts.target || './'),
        })
      )
    );
  }
  if (opts.packageJson) {
    const packageJson = opts.packageJson;
    await transformPackageJsonInWorkspace({
      directory: opts.targetDirectory,
      packageJson: (entries, path) => {
        return packageJson(entries, path, props);
      },
    });
  }
}
