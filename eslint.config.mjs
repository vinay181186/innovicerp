import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'legacy/**',
      'migration/_docx_extract/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  // Operational CLI scripts (seeds, one-shot migrations, ops utilities) log human-readable
  // progress to a terminal — Pino is for the runtime API per CLAUDE.md §6.7, not for these.
  {
    files: [
      '**/db/seed.ts',
      '**/db/apply-sql.ts',
      '**/scripts/**/*.{ts,tsx}',
      'migration/**/*.{ts,tsx}',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  prettierConfig,
);
