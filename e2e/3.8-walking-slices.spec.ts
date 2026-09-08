import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Task 3.8 — the E0 walking slice.
 *
 * Two documents, end to end through the real build under the real
 * Content-Security-Policy: one synthetic ΑΗΦΥ document that must cross every
 * stage, and one PDF Pass V must reject at its own source without taking the
 * batch down with it. There is no test-only adapter and no seam opened for the
 * tests — everything here goes through the file input a user would use.
 *
 * What it is really guarding is the *order*: that nothing is persisted or
 * charted before Confirm, that Confirm is unreachable while any gate is open,
 * and that the evidence a review was reading is gone once it ends.
 */

const AHFY = 'fixtures/seed/ahfy-minimal.pdf';
const NOT_AHFY = 'fixtures/seed/not-ahfy.pdf';

/** The Profile the browser has actually written, read from IndexedDB itself. */
async function storedProfile(page: Page): Promise<unknown> {
  return page.evaluate(
    async () =>
      new Promise((resolve, reject) => {
        // Opening a database that does not exist creates it — an empty one,
        // with none of the app's stores — and the next real open would find a
        // current version with nothing in it. An inspection must not create
        // what it is inspecting, so one that did is deleted again.
        const open = indexedDB.open('medigraph');
        let created = false;
        open.onupgradeneeded = () => {
          created = true;
        };
        open.onerror = () => {
          reject(new Error('indexeddb open failed'));
        };
        open.onsuccess = () => {
          const db = open.result;
          if (created || !db.objectStoreNames.contains('profile')) {
            db.close();
            if (created) {
              indexedDB.deleteDatabase('medigraph');
            }
            resolve(null);
            return;
          }
          {
            const read = db.transaction('profile').objectStore('profile').get('current');
            read.onsuccess = () => {
              resolve(read.result ?? null);
            };
            read.onerror = () => {
              reject(new Error('indexeddb read failed'));
            };
          }
        };
      }),
  );
}

/** Answer every gate D6 and D7 raise, one click each, in any order. */
async function answerEveryGate(page: Page): Promise<void> {
  for (const testId of ['confirm-date', 'redact-identifier', 'approve-unknown']) {
    for (;;) {
      const control = page.getByTestId(testId).first();
      if ((await control.count()) === 0 || !(await control.isEnabled())) {
        break;
      }
      await control.click();
    }
  }

  for (;;) {
    const conflict = page.locator('[data-testid^="resolve-conflict-"]').first();
    if ((await conflict.count()) === 0) {
      break;
    }
    await conflict.click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('medigraph');
  });
  await page.reload();
});

test('an ΑΗΦΥ document crosses attach, review, Confirm, storage, chart and export', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/iu.test(message.text())) {
      violations.push(message.text());
    }
  });

  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'idle');
  await page.getByTestId('attach').setInputFiles(AHFY);

  // Review: the batch extracted, and nothing has been written or drawn.
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('review')).toHaveAttribute('data-registry-version', /^\d+$/u);
  await expect(page.getByTestId('panel')).toHaveCount(0);
  expect(await storedProfile(page)).toBeNull();

  // The island resolves a row's SourceRef through the evidence it is holding
  // for this batch — the map it releases when the transaction ends. Since Task
  // 4.2 the crop opens beside the row that asked for it, so the assertion asks
  // for it too rather than expecting it on screen unbidden — and since 4.2a a
  // document this clean has every row behind the pre-accepted disclosure.
  const preAccepted = page.getByTestId('pre-accepted');
  if ((await preAccepted.count()) > 0) {
    await preAccepted.locator('summary').click();
  }
  await page.getByTestId('inspect-source').first().click();
  await expect(page.getByTestId('evidence').first()).toHaveAttribute('data-kind', 'evidence');

  // Confirm is the one irreversible action, and it stays shut until asked for.
  await expect(page.getByTestId('confirm')).toBeDisabled();
  await answerEveryGate(page);
  await expect(page.getByTestId('confirm')).toBeEnabled();

  await page.getByTestId('confirm').click();

  // Confirmed: one Report charted, the same Report persisted, evidence gone.
  await expect(page.getByTestId('data-manager')).toBeVisible();
  await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
  await expect(page.getByTestId('panel-rows').locator('> li').first()).toBeVisible();

  // The panel opens one marker's history: a row is the way into the trend.
  await page.locator('[data-testid^="panel-row-"]').first().click();
  await expect(page.getByTestId('trend-plot')).toBeVisible();
  await page.getByTestId('trend-back').click();
  await expect(page.getByTestId('panel-rows')).toBeVisible();
  await expect(page.getByTestId('review')).toHaveCount(0);

  const stored = (await storedProfile(page)) as Record<string, unknown> | null;
  expect(stored).not.toBeNull();

  // Export and import round-trip to the same validated Profile.
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export').click(),
  ]).then(([each]) => each);
  const exported = readFileSync(await download.path(), 'utf8');

  // The file names its format and version before the data, so what round-trips
  // is the envelope's Profile rather than the file.
  expect(JSON.parse(exported)).toMatchObject({ format: 'medigraph', v: 1, profile: stored });

  // Import a Profile the screen is not already showing. Replacing it with what
  // is already there would pass whether the file landed or was dropped, so the
  // one imported here is emptied of its Reports and the count has to follow.
  const emptied = { ...stored, reports: [] };

  await page.getByTestId('import').setInputFiles({
    name: 'medigraph.medigraph',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'medigraph', v: 1, profile: emptied }), 'utf8'),
  });

  // Nothing is written by arriving: the file becomes a preview and waits for
  // a decision that names what it costs (Task 4.5).
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);

  await page.getByTestId('import-same-person').check();
  await page.getByTestId('replace-import').click();
  await page.getByTestId('replace-confirmed').click();

  // Parsed, validated, written and shown, from the file alone.
  await expect(page.getByTestId('stored-reports')).toHaveCount(0);
  await expect(page.getByTestId('error')).toHaveCount(0);
  expect(await storedProfile(page)).toEqual(emptied);

  expect(violations).toEqual([]);
});

test('a confirmed Profile is charted again when the tab is reloaded', async ({ page }) => {
  // Hydration is its own slice: the Profile has to survive the island being
  // torn down and rebuilt, and nothing may be re-extracted to put it back.
  // It reloads rather than asserting in the slice above because that test
  // holds every page load in the run to the CSP, and this one adds a load.
  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();
  await answerEveryGate(page);
  await page.getByTestId('confirm').click();
  await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);

  await page.reload();

  // Read back from IndexedDB alone: charting, with no document attached.
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'viewing');
  await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
  await expect(page.getByTestId('review')).toHaveCount(0);
});

test('a non-ΑΗΦΥ PDF is refused at its own source, and writes nothing', async ({ page }) => {
  await page.getByTestId('attach').setInputFiles(NOT_AHFY);

  // The failure is source-scoped and names why: Pass V rejected the document,
  // rather than the adapter failing to read it.
  await expect(page.getByTestId('failure-not-ahfy-document')).toBeVisible();
  await expect(page.getByTestId('review')).toHaveCount(0);
  await expect(page.getByTestId('panel')).toHaveCount(0);
  expect(await storedProfile(page)).toBeNull();
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'idle');
});
