import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const EXPECTED = `
/*
  Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' blob: data:; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
`;

it('delivers exactly the headers Task 0.4 specifies', () => {
  const delivered = readFileSync('public/_headers', 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  expect(delivered.trim()).toBe(EXPECTED.trim());
});

it('never inlines component stylesheets, which style-src-elem would block', () => {
  expect(readFileSync('astro.config.mjs', 'utf8')).toMatch(/inlineStylesheets:\s*'never'/);
});
