import { spawnOutputConditional } from '@build-tools/ts';
import { UnreachableError } from '@utils/ts';

export type SupportedPackageManagers = typeof supportedPackageManagers[number];

export const supportedPackageManagers = ['pnpm', 'npm', 'yarn'] as const;

export function isSupportedPackageManager(
  value: unknown
): value is SupportedPackageManagers {
  return supportedPackageManagers.includes(value as SupportedPackageManagers);
}

export async function installPackage(opts: {
  packageManager: 'pnpm' | 'npm' | 'yarn';
  directory: string;
}) {
  switch (opts.packageManager) {
    case 'pnpm':
      await spawnOutputConditional(
        'pnpm',
        ['install', '--virtual-store-dir', '../.pnpm'],
        {
          cwd: opts.directory,
          exitCodes: [0],
        }
      );
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
