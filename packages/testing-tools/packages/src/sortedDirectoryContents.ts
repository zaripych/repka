import fg from 'fast-glob';

const compareStrings = (a: string, b: string) => (a === b ? 0 : a > b ? 1 : -1);

const comparePathComponents = (a: string[], b: string[]): 0 | 1 | -1 => {
  if (a.length === 0 && b.length === 0) {
    return 0;
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const i = compareStrings(a[0]!, b[0]!);
  if (i === 0) {
    return comparePathComponents(a.slice(1), b.slice(1));
  } else {
    return i;
  }
};

const seps = /\\|\//g;

const comparePaths = (a: string, b: string) => {
  const componentsA = a.split(seps);
  const componentsB = b.split(seps);
  const result = comparePathComponents(componentsA, componentsB);
  return result;
};

const sortPaths = (files: string[]) => {
  files.sort(comparePaths);
};

export const sortedDirectoryContents = async (
  directory: string,
  opts?: {
    include?: string[];
    exclude?: string[];
    defaultExcludes?: string[];
  }
) => {
  const {
    include = ['**'],
    defaultExcludes = ['node_modules/**', '.git/**'],
    exclude = [],
  } = opts ?? {};
  const results = await fg(include, {
    cwd: directory,
    unique: true,
    markDirectories: true,
    onlyDirectories: false,
    onlyFiles: false,
    dot: true,
    ignore: [...defaultExcludes, ...exclude],
  });

  sortPaths(results);

  return results;
};
