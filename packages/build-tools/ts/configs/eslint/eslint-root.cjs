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
      files: ['**/*.test.ts', '**/*.test.tsx'],
      env: {
        jest: true,
      },
    },
    {
      files: ['**/*.json', '*.json'],
      extends: ['./eslint-json.cjs'],
    },
  ],
};
