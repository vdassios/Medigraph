import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Task 5.6 — the gates and the lifecycle, through the browser's own stores.
 *
 * The domain tables prove these rules in isolation; what is proved here is
 * that the shipped app still enforces them once IndexedDB, a real file input
 * and a real download are involved. Every fixture is either a committed
 * synthetic document or a `.medigraph` file built in the test — the app's own
 * format, which is the only way to reach states a single document cannot
 * produce.
 */

const AHFY = 'fixtures/seed/ahfy-minimal.pdf';
const AHFY_FULL = 'fixtures/seed/ahfy-full.pdf';
const NOT_AHFY = 'fixtures/seed/not-ahfy.pdf';

interface Measurement {
  markerKey: string;
  status: 'value' | 'categorical' | 'missing';
  value: number | null;
  comparator: '<' | '<=' | '>' | '>=' | null;
  textValue: string | null;
  unit: string | null;
  referenceRange: unknown;
  categoricalReference: string | null;
  sourceOrder: number;
  label?: string;
}

function measurement(markerKey: string, overrides: Partial<Measurement> = {}): Measurement {
  return {
    markerKey,
    status: 'value',
    value: 10,
    comparator: null,
    textValue: null,
    unit: 'mg/dL',
    referenceRange: null,
    categoricalReference: null,
    sourceOrder: 0,
    ...overrides,
  };
}

interface Report {
  id: string;
  collectedAt: { date: string; time: string | null; precision: 'day' | 'minute' };
  measurements: Measurement[];
}

function report(id: string, date: string, measurements: Measurement[], time?: string): Report {
  return {
    id,
    collectedAt:
      time === undefined
        ? { date, time: null, precision: 'day' }
        : { date, time, precision: 'minute' },
    measurements,
  };
}

function medigraph(reports: Report[], id = 'profile-under-test'): string {
  return JSON.stringify({
    format: 'medigraph',
    v: 1,
    profile: { schemaVersion: 1, id, reports },
  });
}

async function offerFile(page: Page, contents: string): Promise<void> {
  await page.getByTestId('import').setInputFiles({
    name: 'history.medigraph',
    mimeType: 'application/json',
    buffer: Buffer.from(contents, 'utf8'),
  });
}

/** Import into an empty device, which is the one case with nothing to lose. */
async function seed(page: Page, contents: string): Promise<void> {
  await offerFile(page, contents);
  await page.getByTestId('accept-import').click();
  await expect(page.getByTestId('stored-reports')).toBeVisible();
}

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

