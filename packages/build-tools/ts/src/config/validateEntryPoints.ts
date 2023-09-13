import { basename, extname, isAbsolute, posix } from 'node:path';

import { escapeRegExp, hasOne } from '@utils/ts';
import fg from 'fast-glob';

import { logger } from '../logger/logger';
import { line } from '../markdown/line';
import type { PackageJsonExports } from '../package-json/packageJson';
import type { PackageExportsEntryPoint } from './nodePackageConfig';
import {
  isConditionsOnlyEntry,
  resolvePackageJsonExportEntry,
} from './resolvePackageJsonExportEntry';

const determineName = (key = 'main') => {
  const extension = extname(key);
  return key === '.'
    ? 'main'
    : [
        ...new Set(
          key
            .replace(extension, '')
            .replaceAll(/\.|\/|\*/g, '-')
            .replaceAll(/-+/g, '-')
            .replaceAll(/^-|-$/g, '')
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .toLowerCase()
            .split('-')
        ),
      ].join('-');
};

/**
 * @note
 * These are file extensions that we allow the glob
 * to match. Only these files can be bundled when we
 * use glob patterns in the "exports" field.
 */
const allowedExtensions = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.cts',
  '.mts',
];

function changeExtension(path: string, newExtension: string) {
  const ext = extname(path);
  if (!ext) {
    return path;
  }

  return path.replaceAll(
    new RegExp(escapeRegExp(extname(path)) + '$', 'g'),
    newExtension
  );
}

function outputPathFromSourcePath(sourcePath: string) {
  if (isAbsolute(sourcePath)) {
    throw new Error('Should use relative paths only');
  }

  const result = changeExtension(
    sourcePath.replace('./src/', './dist/'),
    '.js'
  );

  if (result.startsWith('./dist/')) {
    return result;
  }

  return './' + posix.join('./dist', result);
}

const resolveEntryPoints = async (
  opts: {
    results: Record<string, PackageExportsEntryPoint>;
    ignored: Record<string, PackageJsonExports>;
    exportEntry: Record<string, PackageJsonExports> | string;
    entryPoint?: string;
    packageDirectory: string;
    outputRootDirectory: string;
  },
  deps = {
    fg: (pattern: string) =>
      fg(pattern, {
        onlyFiles: true,
        cwd: opts.packageDirectory,
      }),
    warn: (message: string) => logger.warn(message),
  }
): Promise<void> => {
  const { results, ignored, exportEntry, entryPoint, outputRootDirectory } =
    opts;

  const chunkName = determineName(entryPoint);

  const addToIgnored = (warning?: string) => {
    if (entryPoint) {
      ignored[entryPoint] = exportEntry;
    } else {
      Object.assign(ignored, exportEntry);
    }

    if (warning) {
      deps.warn(warning);
    }
  };

  const addEntry = async (opts: {
    //
    sourcePath: string;
    outputPath: string;
  }) => {
    const { sourcePath, outputPath } = opts;

    if (sourcePath === './package.json') {
      addToIgnored();
      return;
    }

    if (outputPath.startsWith('./src/')) {
      addToIgnored(
        line`
          The "exports" entry "${entryPoint || '.'}" output path 
          "${outputPath}" points to the "./src/" directory. Ignoring. 
        `
      );
      return;
    }

    if (!outputPath.startsWith(outputRootDirectory)) {
      addToIgnored(
        line`
          The "exports" entry "${entryPoint || '.'}" output path 
          "${outputPath}" must start with "${outputRootDirectory}"
          directory. Ignoring. 
        `
      );
      return;
    }

    const isGlob = sourcePath.includes('*');

    const entries = isGlob ? await deps.fg(sourcePath) : [sourcePath];

    if (entries.length === 0) {
      addToIgnored(
        line`
          The "exports" entry "${entryPoint || '.'}" doesn't match 
          any files that can be bundled by the bundler. 
        `
      );
      return;
    }

    const allowedEntries = entries.filter((entry) =>
      allowedExtensions.includes(extname(entry))
    );

    const otherEntries = entries.filter(
      (entry) => !allowedExtensions.includes(extname(entry))
    );

    if (otherEntries.length > 0) {
      addToIgnored(
        line`
          The "exports" entry "${entryPoint || '.'}" matches 
          files that might fail to bundle:
        ` + ['', ...otherEntries].join('\n  - ')
      );
    }

    for (const globTarget of allowedEntries) {
      const globChunkName = isGlob
        ? determineName([chunkName, globTarget].join('-'))
        : chunkName;

      const resolvedOutputPath = isGlob
        ? './' +
          posix.join(
            changeExtension(outputPath, '')
              .replaceAll('*', '')
              .replaceAll(/\/+/g, '/')
              .replaceAll(/\/$/g, ''),
            changeExtension(basename(globTarget), '.js')
          )
        : changeExtension(outputPath, '.js');

      if (sourcePath === resolvedOutputPath) {
        addToIgnored(
          line`
            The "exports" entry "${entryPoint || '.'}" has both the input
            source file path and the output path resolve to the same file at
            "${resolvedOutputPath}". Ignoring. 
          `
        );
        break;
      }

      const conflicts = [...Object.values(results)].filter((result) => {
        return result.outputPath === resolvedOutputPath;
      });

      if (hasOne(conflicts)) {
        addToIgnored(
          line`
            The "exports" entry "${entryPoint || '.'}" resolves to 
            the same output path as another entry point 
            "${conflicts[0].entryPoint}". Ignoring. 
          `
        );
        break;
      }

      results[globChunkName] = {
        entryPoint: entryPoint || '.',
        sourcePath: globTarget,
        outputPath: resolvedOutputPath,
        chunkName: globChunkName,
      };
    }
  };

  if (typeof exportEntry === 'string') {
    await addEntry({
      sourcePath: exportEntry,
      outputPath: outputPathFromSourcePath(exportEntry),
    });
    return;
  }

  const sourcePath = resolvePackageJsonExportEntry(exportEntry, ['bundle']);

  if (!sourcePath) {
    addToIgnored();
    return;
  }

  const outputPathCandidate = resolvePackageJsonExportEntry(exportEntry, [
    'default',
  ]);

  const outputPath =
    !outputPathCandidate || outputPathCandidate === sourcePath
      ? outputPathFromSourcePath(sourcePath)
      : outputPathCandidate;

  await addEntry({
    sourcePath,
    outputPath,
  });
};

