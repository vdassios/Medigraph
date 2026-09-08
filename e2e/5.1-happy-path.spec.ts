import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Task 5.1 — the whole product, once, the way a person uses it.
 *
 * One synthetic ΑΗΦΥ document goes in through the file input, every gate is
 * answered, and what comes out the other end is a Profile the browser really
 * holds: read back out of IndexedDB, written to a real download, deleted from
 * the device, and recovered from that file alone. Nothing here reaches into
 * the app's memory — the assertions are about stored bytes and rendered text,
 * because those are the only things a user actually has.
 */

const AHFY = 'fixtures/seed/ahfy-full.pdf';

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

/** Answer every gate D6, D7 and D8 raise, one click each, in any order. */
async function answerEveryGate(page: Page): Promise<void> {
  for (const testId of ['redact-identifier', 'approve-unknown', 'confirm-date']) {
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

test('one document becomes a record, a chart, a file, and a record again', async ({ page }) => {
  await page.goto('/app/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('medigraph');
  });
  await page.reload();

  // Attach, and answer everything the review asks.
  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('confirm')).toBeDisabled();
  await answerEveryGate(page);
  await expect(page.getByTestId('confirm')).toBeEnabled();
  await page.getByTestId('confirm').click();

  // One Report, and a panel with a row for every marker the document printed.
  await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
  const rows = page.locator('[data-testid^="panel-row-"]');
  expect(await rows.count()).toBeGreaterThanOrEqual(25);

  // A marker's own history, opened from its row.
  await page.getByTestId('panel-row-ferritin').click();
  await expect(page.getByTestId('trend-title')).toContainText('Φερριτίνη');
  await expect(page.getByTestId('trend-plot')).toBeVisible();
  await page.getByTestId('trend-back').click();

  const stored = await storedProfile(page);
  expect(stored).not.toBeNull();

  // The export is a real file, and it is plain text with the Profile inside it.
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export').click(),
  ]).then(([each]) => each);
  const exported = readFileSync(await download.path(), 'utf8');
  expect(JSON.parse(exported)).toMatchObject({ format: 'medigraph', v: 1, profile: stored });

  // Delete everything from this device, and mean it.
  await page.getByTestId('clear-all').click();
  await page.getByTestId('clear-all-confirmed').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'idle');
  expect(await storedProfile(page)).toBeNull();

  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'idle');
  expect(await storedProfile(page)).toBeNull();

  // Recover it from the file alone. Nothing is written by the file arriving:
  // an empty device is offered Cancel or Import, and Import is a choice.
  await page.getByTestId('import').setInputFiles({
    name: 'medigraph.medigraph',
    mimeType: 'application/json',
    buffer: Buffer.from(exported, 'utf8'),
  });
  await expect(page.getByTestId('import-preview')).toBeVisible();
  expect(await storedProfile(page)).toBeNull();

  await page.getByTestId('accept-import').click();

  // The same Profile, validated on the way in, down to the Report ids.
  await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
  expect(await storedProfile(page)).toEqual(stored);
  await expect(page.locator('[data-testid^="panel-row-"]')).toHaveCount(await rows.count());
  await expect(page.getByTestId('error')).toHaveCount(0);
});