test.describe('the review gates', () => {
  test('an unconfirmed date holds Confirm, and confirming it releases it', async ({ page }) => {
    await page.getByTestId('attach').setInputFiles(AHFY);
    await expect(page.getByTestId('review')).toBeVisible();

    await expect(page.getByTestId('confirm')).toBeDisabled();
    await expect(page.getByTestId('blockers')).toContainText(/ημερομην|dates/u);

    await page.getByTestId('confirm-date').click();
    await expect(page.getByTestId('confirm')).toBeEnabled();
  });

  test('a document Pass V refuses never reaches a review', async ({ page }) => {
    await page.getByTestId('attach').setInputFiles(NOT_AHFY);

    await expect(page.getByTestId('failure-not-ahfy-document')).toBeVisible();
    await expect(page.getByTestId('review')).toHaveCount(0);
  });

  test('reassigning a marker onto another rebuilds the duplicate conflict', async ({ page }) => {
    await page.getByTestId('attach').setInputFiles(AHFY_FULL);
    await expect(page.getByTestId('review')).toBeVisible();
    await answerEveryGate(page);
    await expect(page.getByTestId('confirm')).toBeEnabled();

    // Point a row at a marker the same document already carries.
    const row = page.getByTestId('pre-accepted').getByTestId('reassign-row').first();
    await page.getByTestId('pre-accepted').locator('summary').click();
    await row.click();
    await page.getByTestId('reassign-search').first().fill('WBC');
    await page.locator('[data-testid="reassign-to-wbc"]').first().click();

    // The question the duplicate raises is asked immediately, and Confirm shuts.
    await expect(page.locator('[data-testid="conflict-wbc"]')).toBeVisible();
    await expect(page.getByTestId('confirm')).toBeDisabled();

    await page.locator('[data-testid="resolve-conflict-wbc"]').first().click();
    await expect(page.getByTestId('confirm')).toBeEnabled();
  });

  test('an identifier the container labelled is answered, and never displayed', async ({
    page,
  }) => {
    await page.getByTestId('attach').setInputFiles(AHFY_FULL);
    await expect(page.getByTestId('review')).toBeVisible();

    // Pre-resolved as redacted (ADR-0020): the gate is discharged, the text is
    // out of every derived field, and the screen does not echo it back.
    await expect(page.getByTestId('identifier-answer').first()).toBeVisible();
    await expect(page.getByTestId('review')).not.toContainText('01018099901');
    await expect(page.getByTestId('review')).not.toContainText('ΠΑΠΑΔΟΠΟΥΛΟΣ');
    await expect(page.getByTestId('blockers')).not.toContainText(/προσωπικά|personal/u);
  });

  test('an unapproved unknown marker holds Confirm on its own', async ({ page }) => {
    await page.getByTestId('attach').setInputFiles(AHFY_FULL);
    await expect(page.getByTestId('review')).toBeVisible();

    for (const testId of ['redact-identifier', 'confirm-date']) {
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

    await expect(page.getByTestId('approve-unknown').first()).toBeVisible();
    await expect(page.getByTestId('confirm')).toBeDisabled();

    await page.getByTestId('approve-unknown').first().click();
    await expect(page.getByTestId('confirm')).toBeEnabled();
  });

  test('cancelling a review disposes the source it was showing', async ({ page }) => {
    await page.getByTestId('attach').setInputFiles(AHFY_FULL);
    await expect(page.getByTestId('review')).toBeVisible();

    await page.getByTestId('rows-expanded').getByTestId('inspect-source').first().click();
    await expect(page.getByTestId('evidence').first()).toHaveAttribute('data-kind', 'evidence');

    await page.getByTestId('cancel').click();

    await expect(page.getByTestId('review')).toHaveCount(0);
    await expect(page.getByTestId('evidence')).toHaveCount(0);
  });
});

test.describe('what the charts may draw', () => {
  test('a censored point is hollow and joins nothing; a one-sided range shades one side', async ({
    page,
  }) => {
    await seed(
      page,
      medigraph([
        report('rep-1', '2025-01-01', [
          measurement('ferritin', {
            value: 10,
            comparator: '<',
            unit: 'ng/mL',
            referenceRange: { kind: 'minOnly', min: 30, comparator: '>=' },
          }),
        ]),
        report('rep-2', '2025-02-01', [
          measurement('ferritin', {
            value: 120,
            unit: 'ng/mL',
            referenceRange: { kind: 'minOnly', min: 30, comparator: '>=' },
          }),
        ]),
      ]),
    );

    await page.getByTestId('panel-row-ferritin').click();
    await expect(page.getByTestId('trend-point-0')).toHaveAttribute('data-kind', 'censored');
    await expect(page.locator('circle.trend-mark-hollow')).toHaveCount(1);
    await expect(page.locator('polyline.trend-line')).toHaveCount(0);
    await expect(page.locator('rect.trend-band')).not.toHaveCount(0);

    // And the table says in words what the chart draws as a shape.
    await page.getByTestId('trend-table-toggle').click();
    await expect(page.getByTestId('trend-row').first()).toContainText('<10');
  });

  test('convertible units become one series; incompatible ones stay two', async ({ page }) => {
    await seed(
      page,
      medigraph([
        report('rep-1', '2025-01-01', [
          measurement('glucose', { value: 92, unit: 'mg/dL' }),
          measurement('x:kappa', { value: 1, unit: 'mg/dL', label: 'Κάππα' }),
        ]),
        report('rep-2', '2025-02-01', [
          measurement('glucose', { value: 5.1, unit: 'mmol/L' }),
          measurement('x:kappa', { value: 2, unit: 'g/L', label: 'Κάππα' }),
        ]),
      ]),
    );

    // The panel shows the newest Report: one row per marker it holds.
    await page.getByTestId('panel-row-glucose').click();
    await page.getByTestId('trend-table-toggle').click();
    await expect(page.getByTestId('trend-row')).toHaveCount(2);
    await page.getByTestId('trend-back').click();

    // The unknown marker has no canonical unit to fold into, so its two
    // printed units are two series, and the row says so rather than overlaying.
    await expect(page.getByTestId('row-split-unit').first()).toBeVisible();
    await page.locator('[data-testid="panel-row-x:kappa"]').click();
    await page.getByTestId('trend-table-toggle').click();
    await expect(page.getByTestId('trend-row')).toHaveCount(1);
  });
});

test.describe('importing into a device that already holds a history', () => {
  const stored = medigraph([
    report('rep-1', '2025-01-02', [measurement('glucose', { value: 92 })]),
  ]);

  test('Cancel writes nothing', async ({ page }) => {
    await seed(page, stored);
    await offerFile(page, medigraph([report('rep-2', '2025-03-03', [measurement('urea')])]));

    await page.getByTestId('cancel-import').click();

    await expect(page.getByTestId('import-preview')).toHaveCount(0);
    await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
  });

  test('Merge adds the incoming Reports beside the stored one', async ({ page }) => {
    await seed(page, stored);
    await offerFile(page, medigraph([report('rep-2', '2025-03-03', [measurement('urea')])]));

    await page.getByTestId('import-same-person').check();
    await page.getByTestId('merge-import').click();

    await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(2);
  });

  test('Replace asks a second time, and then means it', async ({ page }) => {
    await seed(page, stored);
    await offerFile(page, medigraph([report('rep-2', '2025-03-03', [measurement('urea')])]));

    await page.getByTestId('import-same-person').check();
    await page.getByTestId('replace-import').click();
    await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);

    await page.getByTestId('replace-confirmed').click();

    await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
    await expect(page.getByTestId('stored-reports')).toContainText('2025');
  });

  test('a Report id that means two different things blocks the merge', async ({ page }) => {
    await seed(page, stored);
    await offerFile(
      page,
      medigraph([report('rep-1', '2025-01-02', [measurement('glucose', { value: 500 })])]),
    );

    await page.getByTestId('import-same-person').check();

    await expect(page.getByTestId('merge-blocked')).toBeVisible();
    await expect(page.getByTestId('merge-import')).toBeDisabled();
  });

  test('two Reports on one day are merged only once each has a minute', async ({ page }) => {
    await seed(page, stored);
    await offerFile(
      page,
      medigraph([report('rep-9', '2025-01-02', [measurement('urea')])], 'incoming'),
    );

    await page.getByTestId('import-same-person').check();
    await expect(page.getByTestId('same-day-conflicts')).toBeVisible();
    await expect(page.getByTestId('merge-import')).toBeDisabled();

    await page.getByTestId('same-day-stored-rep-1').fill('08:00');
    await page.getByTestId('same-day-incoming-rep-9').fill('17:30');
    await page.getByTestId('merge-import').click();

    await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(2);
    await expect(page.getByTestId('stored-reports')).toContainText('17:30');
  });

  test('a file that is not a history is refused by name, and changes nothing', async ({ page }) => {
    await seed(page, stored);
    await offerFile(page, JSON.stringify({ format: 'something-else', v: 1 }));

    await expect(page.getByTestId('import-error')).toBeVisible();
    await expect(page.getByTestId('import-preview')).toHaveCount(0);
    await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
  });
});

