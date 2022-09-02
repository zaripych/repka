import fg from 'fast-glob';

const packages = () =>
  fg.sync('packages/*/*', {
    onlyDirectories: true,
  });

const lintPackages = () =>
  packages().reduce(
    (acc, pack) => ({
      ...acc,
      [`${pack}/**/*.(js|jsx|ts|tsx)`]: [
        `repka --cwd ${pack} lint`,
        `prettier --write`,
      ],
      [`${pack}/**/*.(yaml|yml|json)`]: `prettier --write`,
    }),
    {}
  );

function buildLintStagedConfig() {
  return {
    ...lintPackages(),
    './*.(js|mjs|cjs|ts|mts|cts|jsx|tsx|yaml|yml|json)': `prettier --write`,
  };
}

export default buildLintStagedConfig();
