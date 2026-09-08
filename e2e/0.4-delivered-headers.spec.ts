import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Task 0.4 — the app boots under the delivered headers with no CSP violation.
 *
 * The walking slice also watches for violations, but it attaches its listener
 * inside the test body, after navigation: it can see a policy broken by an
 * interaction and never one broken by a page load. That blind spot let Astro's
 * island shim stylesheet sit blocked on every load until a reload was added for
 * an unrelated reason ([ADR-0019](../docs/adr/0019-astro-island-styles-are-permitted.md)).
 *
 * So every assertion here is made on a load, with the listener attached first,
 * and the last one is about the page rather than the console: a directive the
 * framework outgrows should fail a test rather than quietly degrade a layout.
 */

/** Collect CSP refusals from the first byte of the navigation onward. */
function watchForViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/iu.test(message.text())) {
      violations.push(message.text());
    }
  });
  return violations;
}

test('the app route loads under its own policy with nothing refused', async ({ page }) => {
  const violations = watchForViolations(page);

  await page.goto('/app/');
  await expect(page.getByTestId('app')).toBeVisible();

  expect(violations).toEqual([]);
});

test('the marketing route loads under its own policy with nothing refused', async ({ page }) => {
  // It hydrates nothing (D2), so it is the control: a violation here is the
  // policy against Astro's static output, with no island involved.
  const violations = watchForViolations(page);

  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();

  expect(violations).toEqual([]);
});

test('Astro’s island shim is applied rather than merely unreported', async ({ page }) => {
  // The console is evidence about the policy; this is evidence about the page.
  // `display: contents` is what keeps <astro-island> from adding a box between
  // the app root and its children, and a blocked <style> leaves it `inline`.
  await page.goto('/app/');
  await expect(page.getByTestId('app')).toBeVisible();

  const display = await page
    .locator('astro-island')
    .evaluate((element) => getComputedStyle(element).display);

  expect(display).toBe('contents');
});
