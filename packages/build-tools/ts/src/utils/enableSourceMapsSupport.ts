export function enableSourceMapsSupport() {
  if ('setSourceMapsEnabled' in process) {
    process.setSourceMapsEnabled(true);
  }
}
