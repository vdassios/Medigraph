import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';

/**
 * Task 5.2 — the D1 data rule, as regression evidence.
 *
 * Distinctive values from the synthetic fixture are treated as canaries: an
 * identifier, a collection date and a marker value that appear nowhere else in
 * the product. Every request the page makes is captured while a document is
 * attached, reviewed and confirmed, and none of them may carry any canary — in
 * its URL, its query, its headers or its body, in any encoding this app could
 * plausibly produce.
 *
 * **Origins are not asserted.** Contacting one is not a violation;
 * transmitting is (ADR-0015). The app downloads its own assets and that is
 * ordinary.
 *
 * **This is evidence against accidental egress, not proof against deliberate
 * egress.** Code that wanted to leak this data could encode it in ways no
 * test enumerates. What this guards is the far likelier failure: a fetch, a
 * beacon or a logger added later that quietly carries a value with it.
 */

const AHFY = 'fixtures/seed/ahfy-full.pdf';
const NOT_AHFY = 'fixtures/seed/not-ahfy.pdf';

/**
 * Values that exist in the fixture and nowhere else in the product.
 *
 * Taken from the committed synthetic document rather than injected: fixtures
 * are derived from supplied ΑΗΦΥ documents and are not authored to order, and
 * a canary the parser never reads would prove nothing about the parser.
 */
const CANARIES = {
  identifier: '01018099901',
  patientId: 'AAAAbbbbCCCCddddEEEEff',
  collectionDate: '2025-05-14',
  markerValue: '347.3',
};

/** Every encoding of a canary this app could plausibly produce. */
function encodings(value: string): string[] {
  return [
    value,
    encodeURIComponent(value),
    encodeURI(value),
    Buffer.from(value, 'utf8').toString('base64'),
    Buffer.from(value, 'utf8').toString('base64url'),
    JSON.stringify(value).slice(1, -1),
  ];
}

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function capture(page: Page): Captured[] {
  const requests: Captured[] = [];
  page.on('request', (request: Request) => {
    requests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body: request.postData(),
    });
  });

  return requests;
}

/** Everything about a request that could carry a value off the device. */
function surface(request: Captured): string {
  return [
    request.url,
    Object.entries(request.headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n'),
    request.body ?? '',
  ].join('\n');
}

function carriers(requests: readonly Captured[]): string[] {
  const needles = Object.values(CANARIES).flatMap(encodings);

  return requests
    .filter((request) => needles.some((needle) => surface(request).includes(needle)))
    .map((request) => `${request.method} ${request.url}`);
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

test('attaching, reviewing and confirming carries nothing off the device', async ({ page }) => {
  const requests = capture(page);

  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();
  await answerEveryGate(page);
  await page.getByTestId('confirm').click();
  await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);

  // The parser did read the canaries: a test that never saw them would pass
  // against a document that was never opened.
  await expect(page.getByTestId('panel-row-rbc')).toBeVisible();

  expect(carriers(requests)).toEqual([]);

  // Nothing this app does has a body to send. A request with one, to any
  // origin at all, is the shape an exfiltration takes.
  expect(requests.filter((request) => request.body !== null).map((each) => each.url)).toEqual([]);
});

test('a refused document carries nothing off the device either', async ({ page }) => {
  const requests = capture(page);

  await page.getByTestId('attach').setInputFiles(NOT_AHFY);
  await expect(page.getByTestId('failure-not-ahfy-document')).toBeVisible();

  expect(carriers(requests)).toEqual([]);
  expect(requests.filter((request) => request.body !== null)).toEqual([]);
});

test('the browser holds one Profile, and a cache of declared assets only', async ({ page }) => {
  await page.getByTestId('attach').setInputFiles(AHFY);
  await expect(page.getByTestId('review')).toBeVisible();
  await answerEveryGate(page);
  await page.getByTestId('confirm').click();
  await expect(page.getByTestId('stored-reports').locator('> li')).toHaveCount(1);

  // IndexedDB: one database, one store, one key.
  const stores = await page.evaluate(
    async () =>
      new Promise<Record<string, string[]>>((resolve, reject) => {
        const open = indexedDB.open('medigraph');
        open.onerror = () => {
          reject(new Error('indexeddb open failed'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const names = [...db.objectStoreNames];
          const keys: Record<string, string[]> = {};
          for (const name of names) {
            const request = db.transaction(name).objectStore(name).getAllKeys();
            request.onsuccess = () => {
              keys[name] = request.result.map((key) =>
                typeof key === 'string' ? key : JSON.stringify(key),
              );
              if (Object.keys(keys).length === names.length) {
                resolve(keys);
              }
            };
          }
          if (names.length === 0) {
            resolve({});
          }
        };
      }),
  );

  expect(stores).toEqual({ profile: ['current'] });

  // Cache Storage: only what the generated list declares (ADR-0017).
  const declared = new Set<string>(
    (JSON.parse(readFileSync('public/app-assets.json', 'utf8')) as { assets: string[] }).assets,
  );
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        urls.push(new URL(request.url).pathname);
      }
    }

    return urls;
  });

  expect(cached.filter((path) => !declared.has(path))).toEqual([]);
});

test('the net would catch a leak, in any encoding it could take', async ({ page }) => {
  // A test that only ever passes is not evidence. This plants exactly the
  // shape the others watch for — a canary in a query string, and again
  // base64'd in a body — and requires the detector to name both.
  const requests = capture(page);

  await page.evaluate(async (canaries) => {
    await fetch(`/app/?leak=${encodeURIComponent(canaries.identifier)}`);
    await fetch('/app/', {
      method: 'POST',
      body: btoa(canaries.markerValue),
    });
  }, CANARIES);

  expect(carriers(requests)).toHaveLength(2);
  expect(requests.filter((request) => request.body !== null)).toHaveLength(1);
});