test.describe('the end of a record', () => {
  test('a cancelled attach leaves the stored Profile exactly as it was', async ({ page }) => {
    await seed(page, medigraph([report('rep-1', '2025-01-02', [measurement('glucose')])]));

    await page.getByTestId('attach').setInputFiles(AHFY);
    await expect(page.getByTestId('review')).toBeVisible();
    await page.getByTestId('cancel').click();

    await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
  });

  test('one Report can be deleted without touching the others', async ({ page }) => {
    await seed(
      page,
      medigraph([
        report('rep-1', '2025-01-02', [measurement('glucose')]),
        report('rep-2', '2025-03-03', [measurement('urea')]),
      ]),
    );

    await page.getByTestId('delete-report-rep-1').click();
    await page.getByTestId('delete-report-confirmed-rep-1').click();

    await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId('stored-reports')).toContainText('2025-03-03');
  });

  test('deleting everything leaves the two ways back in', async ({ page }) => {
    await seed(page, medigraph([report('rep-1', '2025-01-02', [measurement('glucose')])]));

    await page.getByTestId('clear-all').click();
    await page.getByTestId('clear-all-confirmed').click();

    await expect(page.getByTestId('data-empty')).toBeVisible();
    await expect(page.getByTestId('attach')).toBeVisible();
    await expect(page.getByTestId('import')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('data-empty')).toBeVisible();
  });
});
