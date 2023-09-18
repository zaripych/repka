export function line(template: TemplateStringsArray, ...values: unknown[]) {
  return String.raw({ raw: template }, ...values)
    .replaceAll(/\s*\n\s*/g, ' ')
    .trim();
}
