import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAhfyDocument } from '../domain/ahfyDocument';
import { extract } from '../domain/extract';
import type { TextItem } from '../domain/types';
import { extractPdfText, pdfTextAdapter } from './pdfText';

const SEED = new URL('../../fixtures/seed/', import.meta.url);
const PACKAGED = new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
const HOSTED = new URL('../../public/pdf/pdf.worker.min.mjs', import.meta.url);

function pdf(name: string): File {
  const bytes = readFileSync(new URL(`${name}.pdf`, SEED));
  return new File([bytes], `${name}.pdf`, { type: 'application/pdf' });
}

/** The hand-checked observations Task 0.3 committed, derived independently. */
function fixture(name: string): TextItem[][] {
  const parsed = JSON.parse(readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8')) as {
    fragmented: { pages: TextItem[][] };
  };
  return parsed.fragmented.pages;
}

async function read(name: string): Promise<TextItem[][]> {
  return extractPdfText(pdf(name), new AbortController().signal);
}

describe('extractPdfText', () => {
  describe('the observations it emits', () => {
    it('reads one array per page, in page order', async () => {
      const pages = await read('ahfy-full');

      expect(pages).toHaveLength(13);
      expect(pages.every((page) => page.length > 0)).toBe(true);
    });

    it('gives every item a stable id naming its page and position', async () => {
      const [first] = await read('ahfy-minimal');

      expect(first?.slice(0, 3).map((item) => item.id)).toEqual(['p1-f0', 'p1-f1', 'p1-f2']);
    });

    it('reads the same document identically twice', async () => {
      expect(await read('ahfy-minimal')).toEqual(await read('ahfy-minimal'));
    });

    it('normalises every box into the page, y down from the top left', async () => {
      // The persisted contract requires 0 ≤ x,y,w,h ≤ 1 with x+w ≤ 1 and
      // y+h ≤ 1. PDF counts y upward from the bottom; the flip happens once,
      // here, so nothing downstream has to know which way a PDF counts.
      for (const page of await read('ahfy-full')) {
        for (const item of page) {
          expect(item.x).toBeGreaterThanOrEqual(0);
          expect(item.y).toBeGreaterThanOrEqual(0);
          expect(item.w).toBeGreaterThan(0);
          expect(item.h).toBeGreaterThan(0);
          expect(item.x + item.w).toBeLessThanOrEqual(1);
          expect(item.y + item.h).toBeLessThanOrEqual(1);
        }
      }
    });

    it('puts the page header at the top and the table below it', async () => {
      const [, second] = await read('ahfy-minimal');
      const code = second?.find((item) => item.text.startsWith('Κωδικός'));
      const header = second?.find((item) => item.text === 'Περιγραφή');

      expect(code?.y).toBeLessThan(header?.y ?? 0);
    });

    it('sets no confidence, because a text layer has none to report', async () => {
      // Filling in a comfortable 1 would later read as evidence of something.
      const [first] = await read('ahfy-minimal');

      expect(first?.every((item) => !('confidence' in item))).toBe(true);
    });
  });

  describe('fragments a font change split', () => {
    it('rejoins a word pdf.js split mid-way', async () => {
      // The document changes font inside a word constantly. `Κωδικός` and `:`
      // are two fonts; so are `k/`, `μ` and `l`; and so is the issuing
      // laboratory, eleven Greek letters and a Latin `O`, which the plan names
      // as a string the parser must see whole.
      const [first, second] = await read('ahfy-minimal');

      expect(first?.[0]?.text).toBe('Κωδικός:');
      expect(second?.map((item) => item.text)).toContain('ΑΙΜΑΤΟΛΟΓΙΚO');
      expect(second?.map((item) => item.text)).toContain('k/μl');
    });

    it('keeps two printed words apart', async () => {
      const [, second] = await read('ahfy-minimal');
      const texts = second?.map((item) => item.text) ?? [];

      expect(texts).toContain('ΓΕΝΙΚΗ');
      expect(texts).toContain('ΑΙΜΑΤΟΣ');
      expect(texts).not.toContain('ΓΕΝΙΚΗΑΙΜΑΤΟΣ');
    });

    it('unions the boxes it rejoins, inventing no coordinate', async () => {
      // Rejoining two measured boxes is measured. The forbidden direction is
      // the other one: splitting a fragment and interpolating x by character
      // count, which a proportional font makes unsafe.
      const [first] = await read('ahfy-minimal');
      const code = first?.[0];

      expect(code?.text).toBe('Κωδικός:');
      expect(code?.w).toBeGreaterThan(0.07);
    });
  });

  describe('against the independently derived fixture', () => {
    it.each(['ahfy-full', 'ahfy-minimal'])('reads %s as the fixture records it', async (name) => {
      // The committed fixture is a poppler derivation, so its boxes and its
      // codepoint choices are its own — `Αντισώµατα` carries U+00B5 where
      // pdf.js reports U+03BC, which `normaliseLabel` folds together. What the
      // two must agree on is the reading: how many observations each page
      // holds, and what each one says.
      const read = await extractPdfText(pdf(name), new AbortController().signal);
      const want = fixture(name);

      expect(read.map((page) => page.length)).toEqual(want.map((page) => page.length));

      for (const [index, page] of read.entries()) {
        expect(page.map((item) => item.text.normalize('NFKD'))).toEqual(
          (want[index] ?? []).map((item) => item.text.normalize('NFKD')),
        );
      }
    });

    it('agrees with the fixture on where each item sits', async () => {
      // Two independent derivations of the same page will not agree to the
      // last decimal — they measure a glyph box differently — but they must
      // agree on the layout, or every threshold downstream was tuned against
      // a page that does not exist.
      const read = await extractPdfText(pdf('ahfy-minimal'), new AbortController().signal);
      const want = fixture('ahfy-minimal');

      for (const [index, page] of read.entries()) {
        for (const [at, item] of page.entries()) {
          const other = want[index]?.[at];
          expect(item.x).toBeCloseTo(other?.x ?? 0, 2);
          expect(item.y).toBeCloseTo(other?.y ?? 0, 2);
        }
      }
    });
  });

  describe('the whole pipeline, on real pdf.js output', () => {
    it.each(['ahfy-full', 'ahfy-minimal'])('validates %s as an ΑΗΦΥ document', async (name) => {
      const validation = validateAhfyDocument(await read(name));

      expect(validation.ok).toBe(true);
    });

    it('extracts the same rows from the PDF as from the committed fixture', async () => {
      // The strongest check available: every threshold in `rows.ts`,
      // `anchors.ts` and `readout.ts` was measured against the fixture, and
      // this is the first time they meet the bytes the browser will hand them.
      const live = extract({
        sourceId: 'ahfy-full',
        adapterId: 'pdf-text',
        tier: 'E0',
        pages: await read('ahfy-full'),
      });
      const committed = extract({
        sourceId: 'ahfy-full',
        adapterId: 'pdf-text',
        tier: 'E0',
        pages: fixture('ahfy-full'),
      });

      expect(live.collectionDate).toBe(committed.collectionDate);
      expect(live.rows.map((row) => row.markerKey)).toEqual(
        committed.rows.map((row) => row.markerKey),
      );
      expect(live.rows.map((row) => row.value)).toEqual(committed.rows.map((row) => row.value));
      expect(live.rows.map((row) => row.unit)).toEqual(committed.rows.map((row) => row.unit));
      expect(live.rows.map((row) => JSON.stringify(row.referenceRange))).toEqual(
        committed.rows.map((row) => JSON.stringify(row.referenceRange)),
      );
    });
  });

  describe('cancellation', () => {
    it('refuses to start once the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(extractPdfText(pdf('ahfy-minimal'), controller.signal)).rejects.toThrow(
        /cancelled/u,
      );
    });
  });
});

