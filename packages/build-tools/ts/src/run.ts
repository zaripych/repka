import pico from 'picocolors';

import { readCwdPackageJson } from './package-json/readPackageJson';

type Builder = () => Promise<void>;

declare global {
  namespace NodeJS {
    interface Process {
      setSourceMapsEnabled: (enabled: boolean) => void;
    }
  }
}

export async function run<Args extends [Builder, ...Builder[]]>(
  ...builders: Args
): Promise<void> {
  try {
    if ('setSourceMapsEnabled' in process) {
      process.setSourceMapsEnabled(true);
    }

    return await builders.reduce(
      (acc, builder) =>
        acc
          .then(() => builder())
          .catch(async (err: Error) => {
            console.error(
              pico.red(
                `\nERROR: Failed to ${builder.name} ${String(
                  (await readCwdPackageJson()).name
                )} ${err.message}`
              )
            );
            return Promise.reject(err);
          }),
      Promise.resolve()
    );
  } catch (err) {
    process.exitCode = 1;
  }
}
