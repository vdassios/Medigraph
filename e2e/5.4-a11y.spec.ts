import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Task 5.4 — the product, used without a mouse, without colour, and without
 * sight of the chart.
 *
 * axe is the floor rather than the ceiling: it catches the mechanical failures
 * (names, roles, contrast, duplicate ids) and cannot tell whether a screen is
 * usable. The assertions around it are the ones that carry the weight — that
 * every gate can be answered from the keyboard, that status never rests on
 * colour, and that every number in the trend chart exists as text.
 */

const AHFY = 'fixtures/seed/ahfy-minimal.pdf';

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  const detail = results.violations.flatMap((each) =>
    each.nodes
      .slice(0, 3)
      .map((node) => `${each.id} ${node.target.join(' ')} :: ${node.failureSummary ?? ''}`),
  );
  expect(detail).toEqual([]);
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
}

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('medigraph');
  });
  await page.reload();
});

for (const theme of ['light', 'dark'] as const) {
  for (const language of ['el', 'en'] as const) {
    test(`the attach and review screens pass axe in ${theme} ${language}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((chosen) => {
        globalThis.localStorage.setItem('medigraph:language', chosen);
      }, language);
      await page.reload();
      await expect(page.getByTestId('app')).toHaveAttribute('lang', language);

      await scan(page);

      await page.getByTestId('attach').setInputFiles(AHFY);
      await expect(page.getByTestId('review')).toBeVisible();
      await scan(page);
    });

    test(`the panel and trend pass axe in ${theme} ${language}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((chosen) => {
        globalThis.localStorage.setItem('medigraph:language', chosen);
      }, language);
      await page.reload();

      await page.getByTestId('attach').setInputFiles(AHFY);
      await expect(page.getByTestId('review')).toBeVisible();
      await answerEveryGate(page);
      await page.getByTestId('confirm').click();
      await expect(page.getByTestId('panel-rows')).toBeVisible();

      await scan(page);

      await page.locator('[data-testid^="panel-row-"]').first().click();
      await expect(page.getByTestId('trend-plot')).toBeVisible();
      await scan(page);

      await page.getByTestId('trend-table-toggle').click();
      await expect(page.getByTestId('trend-table')).toBeVisible();
      await scan(page);
    });
  }
}

test('every gate can be answered from the keyboard alone', async ({ page }) => {
  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();

  // Walk forward from the top of the document, activating whatever gate the
  // focus lands on, and never touching the mouse.
  const answered = new Set<string>();
  for (let step = 0; step < 200; step += 1) {
    await page.keyboard.press('Tab');
    const testId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    if (testId === null || testId === undefined) {
      continue;
    }
    if (['redact-identifier', 'approve-unknown', 'confirm-date'].includes(testId)) {
      await page.keyboard.press('Enter');
      answered.add(testId);
    }
    if (testId === 'confirm' && (await page.getByTestId('confirm').isEnabled())) {
      await page.keyboard.press('Enter');
      break;
    }
  }

  expect(answered.has('confirm-date')).toBe(true);
  await expect(page.getByTestId('panel-rows')).toBeVisible();
});

test('opening and closing an editor returns focus to the row it belongs to', async ({ page }) => {
  await page.getByTestId('attach').setInputFiles('fixtures/seed/ahfy-full.pdf');
  await expect(page.getByTestId('review')).toBeVisible();

  const edit = page.getByTestId('rows-expanded').getByTestId('edit-row').first();
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('row-editor').first()).toBeVisible();

  // The editor opens beside the control that opened it, and closing it leaves
  // focus somewhere a keyboard user can carry on from — not on <body>.
  await page.getByTestId('cancel-row-edit').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('row-editor')).toHaveCount(0);

  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute('data-testid') ?? '',
  );
  expect(focused).toBe('edit-row');
});

test('every control is a target a thumb can hit', async ({ page }) => {
  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();
  await answerEveryGate(page);
  await page.getByTestId('confirm').click();
  await expect(page.getByTestId('panel-rows')).toBeVisible();

  const small: string[] = [];
  for (const button of await page.locator('button:visible').all()) {
    const box = await button.boundingBox();
    if (box !== null && box.height < 44) {
      small.push(`${(await button.textContent())?.trim() ?? ''} (${String(box.height)}px)`);
    }
  }

  expect(small).toEqual([]);
});

test('status is readable with no colour at all', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();
  await answerEveryGate(page);
  await page.getByTestId('confirm').click();

  const status = page.getByTestId('row-status').first();
  await expect(status).toBeVisible();
  // The sentence carries it, and the icon repeats it. Neither is a colour.
  await expect(status).not.toHaveText('');
  expect(await status.getAttribute('data-status')).not.toBeNull();
});

test('the chart says nothing the text does not', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();
  await answerEveryGate(page);
  await page.getByTestId('confirm').click();
  await page.locator('[data-testid^="panel-row-"]').first().click();

  // The figure is named by its own title and summary, and the plot is an image
  // with a label — never an unnamed graphic.
  await expect(page.getByTestId('trend-figure')).toHaveAttribute(
    'aria-labelledby',
    'trend-title trend-summary',
  );
  await expect(page.getByTestId('trend-plot')).toHaveAttribute('aria-label', /.+/u);

  // And every point it draws exists as a row of text.
  const marks = await page.locator('[data-testid^="trend-point-"]').count();
  await page.getByTestId('trend-table-toggle').click();
  const rows = await page.getByTestId('trend-row').count();

  expect(rows).toBeGreaterThanOrEqual(marks);
});

test('the meter is decorative, and the row it sits in is not', async ({ page }) => {
  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();
  await answerEveryGate(page);
  await page.getByTestId('confirm').click();

  const meter = page.getByTestId('row-meter').first();
  if ((await meter.count()) > 0) {
    await expect(meter).toHaveAttribute('aria-hidden', 'true');
  }

  // The row's accessible name is its own text: marker, value, unit, status.
  const row = page.locator('[data-testid^="panel-row-"]').first();
  const name = (await row.textContent()) ?? '';
  expect(name).toMatch(/[Α-Ωα-ωA-Za-z]/u);
  expect(name.length).toBeGreaterThan(10);
});
