module.exports = {
  ignorePatterns: ['.tsc-out', 'dist'],
  overrides: [
    {
      files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.jsx'],
      extends: ['./eslint-js.cjs'],
    },
    {
      files: ['**/*.ts', '**/*.tsx'],
      extends: ['./eslint-ts.cjs'],
    },
    {
      files: ['**/*.json', '*.json'],
      extends: ['./eslint-json.cjs'],
    },
  ],
};
