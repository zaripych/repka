import { eslint } from '../../eslint/eslint';

export async function eslintFix(path: string) {
  await eslint([path]);
}
