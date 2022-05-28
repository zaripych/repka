import pico from 'picocolors';

import { readCwdPackageJson } from './package-json/readPackageJson';

type Builder = () => Promise<void>;

export async function run<Args extends [Builder, ...Builder[]]>(
  ...builders: Args
): Promise<void> {
  try {
    return await builders.reduce(
      (acc, builder) =>
        acc
          .then(() => builder())
          .catch(async (err: Error) => {
            console.error(
              pico.red(
                `\nERROR: Failed to ${builder.name} ${
                  (await readCwdPackageJson()).name
                } ${err.message}`
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
