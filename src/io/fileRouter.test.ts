import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RouteFailure, RouteProgress } from './fileRouter';
import { routeFiles } from './fileRouter';

const SEED = new URL('../../fixtures/seed/', import.meta.url);

function pdf(name: string): File {
  return new File([readFileSync(new URL(`${name}.pdf`, SEED))], `${name}.pdf`, {
    type: 'application/pdf',
  });
}

/** A file whose bytes and whose label disagree, or are not a PDF at all. */
function fake(name: string, type: string, bytes: string): File {
  return new File([new TextEncoder().encode(bytes)], name, { type });
}

async function route(
  files: readonly File[],
  signal = new AbortController().signal,
): Promise<{ results: string[]; failures: RouteFailure[]; progress: RouteProgress[] }> {
  const progress: RouteProgress[] = [];
  const batch = await routeFiles(files, signal, (each) => progress.push(each));

  return {
    results: batch.results.map((result) => result.collectionDate),
    failures: batch.failures,
    progress,
  };
}

describe('routeFiles', () => {
  describe('the happy path', () => {
    it('reads an ΑΗΦΥ document into an ExtractionResult', async () => {
      const batch = await routeFiles(
        [pdf('ahfy-minimal')],
        new AbortController().signal,
        () => undefined,
      );

      expect(batch.failures).toEqual([]);
      expect(batch.results).toHaveLength(1);
      expect(batch.results[0]).toMatchObject({
        adapterId: 'pdf-text',
        tier: 'E0',
        collectionDate: '2024-07-08',
      });
      expect(batch.results[0]?.rows.length).toBeGreaterThan(0);
    });

    it('gives each source its own id', async () => {
      const batch = await routeFiles(
        [pdf('ahfy-minimal'), pdf('ahfy-minimal')],
        new AbortController().signal,
        () => undefined,
      );
      const [first, second] = batch.results;

      expect(first?.sourceId).not.toBe(second?.sourceId);
    });

    it('reports progress per source, in attach order', async () => {
      const { progress } = await route([pdf('ahfy-minimal'), pdf('ahfy-full')]);

      expect(progress.filter((each) => each.page === 0).map((each) => each.sourceIndex)).toEqual([
        0, 1,
      ]);
      expect(progress.every((each) => each.sourceCount === 2)).toBe(true);
      expect(progress.filter((each) => each.page > 0).map((each) => each.pageCount)).toEqual([
        2, 13,
      ]);
    });
  });

  describe('files it will not read', () => {
    it('refuses a file that is not a PDF', async () => {
      const { failures } = await route([fake('holiday.png', 'image/png', 'PNG-not-a-pdf')]);

      expect(failures).toEqual([
        { scope: 'source', sourceIndex: 0, fileName: 'holiday.png', code: 'unsupported-type' },
      ]);
    });

    it('refuses a PDF label whose bytes are not a PDF', async () => {
      // The MIME type is whatever the operating system attached to the file.
      // The magic is what the file actually is, and both have to agree.
      const { failures } = await route([
        fake('claimed.pdf', 'application/pdf', 'not a pdf at all'),
      ]);

      expect(failures[0]).toMatchObject({ code: 'unsupported-type', fileName: 'claimed.pdf' });
    });

    it('refuses PDF bytes wearing another type', async () => {
      const { failures } = await route([fake('sneaky.png', 'image/png', '%PDF-1.7 body')]);

      expect(failures[0]).toMatchObject({ code: 'unsupported-type' });
    });

    it('names the file that was refused, not just its position', async () => {
      const { failures } = await route([fake('Σάρωση 3.png', 'image/png', 'x')]);

      expect(failures[0]).toMatchObject({ fileName: 'Σάρωση 3.png', sourceIndex: 0 });
    });
  });

  describe('the limits', () => {
    it('refuses a batch of more than twenty files, before reading any', async () => {
      const files = Array.from({ length: 21 }, () => pdf('ahfy-minimal'));
      const { results, failures } = await route(files);

      expect(failures).toEqual([{ scope: 'batch', code: 'too-many-files' }]);
      expect(results).toEqual([]);
    });

    it('accepts a batch of exactly twenty', async () => {
      const files = Array.from({ length: 20 }, () => pdf('ahfy-minimal'));
      const { failures } = await route(files);

      expect(failures).toEqual([]);
    });

    it('stops at the source that crosses the page budget, keeping its siblings', async () => {
      // Eight copies of the thirteen-page document is 104 pages. The eighth is
      // where the budget runs out; the seven already read are the user's and
      // are not thrown away.
      const files = Array.from({ length: 8 }, () => pdf('ahfy-full'));
      const batch = await routeFiles(files, new AbortController().signal, () => undefined);

      expect(batch.failures).toEqual([{ scope: 'batch', code: 'too-many-pages' }]);
      expect(batch.results).toHaveLength(7);
    });

    it('refuses a source above fifty mebibytes', async () => {
      const huge = pdf('ahfy-minimal');
      Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 + 1 });

      const { failures } = await route([huge]);

      expect(failures[0]).toMatchObject({ code: 'file-too-large' });
    });
  });

  describe('sources it reads but cannot accept', () => {
    it('refuses a loose laboratory PDF by name', async () => {
      // Accepting a non-ΑΗΦΥ source is a release blocker: its consequence is a
      // document parsed under column roles it does not have, which fails
      // silently and looks like data.
      const { results, failures } = await route([pdf('not-ahfy')]);

      expect(failures).toEqual([
        { scope: 'source', sourceIndex: 0, fileName: 'not-ahfy.pdf', code: 'not-ahfy-document' },
      ]);
      expect(results).toEqual([]);
    });

    it('refuses a PDF whose bytes are damaged', async () => {
      const { failures } = await route([
        fake('torn.pdf', 'application/pdf', '%PDF-1.7 this is not a document body'),
      ]);

      expect(failures[0]).toMatchObject({ code: 'decode-failed', fileName: 'torn.pdf' });
    });
  });

  describe('a mixed batch', () => {
    it('keeps every source that succeeded and names every one that did not', async () => {
      const { results, failures } = await route([
        pdf('ahfy-minimal'),
        fake('holiday.png', 'image/png', 'x'),
        pdf('not-ahfy'),
        pdf('ahfy-full'),
      ]);

      expect(results).toEqual(['2024-07-08', '2025-05-14']);
      expect(failures.map((each) => each.code)).toEqual(['unsupported-type', 'not-ahfy-document']);
      expect(failures.map((each) => (each.scope === 'source' ? each.sourceIndex : -1))).toEqual([
        1, 2,
      ]);
    });
  });

  describe('cancellation', () => {
    it('reports a batch that was cancelled before it started', async () => {
      const controller = new AbortController();
      controller.abort();

      const { results, failures } = await route([pdf('ahfy-minimal')], controller.signal);

      expect(failures).toEqual([{ scope: 'batch', code: 'cancelled' }]);
      expect(results).toEqual([]);
    });

    it('keeps the sources it finished before the user cancelled', async () => {
      const controller = new AbortController();
      const files = [pdf('ahfy-minimal'), pdf('ahfy-full')];

      const batch = await routeFiles(files, controller.signal, (progress) => {
        if (progress.sourceIndex === 0 && progress.page > 0) {
          controller.abort();
        }
      });

      expect(batch.results).toHaveLength(1);
      expect(batch.failures).toEqual([{ scope: 'batch', code: 'cancelled' }]);
    });
  });
});