export async function validateEntryPoints(
  opts: {
    exportEntry: PackageJsonExports;
    packageDirectory: string;
  },
  deps = {
    fg: (pattern: string) =>
      fg(pattern, {
        onlyFiles: true,
        cwd: opts.packageDirectory,
      }),
    warn: (message: string) => logger.warn(message),
  }
) {
  const results: Record<string, PackageExportsEntryPoint> = {};
  const ignored: Record<string, PackageJsonExports> = {};

  if (!opts.exportEntry) {
    return {
      entryPoints: [],
      ignoredEntryPoints: ignored,
    };
  } else if (typeof opts.exportEntry === 'object') {
    if (isConditionsOnlyEntry(opts.exportEntry)) {
      await resolveEntryPoints(
        {
          results,
          ignored,
          exportEntry: opts.exportEntry,
          packageDirectory: opts.packageDirectory,
          outputRootDirectory: './dist/',
        },
        deps
      );
    } else {
      for (const [key, entry] of Object.entries(
        opts.exportEntry as Record<string, PackageJsonExports>
      )) {
        if (!entry) {
          ignored[key] = entry;
          continue;
        }

        if (typeof entry !== 'string' && typeof entry !== 'object') {
          ignored[key] = entry;
          deps.warn(
            line`
              Expected "string" or "object" as exports entry - got 
              "${String(entry)}"
            `
          );
          continue;
        }

        await resolveEntryPoints(
          {
            results,
            ignored,
            exportEntry: entry,
            entryPoint: key,
            packageDirectory: opts.packageDirectory,
            outputRootDirectory: './dist/',
          },
          deps
        );
      }
    }
  } else if (typeof opts.exportEntry === 'string') {
    await resolveEntryPoints(
      {
        results,
        ignored,
        exportEntry: opts.exportEntry,
        packageDirectory: opts.packageDirectory,
        outputRootDirectory: './dist/',
      },
      deps
    );
  }

  return {
    entryPoints: Object.values(results),
    ignoredEntryPoints: ignored,
  };
}
