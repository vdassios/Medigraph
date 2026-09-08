import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Task 4.2a — less to read, exactly as much to answer.
 *
 * Both documents go through the real build under the real
 * Content-Security-Policy, attached through the file input a user would use.
 * What these tests guard is the line between effort and authority: a row the
 * parser is sure of may collapse into a count, and none of the four questions
 * that block Confirm may ever collapse with it.
 */

const CLEAN = 'fixtures/seed/ahfy-minimal.pdf';
const FLAGGED = 'fixtures/seed/ahfy-full.pdf';

/** Answer the gates D6 and D7 own, one click each, in any order. */
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

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('medigraph');
  });
  await page.reload();
});

test('a document the parser is sure of costs no row-level action', async ({ page }) => {
  await page.getByTestId('attach').setInputFiles(CLEAN);
  await expect(page.getByTestId('review')).toBeVisible();

  // Every row read without reservation, collapsed into one count. Nothing is
  // expanded, so there is no per-row work to do at all.
  const rowCount = Number(
    ((await page.getByTestId('draft-rows').textContent()) ?? '').split(' ')[0],
  );
  await expect(page.locator('[data-triage="expanded"]')).toHaveCount(0);
  await expect(page.getByTestId('nothing-to-review')).toBeVisible();
  await expect(page.getByTestId('pre-accepted-count')).toHaveText(String(rowCount));

  // "Review these anyway": the disclosure opens the same rows with the same
  // controls, which is what keeps batch acceptance a default rather than a wall.
  await expect(page.getByTestId('pre-accepted').getByTestId('edit-row').first()).toBeHidden();
  await page.getByTestId('pre-accepted').locator('summary').click();
  await expect(page.getByTestId('pre-accepted').getByTestId('edit-row').first()).toBeVisible();

  // The gates that remain are the ones the user, not the parser, must answer.
  await expect(page.getByTestId('confirm')).toBeDisabled();
  await answerEveryGate(page);
  await expect(page.getByTestId('confirm')).toBeEnabled();

  await page.getByTestId('confirm').click();

  // Accepted as a batch means written as a batch: every pre-accepted row is in
  // the Report, not merely absent from the screen.
  await expect(page.getByTestId('data-manager')).toBeVisible();
  await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
  await expect(page.getByTestId('panel-rows').locator('> li')).toHaveCount(rowCount);
});

test('a document with rows worth reading keeps them on screen, and Confirm shut', async ({
  page,
}) => {
  await page.getByTestId('attach').setInputFiles(FLAGGED);
  await expect(page.getByTestId('review')).toBeVisible();

  const expanded = page.locator('[data-triage="expanded"]');
  const preAccepted = page.locator('[data-triage="pre-accepted"]');
  const rowCount = Number(
    ((await page.getByTestId('draft-rows').textContent()) ?? '').split(' ')[0],
  );

  // Triage is a partition of the rows, not a filter over them.
  expect(await expanded.count()).toBeGreaterThan(0);
  expect((await expanded.count()) + (await preAccepted.count())).toBe(rowCount);

  // The never-collapse rule, asserted from the browser: nothing the parser
  // hedged on, and nothing still under a gate, is inside the disclosure.
  await expect(page.locator('[data-triage="pre-accepted"][data-flagged="true"]')).toHaveCount(0);
  await expect(page.locator('[data-triage="pre-accepted"][data-confidence="low"]')).toHaveCount(0);
  await expect(page.locator('[data-triage="pre-accepted"][data-confidence="medium"]')).toHaveCount(
    0,
  );
  await expect(
    page.getByTestId('rows-expanded').getByTestId('approve-unknown').first(),
  ).toBeVisible();
  await expect(page.getByTestId('pre-accepted').getByTestId('approve-unknown')).toHaveCount(0);

  // An unapproved unknown marker holds Confirm on its own.
  await expect(page.getByTestId('confirm')).toBeDisabled();
  await page.getByTestId('redact-identifier').first().click();
  await expect(page.getByTestId('confirm')).toBeDisabled();

  await answerEveryGate(page);

  await expect(page.getByTestId('confirm')).toBeEnabled();
});

test('correcting a row shows the document it came from, beside the field', async ({ page }) => {
  await page.getByTestId('attach').setInputFiles(FLAGGED);
  await expect(page.getByTestId('review')).toBeVisible();

  await expect(page.getByTestId('evidence')).toHaveCount(0);
  await page.getByTestId('rows-expanded').getByTestId('edit-row').first().click();

  const evidence = page.getByTestId('evidence').first();
  await expect(evidence).toBeVisible();
  await expect(evidence).toHaveAttribute('data-kind', 'evidence');
  await expect(page.getByTestId('row-editor').first()).toBeVisible();
});
