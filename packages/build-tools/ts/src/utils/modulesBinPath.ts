export function modulesBinPath(bin: string) {
  return new URL(`../../node_modules/.bin/${bin}`, import.meta.url).pathname;
}
