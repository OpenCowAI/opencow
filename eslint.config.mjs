// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  // ── Global ignores ────────────────────────────────────────────────────────
  {
    ignores: [
      'dist/**',
      'out/**',
      'build/**',
      'node_modules/**',
      '.worktrees/**',
      '.claude/**',
      '.opencow-dev/**',
      'coverage/**',
      '*.config.{js,mjs,cjs,ts}',
      'scripts/**',
    ],
  },

  // ── Base JS recommended rules ─────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript recommended rules ──────────────────────────────────────────
  ...tseslint.configs.recommended,

  // ── Project-wide settings ─────────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // ── React Hooks — core rules (errors) ─────────────────────────────
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ── React Compiler rules — aspirational (warnings) ────────────────
      // These prepare the codebase for the React Compiler. Set to 'warn'
      // until the compiler is adopted; promote to 'error' then.
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',

      // ── TypeScript strictness ───────────────────────────────────────────
      // Ban explicit `any` — forces intentional typing
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused variables — allow underscore-prefixed (intentional ignores)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // ── Console discipline ──────────────────────────────────────────────
      // Disallow direct console.* calls — use createLogger() instead.
      // Allow console in logger implementation and dev-only scripts.
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // ── Code quality ────────────────────────────────────────────────────
      'no-debugger': 'error',
      // Note: no-duplicate-imports is disabled because it does not understand
      // TypeScript's `import type` syntax, causing false positives.
      // TypeScript's own isolatedModules + verbatimModuleSyntax handle this better.
      'no-duplicate-imports': 'off',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'object-shorthand': 'error',

      // ── TypeScript-specific relaxations for pragmatism ──────────────────
      // Allow non-null assertions (common in Electron IPC where we
      // know the shape is guaranteed by the typed channel).
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Allow empty functions (common in no-op callbacks)
      '@typescript-eslint/no-empty-function': 'off',
      // Allow require() in Electron main process (native module loading)
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ── Test files — relaxed rules ────────────────────────────────────────────
  {
    files: ['tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      // Tests frequently use any for mocking
      '@typescript-eslint/no-explicit-any': 'off',
      // Test files may use console for debugging
      'no-console': 'off',
      // Unused vars in test destructuring patterns
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // ── Logger implementation — allowed console usage ─────────────────────────
  {
    files: ['**/lib/logger.ts', '**/logger/**'],
    rules: {
      'no-console': 'off',
    },
  },

  // ── Prettier compatibility (must be last) ─────────────────────────────────
  eslintConfigPrettier,
)
