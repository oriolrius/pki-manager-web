import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
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
      // Existing debt, reported as warnings until it is typed (issue #73).
      // New code must not add `any`.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Fast refresh hint for the Vite dev server only; it has no effect on the
      // build. Files that export a hook next to a provider stay as they are.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
])
