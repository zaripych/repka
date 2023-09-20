import { eslint } from '../../../eslint/eslint';

export async function eslintFix(paths: string[]) {
  await eslint(['--no-eslintrc'].concat(paths));
}
