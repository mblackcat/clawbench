import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// Minimal, correctness-focused config. The codebase predates linting, so
// stylistic and any-related rules stay off for now — tighten incrementally.
export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'out/**', 'build/**', 'python-sdk/**', '*.config.*']
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks
    },
    rules: {
      // React hooks correctness — the highest-signal rules for this codebase
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Catch genuinely dangerous patterns
      'no-debugger': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-sparse-arrays': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-async-promise-executor': 'error',
      'no-compare-neg-zero': 'error',
      'no-cond-assign': 'error',
      '@typescript-eslint/no-misused-new': 'error'
    }
  }
)
