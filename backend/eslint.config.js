import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'

// ESLint 9 flat config. typescript-eslint's flat/recommended sets the parser
// and turns off the core rules that TypeScript already checks (no-undef, ...).
export default [
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs['flat/recommended'],
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Same convention as tsc (noUnusedLocals/noUnusedParameters): a leading
      // underscore marks a value that is unused on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // Existing debt (about 700 uses), reported as warnings until it is typed
      // (issue #73). New code must not add `any`.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
]
