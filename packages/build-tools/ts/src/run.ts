import pico from 'picocolors';

import { readCwdPackageJson } from './package-json/readPackageJson';
import { enableSourceMapsSupport } from './utils/enableSourceMapsSupport';

type Builder = () => Promise<void>;

export async function run<Args extends [Builder, ...Builder[]]>(
  ...builders: Args
): Promise<void> {
  try {
    enableSourceMapsSupport();

    return await builders.reduce(
      (acc, builder) =>
        acc
          .then(() => builder())
          .catch(async (err: Error) => {
            console.error(err);
            console.error(
              pico.red(
                `\nERROR: Failed to ${builder.name} ${String(
                  (await readCwdPackageJson()).name
                )} "${err.message}"`
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
