module.exports = {
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  env: {
    es2022: true,
  },
  plugins: ['jest', 'import', 'simple-import-sort'],
  extends: ['eslint:recommended', 'prettier'],
  rules: {
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
  },
  overrides: [
    {
      files: ['**/*.cjs'],
      env: {
        node: true,
      },
    },
    {
      files: ['**/*.mjs'],
      env: {
        node: true,
      },
    },
  ],
};
