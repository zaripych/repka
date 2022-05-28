import fg from 'fast-glob';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export async function copyFiles({
  sourceDirectory,
  globs,
  destination,
}: {
  sourceDirectory: string;
  globs: string[];
  destination: string;
}) {
  const entries = await fg(globs.map((glob) => `${sourceDirectory}/${glob}`));
  const createdDirs = new Set<string>();
  for (const sourcePath of entries) {
    const relativePath = relative(sourceDirectory, sourcePath);
    const targetPath = join(destination, relativePath);
    const targetDirectory = dirname(targetPath);
    if (!createdDirs.has(targetDirectory)) {
      await mkdir(targetDirectory, {
        recursive: true,
      });
      createdDirs.add(targetDirectory);
    }
    await copyFile(sourcePath, targetPath);
  }
}
