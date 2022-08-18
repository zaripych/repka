import { spawn } from 'node:child_process';

import { spawnOutput } from '../child-process';
import { disableGlow, isGlowEnabled } from './isGlowEnabled';

function fallbackFormat(input: string) {
  return input;
}

export const glowFormat_defaultDeps = {
  isGlowEnabled,
  disableGlow,
  fallbackFormat,
};

export async function glowFormat(
  {
    input,
    style = 'auto',
    command = 'glow',
    args,
  }: {
    input: string;
    style?: 'auto' | 'dark' | 'light' | 'drakula' | 'notty';
    command?: string;
    args?: string[];
  },
  depsRaw?: Partial<typeof glowFormat_defaultDeps>
) {
  const deps = { ...glowFormat_defaultDeps, ...depsRaw };
  const glowEnabled = deps.isGlowEnabled();
  if (!glowEnabled) {
    return deps.fallbackFormat(input);
  }

  const child = spawn(command, args ?? ['-', '-s', style], {
    stdio: 'pipe',
  });

  child.stdin.setDefaultEncoding('utf-8');

  const writeToStdin = () =>
    new Promise<void>((res, rej) => {
      child.stdin.write(input, (err) => {
        if (err) {
          rej(err);
        } else {
          child.stdin.end(res);
        }
      });
    });

  const [result] = await Promise.all([
    spawnOutput(child, {
      exitCodes: [0],
    }),
    writeToStdin(),
  ]).catch(() => {
    deps.disableGlow();
    return [deps.fallbackFormat(input)];
  });

  return result;
}
