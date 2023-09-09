#!/usr/bin/env tsx
import type { BundlerConfig } from '@build-tools/dts-bundle-generator';
import {
  enableNormalLog,
  enableVerbose,
} from '@build-tools/dts-bundle-generator';
import { generateAndSaveDtsBundle } from '@build-tools/dts-bundle-generator';

async function tryReadingConfigFromStdIn(): Promise<BundlerConfig | undefined> {
  if (process.stdin.isTTY) {
    return;
  }
  return new Promise<BundlerConfig | undefined>((res, rej) => {
    const buffer: string[] = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (data: string) => {
      buffer.push(data);
    });
    process.stdin.on('error', (err: unknown) => {
      rej(err);
    });
    process.stdin.on('end', () => {
      const text = buffer.join('');
      if (!text) {
        res(undefined);
      }
      try {
        res(JSON.parse(text) as BundlerConfig);
      } catch (err) {
        rej(err);
      }
    });
  });
}

async function run() {
  const config = await tryReadingConfigFromStdIn();
  if (!config) {
    throw new Error('Expected config to be passed via stdin');
  }
  if (process.env['DTS_LOG_LEVEL'] === 'debug') {
    enableVerbose();
  }
  if (process.env['DTS_LOG_LEVEL'] === 'info') {
    enableNormalLog();
  }
  generateAndSaveDtsBundle(config);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
