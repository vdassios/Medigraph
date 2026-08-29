// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// D2: static output only — no adapter, no SSR, no Workers.
export default defineConfig({
  output: 'static',
  integrations: [preact()],
  build: {
    // D1/Task 0.4: component <style> blocks must always emit as external
    // 'self' stylesheets so the CSP never needs a style hash.
    inlineStylesheets: 'never',
  },
});
