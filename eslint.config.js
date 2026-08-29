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
  { ignores: ['dist/**', '.astro/**', 'coverage/**', 'public/ocr/**', 'pnpm-lock.yaml'] },

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
    // GitHub Actions uses empty mapping values idiomatically (`on: pull_request:`
    // means "all activity types, all branches"). Giving them a value to satisfy
    // the linter would change the workflow to say something it does not mean.
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

  // D1a seam guard: the "no module outside io/ may import the extraction runtime"
  // rule from Architecture, enforced mechanically instead of by review.
  {
    files: ['src/domain/**/*.ts', 'src/ui/**/*.{ts,tsx}', 'src/pages/**/*.astro'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['pdfjs-dist*', 'onnxruntime-web*', 'tesseract.js*'] },
      ],
    },
  },

  // Style-attribute guard — see "Astro component styles". Since ADR-0008 the
  // CSP permits style attributes, so this enforces the convention rather than
  // a hard constraint: waive it per-line with an eslint-disable comment that
  // says why.
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
