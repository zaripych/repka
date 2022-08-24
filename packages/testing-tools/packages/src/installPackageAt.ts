import { spawnOutputConditional } from '@build-tools/ts';
import { UnreachableError } from '@utils/ts';

export type SupportedPackageManagers = typeof supportedPackageManagers[number];

export const supportedPackageManagers = ['pnpm', 'npm', 'yarn'] as const;

export function isSupportedPackageManager(
  value: unknown
): value is SupportedPackageManagers {
  return supportedPackageManagers.includes(value as SupportedPackageManagers);
}

export async function installPackageAt(opts: {
  packageManager: 'pnpm' | 'npm' | 'yarn';
  directory: string;
}) {
  switch (opts.packageManager) {
    case 'pnpm':
      await spawnOutputConditional('pnpm', ['install'], {
        cwd: opts.directory,
        exitCodes: [0],
      });
      break;
    case 'npm':
      await spawnOutputConditional('npm', ['install', '--install-links'], {
        cwd: opts.directory,
        exitCodes: [0],
      });
      break;
    case 'yarn':
      await spawnOutputConditional('yarn', ['install'], {
        cwd: opts.directory,
        exitCodes: [0],
      });
      break;
    default:
      throw new UnreachableError(opts.packageManager);
  }
}

export async function linkPackageAt(opts: {
  packageManager: 'pnpm' | 'npm' | 'yarn';
  from: string;
  to: string;
  packageName: string;
}) {
  switch (opts.packageManager) {
    case 'pnpm':
      await spawnOutputConditional('pnpm', ['link', opts.from], {
        cwd: opts.to,
        exitCodes: [0],
      });
      break;
    case 'npm':
      await spawnOutputConditional('npm', ['link'], {
        cwd: opts.from,
        exitCodes: [0],
      });
      await spawnOutputConditional('npm', ['link', opts.packageName], {
        cwd: opts.to,
        exitCodes: [0],
      });
      break;
    case 'yarn':
      await spawnOutputConditional('yarn', ['link'], {
        cwd: opts.from,
        exitCodes: [0],
      });
      await spawnOutputConditional('yarn', ['link', opts.packageName], {
        cwd: opts.to,
        exitCodes: [0],
      });
      break;
    default:
      throw new UnreachableError(opts.packageManager);
  }
}
