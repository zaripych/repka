import fg from 'fast-glob';
import { relative } from 'node:path';

const packages = () =>
  fg.sync('packages/*/*', {
    onlyDirectories: true,
  });

const slicesByTotalLength = (arr, totalMaxLength = 65000) => {
  const { results } = arr.reduce(
    (acc, path, idx) => {
      if (path.length + acc.totalLength > totalMaxLength) {
        acc.results.push(arr.slice(acc.start, idx));
        acc.start = idx;
        acc.totalLength = path.length;
      } else {
        acc.totalLength += path.length;
      }
      if (idx === arr.length - 1) {
        acc.results.push(arr.slice(acc.start));
        return acc;
      }
      return acc;
    },
    {
      start: 0,
      totalLength: 0,
      results: [],
    }
  );
  return results;
};

const ESLINT_MAX_FILES = 50; /* number of files before we fallback to all */

const PRETTIER_MAX_ARGS_LENGTH = 65000;

const eslintEnabled = () => true;

const eslintCommand = (filenames, pack) => {
  if (!eslintEnabled()) {
    return [];
  }
  const files = filenames.map((file) => relative(pack, file)).join(' ');
  return [
    filenames.length < ESLINT_MAX_FILES
      ? `pnpm -C ${pack} lint ${files}`
      : `pnpm -C ${pack} lint`,
  ];
};

const prettierCommand = (filenames) => {
  return slicesByTotalLength(
    filenames.map((file) => relative(process.cwd(), file)),
    PRETTIER_MAX_ARGS_LENGTH
  ).map((slice) => `prettier --write ${slice.join(' ')}`);
};

const packageLevelCommands = (filenames, pack) => {
  return [...eslintCommand(filenames, pack), ...prettierCommand(filenames)];
};

const lintPackages = () =>
  packages().reduce(
    (acc, pack) => ({
      ...acc,
      [`${pack}/**/*.(js|jsx|ts|tsx)`]: (filenames) =>
        packageLevelCommands(filenames, pack),
      [`${pack}/**/*.(yaml|yml|json)`]: (filenames) =>
        prettierCommand(filenames),
    }),
    {}
  );

function buildLintStagedConfig() {
  return {
    ...lintPackages(),
    './*.(js|mjs|cjs|ts|mts|cts|jsx|tsx|yaml|yml|json)': (filenames) =>
      prettierCommand(filenames),
  };
}

export default buildLintStagedConfig();
