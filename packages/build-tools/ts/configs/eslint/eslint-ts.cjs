const { syncEslintConfigHelpers } = require('./eslintConfigHelpers.gen.cjs');
/**
 * Switch this to `false` if linting takes too long
 */
const tsEnabled = () => true;

module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: tsEnabled()
    ? {
        tsconfigRootDir: syncEslintConfigHelpers().monorepoRootPath,
        project: [
          ...syncEslintConfigHelpers().tsConfigGlobs,
          './tsconfig.eslint.json',
        ],
        EXPERIMENTAL_useSourceOfProjectReferenceRedirect: true,
      }
    : {
        project: null,
      },
  settings: {
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx', '.d.ts'],
    },
    'import/resolver': {
      typescript: {},
    },
  },
  plugins: ['@typescript-eslint', 'jest', 'import', 'simple-import-sort'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    tsEnabled() &&
      'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ].filter(Boolean),
  rules: {
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-namespace': [
      'error',
      {
        allowDeclarations: true,
      },
    ],
    'no-unused-expressions': [
      'error',
      {
        allowShortCircuit: true,
        allowTernary: true,
        allowTaggedTemplates: true,
      },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        ignoreRestSiblings: true,
        argsIgnorePattern: '_.*',
      },
    ],
    ...(tsEnabled() && {
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        {
          allowConstantLoopConditions: true,
        },
      ],
    }),
  },
};
