import { spawnOutputConditional } from '@build-tools/ts';
import { UnreachableError } from '@utils/ts';
import { copyFile } from 'fs/promises';
import { join } from 'path';

import { repositoryRootPath } from './helpers/repositoryRootPath';

export type SupportedPackageManagers =
  (typeof supportedPackageManagers)[number];

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
      {
        const rootDir = await repositoryRootPath();
        await copyFile(
          join(rootDir, 'pnpm-lock.yaml'),
          join(opts.directory, 'pnpm-lock.yaml')
        );
        await spawnOutputConditional('pnpm', ['fetch'], {
          cwd: opts.directory,
          exitCodes: [0],
          // NOTE: No way not to use the shell as pnpm is not
          // our direct dependency
          shell: process.platform === 'win32',
        });
        await spawnOutputConditional(
          'pnpm',
          ['install', '--prefer-offline', '--no-frozen-lockfile'],
          {
            cwd: opts.directory,
            exitCodes: [0],
            // NOTE: No way not to use the shell as pnpm is not
            // our direct dependency
            shell: process.platform === 'win32',
          }
        );
      }
      break;
    case 'npm':
      await spawnOutputConditional('npm', ['install', '--install-links'], {
        cwd: opts.directory,
        exitCodes: [0],
        // NOTE: No way not to use the shell as npm is not
        // our direct dependency
        shell: process.platform === 'win32',
      });
      break;
    case 'yarn':
      await spawnOutputConditional('yarn', ['install'], {
        cwd: opts.directory,
        exitCodes: [0],
        // NOTE: No way not to use the shell as yarn is not
        // our direct dependency
        shell: process.platform === 'win32',
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
        shell: process.platform === 'win32',
      });
      break;
    case 'npm':
      await spawnOutputConditional('npm', ['link'], {
        cwd: opts.from,
        exitCodes: [0],
        shell: process.platform === 'win32',
      });
      await spawnOutputConditional('npm', ['link', opts.packageName], {
        cwd: opts.to,
        exitCodes: [0],
        shell: process.platform === 'win32',
      });
      break;
    case 'yarn':
      await spawnOutputConditional('yarn', ['link'], {
        cwd: opts.from,
        exitCodes: [0],
        shell: process.platform === 'win32',
      });
      await spawnOutputConditional('yarn', ['link', opts.packageName], {
        cwd: opts.to,
        exitCodes: [0],
        shell: process.platform === 'win32',
      });
      break;
    default:
      throw new UnreachableError(opts.packageManager);
  }
}
