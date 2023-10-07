const { syncEslintConfigHelpers } = require('./eslintConfigHelpers.gen.cjs');

module.exports = {
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  env: {
    es2022: true,
  },
  plugins: ['jest', 'import', 'simple-import-sort', 'unicorn'],
  extends: ['eslint:recommended', 'prettier'],
  rules: {
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    'unicorn/template-indent': [
      'error',
      {
        tags: ['line', 'dedent', 'markdown'],
        functions: ['dedent', 'line', 'markdown'],
        selectors: [],
        comments: [],
        indent: syncEslintConfigHelpers().indent,
      },
    ],
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
