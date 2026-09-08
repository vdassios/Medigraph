import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Task 5.3 — what ships, and under what policy.
 *
 * The weight of the initial download is measured by
 * `scripts/check-bundle-budget.mjs`, which can read the built files directly.
 * What needs a browser is the other half: that the heavy chunk is fetched only
 * when a document is attached, and that the policy the app is actually served
 * under is the one committed in `public/_headers`, byte for byte.
 */

const AHFY = 'fixtures/seed/ahfy-minimal.pdf';

/** The `/*` policy as committed. There is no generated hash list (ADR-0016). */
function committedPolicy(): string {
  const headers = readFileSync('public/_headers', 'utf8');
  const line = headers
    .split('\n')
    .map((each) => each.trim())
    .find((each) => each.startsWith('Content-Security-Policy:'));

  if (line === undefined) {
    throw new Error('public/_headers carries no Content-Security-Policy');
  }

  return line.slice('Content-Security-Policy:'.length).trim();
}

test('the app is served the policy this repository commits, byte for byte', async ({ page }) => {
  const response = await page.goto('/app/');
  const served = response?.headers()['content-security-policy'];

  expect(served).toBe(committedPolicy());
  // The point of a committed string: nothing in the build may edit it, and no
  // hash of any script appears in it.
  expect(served).not.toMatch(/sha256-|sha384-|sha512-/u);
});

test('pdf.js is absent until a document needs it, then fetched on its own path', async ({
  page,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => {
    requested.push(new URL(request.url()).pathname);
  });

  await page.goto('/app/');
  await expect(page.getByTestId('attach')).toBeVisible();

  const isPdfChunk = (path: string): boolean => path.includes('pdf');
  expect(requested.filter(isPdfChunk)).toEqual([]);

  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();

  // Now it is here — the chunk and the worker both, fetched from this origin.
  expect(requested.filter(isPdfChunk).length).toBeGreaterThan(0);
  expect(requested.filter(isPdfChunk).every((path) => path.startsWith('/'))).toBe(true);
});

test('every asset the app loads is served from this origin', async ({ page }) => {
  // Not a privacy assertion — contacting an origin is not a violation
  // (ADR-0015) — but a statement about what v1 actually ships: every browser
  // byte is self-hosted, which is what makes the committed `connect-src 'self'`
  // policy sufficient rather than aspirational.
  const external: string[] = [];
  const origin = new URL(test.info().project.use.baseURL ?? '').origin;
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      external.push(request.url());
    }
  });

  await page.goto('/app/');
  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();

  expect(external).toEqual([]);
});
