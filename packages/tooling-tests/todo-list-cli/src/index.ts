import { enableSourceMapsSupport } from './enableSourceMapsSupport';

async function main() {
  enableSourceMapsSupport();
  const { run } = await import('./program');
  await run();
}

await main();
