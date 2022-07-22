import assert from 'assert';
import fg from 'fast-glob';
import { dirname, join } from 'path';

import { isTruthy } from './isTruthy';
import { onceAsync } from './onceAsync';

const getRepositoryRootScanCandidates = (currentDirectory: string) => {
  // having 'packages/*' in the root of a monorepo is super common
  const result = /(.*(?=\/packages\/))|(.*(?=\/node_modules\/))|(.*)/.exec(
    currentDirectory
  );
  assert(!!result);
  const [, packagesRoot, nodeModulesRoot] = result;
  return [packagesRoot, nodeModulesRoot].filter(isTruthy);
};

// returns the first directory which has monorepo markers, multiple
// directories can have them - whichever read first will be returned
// so if order is important - scanning should be separated to multiple jobs
// via prioritizedHasMonorepoMarkers
const hasRootMarkers = async (candidates: string[]) => {
  const markers = [
    '.git',
    'yarn.lock',
    'pnpm-lock.yaml',
    'package-lock.json',
    'pnpm-workspace.yaml',
  ];
  const markersStream = fg.stream(
    candidates.flatMap((dir) => markers.map((marker) => join(dir, marker))),
    {
      markDirectories: true,
      onlyFiles: false,
    }
  );
  return new Promise<string | undefined>((res) => {
    markersStream.on('data', (entry: string) => {
      res(dirname(entry));
      if ('destroy' in markersStream) {
        (markersStream as unknown as { destroy: () => void }).destroy();
      }
    });
    markersStream.on('end', () => {
      res(undefined);
    });
  });
};

const prioritizedHasMarkers = (jobs: string[][]) => {
  if (jobs.length === 0) {
    return Promise.resolve(undefined);
  }
  return new Promise<string | undefined>((res) => {
    const results = new Map<number, string | undefined>();

    const checkShouldComplete = (index: number, result: string | undefined) => {
      results.set(index, result);
      for (let i = 0; i < jobs.length; i += 1) {
        const hasResult = results.has(i);
        if (!hasResult) {
          // if a job with highest priority hasn't finished yet
          // then wait for it
          break;
        }
        const result = results.get(i);
        if (result) {
          // job finished and we found markers, also all jobs
          // with higher priority finished and they don't have
          // any markers - we are done
          res(result);
        }
      }
      if (results.size === jobs.length) {
        // all jobs finished - no markers found
        res(undefined);
      }
    };

    jobs.forEach((directories, index) => {
      hasRootMarkers(directories)
        .then((result) => {
          checkShouldComplete(index, result);
        })
        .catch(() => {
          // ignore
          return Promise.resolve(undefined);
        });
    });
  });
};

export const repositoryRootPathViaDirectoryScan = async (
  lookupDirectory: string
) => {
  const uniqueDirname = (path?: string) => {
    if (!path) {
      return;
    }
    const result = dirname(path);
    if (result === path) {
      // e.g. the path was already a root "/"
      return;
    }
    return result;
  };

  const parent = uniqueDirname(lookupDirectory);
  const superParent = uniqueDirname(parent);

  return (
    (await prioritizedHasMarkers(
      // scan in most likely locations first with current lookup directory taking priority
      [
        [lookupDirectory],
        getRepositoryRootScanCandidates(lookupDirectory),
        // scan 2 directories upwards
        [parent],
        [superParent],
      ]
        .map((dirs) => dirs.filter(isTruthy))
        .filter((job) => job.length > 0)
    )) || lookupDirectory /* fallback to current directory in worse scenario */
  );
};

/**
 * Determine repository root path by scanning current and parent directories
 * and looking for marker files/dirs like:
 *
 * - .git
 * - package-lock.json
 * - yarn.lock
 * - pnpm-lock.yaml
 * - pnpm-workspace.yaml
 */
export const repositoryRootPath = onceAsync(async () => {
  const rootPath = await repositoryRootPathViaDirectoryScan(process.cwd());
  return rootPath;
});
