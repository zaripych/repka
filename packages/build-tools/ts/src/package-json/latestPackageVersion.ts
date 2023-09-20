import { spawnResult } from '../child-process/index';
import type { JsonType } from './packageJson';

async function npmInfo(name: string) {
  const { status, stdout, stderr } = await spawnResult(
    'npm',
    ['info', name, '--json'],
    {
      exitCodes: 'any',
    }
  );
  if (status !== 0) {
    throw new Error(
      `Could not determine version of the package "${name}": ${stderr}`
    );
  }
  const result = JSON.parse(stdout) as JsonType;
  return result;
}

export async function latestPackageVersion(name: string) {
  const result = await npmInfo(name);
  if (typeof result !== 'object' || !result) {
    throw new Error(
      'Expected an object response from "npm" process, got something else'
    );
  }
  const distTags = result['dist-tags'];
  if (typeof distTags !== 'object' || !distTags) {
    throw new Error(
      `Expected .["dist-tags"] in the "npm" process response to be an object, got ${typeof distTags}`
    );
  }
  const latest = distTags['latest'];
  if (typeof latest !== 'string' || !latest) {
    throw new Error(
      `Expected .["dist-tags"] in the "npm" process response to be an object, got ${typeof distTags}`
    );
  }
  return latest;
}

export async function isPackageVersionValid(name: string, version: string) {
  const result = await npmInfo(name);
  if (typeof result !== 'object' || !result) {
    throw new Error(
      'Expected an object response from "npm" process, got something else'
    );
  }

  const versions = result['versions'];
  if (!Array.isArray(versions)) {
    throw new Error(
      `Expected .["versions"] in the "npm" process response to be an array, got ${typeof versions}`
    );
  }

  return versions.includes(version);
}
