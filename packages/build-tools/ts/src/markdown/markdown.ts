import dedent from 'dedent';
import { $ } from 'kleur/colors';

import { glowFormat } from './glowFormat';
import { glowPrint } from './glowPrint';

export function markdown(
  template: TemplateStringsArray | { naughty: string; styled: string },
  ...values: unknown[]
) {
  if ('naughty' in template) {
    if ($.enabled) {
      return template.styled;
    } else {
      return template.naughty;
    }
  }
  return dedent(String.raw({ raw: template }, ...values));
}

export async function format(markdown: string, deps = { glowFormat }) {
  return await deps.glowFormat({
    input: markdown
      .replace(/^\s*/g, '')
      .replace(/^\n/g, '')
      .replace(/\n$/g, '')
      .trim(),
  });
}

export async function print(markdown: string, deps = { glowPrint }) {
  await deps.glowPrint({
    input: markdown
      .replace(/^\s*/g, '')
      .replace(/^\n/g, '')
      .replace(/\n$/g, '')
      .trim(),
  });
}
