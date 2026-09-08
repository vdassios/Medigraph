import { expect, test } from '@playwright/test';

/**
 * Task 4.6 — three routes, one of them interactive.
 *
 * What these guard is the shape of the site rather than its words: exactly one
 * island where the transaction lives, none on the pages that only read, and
 * both languages present on the routes that ship no JavaScript to switch
 * between them. What the copy may not say is asserted in `i18n.test.ts`, where
 * the table can be read as data.
 */

test('the app route hydrates exactly one island', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.getByTestId('app')).toBeVisible();

  await expect(page.locator('astro-island')).toHaveCount(1);
});

for (const route of ['/', '/privacy/']) {
  test(`${route} hydrates nothing at all`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('body')).toBeVisible();

    await expect(page.locator('astro-island')).toHaveCount(0);
    // Both languages are on the page, each in its own voice, because a toggle
    // would need the JavaScript these routes deliberately do not ship.
    await expect(page.locator('[lang="el"]').first()).toBeVisible();
    await expect(page.locator('[lang="en"]').first()).toBeVisible();
  });
}

test('the app follows the language the reader chooses, and remembers it', async ({ page }) => {
  await page.goto('/app/');
  const app = page.getByTestId('app');
  await expect(app).toHaveAttribute('lang', 'en');

  await page.getByTestId('switch-language').click();
  await expect(app).toHaveAttribute('lang', 'el');
  await expect(page.getByTestId('attach-instructions')).toContainText('myhealth.gov.gr');

  // The choice is the only thing this product keeps in localStorage.
  const stored = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(globalThis.localStorage).map((key) => [
        key,
        globalThis.localStorage.getItem(key),
      ]),
    ),
  );
  expect(stored).toEqual({ 'medigraph:language': 'el' });

  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('lang', 'el');
});
