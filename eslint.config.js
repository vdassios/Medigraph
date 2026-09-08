// Flat config. Order matters — see "Execution order and conflict resolution".
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import html from '@html-eslint/eslint-plugin';
import yml from 'eslint-plugin-yml';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
  {
    ignores: [
      'dist/**',
      '.astro/**',
      'coverage/**',
      'public/ocr/**',
      'public/pdf/**',
      'pnpm-lock.yaml',
      // Playwright writes these on a failed run. They are gitignored, and
      // linting a generated trace report only ever fails the next lint.
      'test-results/**',
      'playwright-report/**',
    ],
  },

  // Scoped to code files. Applied unscoped, these also match .json/.md/.yaml,
  // whose languages provide no getAllComments() and crash core rules.
  { files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'], extends: [js.configs.recommended] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.browser,
    },
  },

  // Build-time scripts and the end-to-end static server run in Node, not the
  // browser.
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs'],
    languageOptions: { globals: globals.nodeBuiltin, sourceType: 'module' },
  },

  // Playwright specs and config are Node too, and are not shipped.
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { globals: globals.nodeBuiltin },
  },

  // The service worker runs in its own global scope, not the window's: `self`,
  // `caches`, `clients` and `skipWaiting` exist there and nowhere else.
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker, sourceType: 'script' },
  },

  // Preact island only.
  { files: ['src/ui/**/*.tsx'], extends: [reactHooks.configs.flat.recommended] },
  { files: ['src/ui/**/*.tsx'], extends: [jsxA11y.flatConfigs.recommended] },

  astro.configs.recommended,
  astro.configs['jsx-a11y-recommended'],

  { files: ['**/*.json'], plugins: { json }, language: 'json/json', extends: ['json/recommended'] },
  {
    files: ['**/*.jsonc', 'tsconfig*.json', '.vscode/*.json'],
    plugins: { json },
    language: 'json/jsonc',
    extends: ['json/recommended'],
  },
  { files: ['**/*.md'], plugins: { markdown }, extends: ['markdown/recommended'] },
  yml.configs.recommended,
  {
    files: ['.github/workflows/*.{yml,yaml}'],
    rules: { 'yml/no-empty-mapping-value': 'off' },
  },
  {
    files: ['**/*.html'],
    plugins: { html },
    language: 'html/html',
    extends: ['html/recommended'],
    rules: { 'html/no-inline-styles': 'error' },
  },
  {
    files: ['src/**/*.{astro,tsx,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            "Prefer a class in the component's <style> block, an SVG presentation " +
            'attribute, or a CSS custom property set via CSSOM. If an inline style ' +
            'is genuinely the better fit, waive this line with an eslint-disable ' +
            'comment stating why.',
        },
      ],
    },
  },

  // MUST BE LAST.
  prettier,
]);
