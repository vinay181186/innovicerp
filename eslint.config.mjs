import { createRequire } from 'node:module';
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// React hook rules only apply to the web app, so the plugin is a devDependency
// of @innovic/web rather than of the workspace root. This config file lives at
// the root, so resolve the plugin from the web app's package instead of from
// here — a bare import would look in the root node_modules and fail.
const requireFromWeb = createRequire(new URL('./apps/web/package.json', import.meta.url));
const reactHooks = requireFromWeb('eslint-plugin-react-hooks');

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'legacy/**',
      'migration/_docx_extract/**',
      '**/*.d.ts',
      // Scratch / throwaway scripts follow the `_*` gitignore convention and
      // are never committed — don't lint them (e.g. ad-hoc smoke runners).
      '**/_*.ts',
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
  // React Hooks rules — web app only.
  //
  // rules-of-hooks is an ERROR on purpose. A conditional hook shipped on
  // 2026-08-25 and crashed the Machine detail page with React error #310 while
  // lint stayed green for a week; this is the rule that would have caught it.
  // The codebase is clean of violations today, so the error level costs nothing.
  //
  // exhaustive-deps is a WARN on purpose. It fires on effects that pre-date the
  // rule all over the app; making it an error would block every commit, and
  // fixing those effects is a separate, deliberate job.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
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
