import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clusterRows } from './rows';
import type { Row, TextItem } from './types';

const SEED = new URL('../../fixtures/seed/', import.meta.url);

function fixturePages(name: string): TextItem[][] {
  const parsed = JSON.parse(readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8')) as {
    fragmented: { pages: TextItem[][] };
  };
  return parsed.fragmented.pages;
}

function item(id: string, x: number, y: number, h = 0.014, text = id): TextItem {
  return { id, text, x, y, w: 0.05, h };
}

function texts(row: Row | undefined): string {
  return (row?.items ?? []).map((member) => member.text).join(' ');
}

/**
 * The wrapped-label geometry, as `ahfy-full` page 2 prints it.
 *
 * The laboratory centres the single-line value against the two-line label, so
 * the value band sits *between* the label's lines: three bands 0.0065 apart,
 * against a 0.0141 line height.
 */
const WRAPPED = [
  item('label-1', 0.131, 0.28833, 0.0141, 'Μέσος Όγκος Ερυθρών (ΜCV)'),
  item('value', 0.384, 0.29486, 0.0141, '90.4'),
  item('label-2', 0.131, 0.3014, 0.0141, '(MCV)'),
];

describe('clusterRows', () => {
  describe('the sharing rule', () => {
    it('joins two items whose centres differ by less than 0.6 heights', () => {
      // 0.6 × 0.01 = 0.006; these centres differ by 0.0059.
      const rows = clusterRows('s', [[item('a', 0.1, 0.2, 0.01), item('b', 0.3, 0.2059, 0.01)]]);

      expect(rows).toHaveLength(1);
      expect(texts(rows[0])).toBe('a b');
    });

    it('separates two items further apart than that', () => {
      const rows = clusterRows('s', [[item('a', 0.1, 0.2, 0.01), item('b', 0.3, 0.2061, 0.01)]]);

      expect(rows).toHaveLength(2);
    });

    it('separates the two populations the corpus actually contains', () => {
      // The bound is written strict, but a pair landing exactly on it is
      // decided by IEEE rounding rather than by the rule — 0.2 and 0.206 at
      // height 0.01 give a centre gap of 0.005999999999999978. Nothing real
      // lands there: against the 0.0141 line height the threshold is 0.0085,
      // and the two spacings a laboratory prints are 0.0065 and 0.020, each
      // some 25% clear of it. That margin is the property worth pinning.
      const wrap = clusterRows('s', [
        [item('a', 0.131, 0.28833, 0.0141), item('b', 0.384, 0.29486, 0.0141)],
      ]);
      const between = clusterRows('s', [
        [item('a', 0.131, 0.22478, 0.0141), item('b', 0.131, 0.24616, 0.0141)],
      ]);

      expect(wrap).toHaveLength(1);
      expect(between).toHaveLength(2);
    });

    it('measures against the smaller of the two heights', () => {
      // A tall item must not drag in a short one it merely overlaps: the
      // threshold is 0.6 × 0.01, not 0.6 × 0.04.
      const tall = item('tall', 0.1, 0.18, 0.04);
      const short = item('short', 0.3, 0.208, 0.01);

      expect(tall.y).toBeLessThan(short.y + short.h);
      expect(short.y).toBeLessThan(tall.y + tall.h);
      expect(clusterRows('s', [[tall, short]])).toHaveLength(2);
    });

    it('compares centres, not edges', () => {
      // Same centre, wildly different heights: one row, though neither edge
      // aligns with the other's.
      const rows = clusterRows('s', [[item('a', 0.1, 0.19, 0.04), item('b', 0.3, 0.205, 0.01)]]);

      expect(rows).toHaveLength(1);
    });
  });

  describe('the wrapped label', () => {
    it('reaches the second label line through the value band between them', () => {
      // label-2 is 0.0131 from label-1, further than the threshold allows. It
      // joins only because the value sits between them, so the rule has to be
      // transitive across the cluster to hold this row together.
      const rows = clusterRows('s', [WRAPPED]);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.items).toHaveLength(3);
    });

    it('spans the band of every line it holds', () => {
      const [row] = clusterRows('s', [WRAPPED]);

      // Top of the first label line to the bottom of the second.
      expect(row?.y).toBe(0.28833);
      expect(row?.h).toBeCloseTo(0.3014 + 0.0141 - 0.28833, 10);
    });

    it('keeps consecutive printed rows apart at the real 0.02 spacing', () => {
      const rows = clusterRows('s', [
        [
          item('first', 0.131, 0.22478),
          item('second', 0.131, 0.24616),
          item('third', 0.131, 0.26754),
        ],
      ]);

      expect(rows).toHaveLength(3);
    });
  });

  describe('ordering', () => {
    it('returns rows top to bottom whatever order the items arrive in', () => {
      const rows = clusterRows('s', [
        [item('c', 0.1, 0.5), item('a', 0.1, 0.1), item('b', 0.1, 0.3)],
      ]);

      expect(rows.map((row) => texts(row))).toEqual(['a', 'b', 'c']);
    });

    it('orders a row left to right', () => {
      const rows = clusterRows('s', [
        [item('right', 0.8, 0.2), item('left', 0.1, 0.2), item('middle', 0.4, 0.2)],
      ]);

      expect(texts(rows[0])).toBe('left middle right');
    });

    it('breaks an x tie by y, so the order is total', () => {
      // A wrapped label's two lines start at the same x. Ordering by x alone
      // would leave their relative order up to the input.
      const rows = clusterRows('s', [WRAPPED]);

      expect(texts(rows[0])).toBe('Μέσος Όγκος Ερυθρών (ΜCV) (MCV) 90.4');
    });

    it('is deterministic across a shuffled input', () => {
      const page = [...WRAPPED];
      const forward = clusterRows('s', [page]);
      const reversed = clusterRows('s', [[...page].reverse()]);

      expect(reversed).toEqual(forward);
    });

    it('leaves the caller’s array untouched', () => {
      const page = [item('b', 0.3, 0.5), item('a', 0.1, 0.1)];
      const order = page.map((member) => member.id);

      clusterRows('s', [page]);

      expect(page.map((member) => member.id)).toEqual(order);
    });
  });

  describe('the Row itself', () => {
    it('carries the source, a 1-based page and a stable id', () => {
      const rows = clusterRows('doc-7', [[item('a', 0.1, 0.1)], [item('b', 0.1, 0.1)]]);

      expect(rows).toEqual([
        expect.objectContaining({ id: 'doc-7:row:1', sourceId: 'doc-7', page: 1 }),
        expect.objectContaining({ id: 'doc-7:row:2', sourceId: 'doc-7', page: 2 }),
      ]);
    });

    it('numbers rows through the document, not per page', () => {
      const rows = clusterRows('s', [
        [item('a', 0.1, 0.1), item('b', 0.1, 0.5)],
        [item('c', 0.1, 0.1)],
      ]);

      expect(rows.map((row) => row.id)).toEqual(['s:row:1', 's:row:2', 's:row:3']);
    });

    it('hands back the adapter’s own observations, not copies', () => {
      // Every downstream box, offset and crop is measured against what pdf.js
      // reported, so the item a caller inspects must be the item it passed in.
      const original = item('a', 0.1, 0.2);
      const [row] = clusterRows('s', [[original]]);

      expect(row?.items[0]).toBe(original);
    });

    it('takes a lone item’s band exactly as measured', () => {
      const [row] = clusterRows('s', [[item('a', 0.1, 0.018848, 0.015665)]]);

      expect(row?.y).toBe(0.018848);
      expect(row?.h).toBe(0.015665);
    });

    it('reads nothing from nothing', () => {
      expect(clusterRows('s', [])).toEqual([]);
      expect(clusterRows('s', [[]])).toEqual([]);
      expect(clusterRows('s', [[], []])).toEqual([]);
    });
  });

  describe('the seed fixtures', () => {
    it.each(['ahfy-full', 'ahfy-minimal', 'not-ahfy'])('partitions every item of %s', (name) => {
      const pages = fixturePages(name);
      const rows = clusterRows(name, pages);

      const clustered = rows.flatMap((row) => row.items);
      expect(clustered).toHaveLength(pages.flat().length);
      expect(new Set(clustered.map((member) => member.id)).size).toBe(clustered.length);
    });

    it.each(['ahfy-full', 'ahfy-minimal'])('keeps %s rows ordered within each page', (name) => {
      const rows = clusterRows(name, fixturePages(name));

      for (const [index, row] of rows.entries()) {
        const next = rows[index + 1];
        if (next?.page === row.page) {
          expect(next.y).toBeGreaterThan(row.y);
        }
      }
    });

    it('reads one ΑΗΦΥ measurement per row, wraps included', () => {
      const rows = clusterRows('ahfy-full', fixturePages('ahfy-full')).filter(
        (row) => row.page === 2,
      );

      // The five-column header prints across three bands and is one row.
      expect(texts(rows[3])).toBe(
        'Περιγραφή Αποτέλεσμα Μονάδα Μέτρησης Φυσιολογικές Τιμές Παρατηρήσεις',
      );

      // An unwrapped measurement row holds its label, value, unit and range.
      expect(texts(rows[6])).toBe('Ερυθρά Αιμοσφαίρια (RBC) (RBC) 5.29 x10^6 / μL 4.4 - 6.3');

      // A wrapped one holds all three bands. Left to right interleaves the
      // label's two lines, which is the row's order and not the label's:
      // rebuilding the label is the job of a caller with the column roles.
      expect(texts(rows[9])).toBe('Μέσος (MCV) Όγκος Ερυθρών (ΜCV) 90.4 fl 77 - 100');
    });

    it('never merges two ΑΗΦΥ measurements into one row', () => {
      // The threshold sits between the two populations the corpus contains:
      // 0.0065 inside a wrapped row, 0.020 between rows. If it drifted, rows
      // would chain down the page and this count would collapse.
      const rows = clusterRows('ahfy-full', fixturePages('ahfy-full'));

      expect(rows).toHaveLength(307);
    });
  });
});