describe('pdfTextAdapter', () => {
  it('declares the only tier this product ships', () => {
    expect(pdfTextAdapter).toMatchObject({ id: 'pdf-text', tier: 'E0' });
  });

  it('accepts a PDF by type or by extension', () => {
    expect(pdfTextAdapter.supports(new File([], 'a.pdf', { type: 'application/pdf' }))).toBe(true);
    expect(pdfTextAdapter.supports(new File([], 'a.PDF'))).toBe(true);
    expect(pdfTextAdapter.supports(new File([], 'a.png', { type: 'image/png' }))).toBe(false);
  });

  it('hands the seam plain data, and no vendor object', async () => {
    const output = await pdfTextAdapter.extract(
      pdf('ahfy-minimal'),
      'ahfy-minimal',
      new AbortController().signal,
    );

    expect(output.kind).toBe('textItems');
    expect(JSON.parse(JSON.stringify(output.pages))).toEqual(output.pages);
  });
});

describe('the self-hosted worker', () => {
  it('matches the bytes of the pinned package', () => {
    // Every browser byte is first-party (D1, ADR-0015). This is the check that
    // a version bump cannot silently leave the served worker behind the
    // library that loads it: `pnpm sync:pdf-worker` copies it again.
    expect(readFileSync(HOSTED)).toEqual(readFileSync(PACKAGED));
  });
});
