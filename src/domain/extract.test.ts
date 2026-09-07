import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extract } from './extract';
import { REGISTRY_VERSION } from './registry';
import type { ExtractionResult, TextItem } from './types';

const SEED = new URL('../../fixtures/seed/', import.meta.url);

function pages(name: string): TextItem[][] {
  const parsed = JSON.parse(readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8')) as {
    fragmented: { pages: TextItem[][] };
  };
  return parsed.fragmented.pages;
}

function extracted(name: string): ExtractionResult {
  return extract({ sourceId: name, adapterId: 'pdf-text', tier: 'E0', pages: pages(name) });
}

/** One page carrying a five-column table, built on top of a valid document. */
function withRows(rows: string[][]): ExtractionResult {
  const source = pages('ahfy-minimal');
  const [first, second] = source;
  if (first === undefined || second === undefined) {
    throw new Error('the seed document lost a page');
  }

  // Keep page 2's header row — Pass V binds the columns from it — and print
  // the given rows underneath in the header's own x bands.
  const header = second.filter((item) => item.y < 0.18);
  const bands = [0.131, 0.3837, 0.5101, 0.6364, 0.7628];

  const printed = rows.flatMap((cells, row) =>
    cells.flatMap((text, column) =>
      text === ''
        ? []
        : [
            {
              id: `t${String(row)}-${String(column)}`,
              text,
              x: bands[column] ?? 0.9,
              y: 0.3 + row * 0.03,
              w: text.length * 0.008,
              h: 0.014,
            },
          ],
    ),
  );

  return extract({
    sourceId: 'synthetic',
    adapterId: 'pdf-text',
    tier: 'E0',
    pages: [first, [...header, ...printed]],
  });
}

describe('extract', () => {
  describe('the result it stamps', () => {
    it('carries the adapter, the registry version and the dates Pass V bound', () => {
      expect(extracted('ahfy-full')).toMatchObject({
        sourceId: 'ahfy-full',
        adapterId: 'pdf-text',
        tier: 'E0',
        registryVersion: REGISTRY_VERSION,
        collectionDate: '2025-05-14',
        resultDate: '2025-05-15',
        evidenceAvailable: true,
      });
    });

    it('carries the pages through as review evidence', () => {
      const result = extracted('ahfy-minimal');

      expect(result.evidencePages).toEqual(pages('ahfy-minimal'));
    });

    it('raises the document’s identifier candidates', () => {
      const kinds = extracted('ahfy-full').identifierCandidates.map((each) => each.kind);

      expect(kinds).toContain('national-id');
      expect(kinds).toContain('name');
      expect(kinds).toContain('patient-id');
    });

    it('gives every row a source reference and a document-order index', () => {
      const rows = extracted('ahfy-full').rows;

      expect(rows.every((row) => row.sourceRef !== undefined)).toBe(true);
      expect(rows.map((row) => row.sourceOrder)).toEqual(rows.map((_row, index) => index));
    });

    it('orders rows as the document prints them', () => {
      const pagesRead = extracted('ahfy-full').rows.map((row) => row.sourceRef?.page ?? 0);

      expect([...pagesRead].sort((a, b) => a - b)).toEqual(pagesRead);
    });
  });

  describe('the gate', () => {
    it('refuses a document Pass V rejects', () => {
      // `fileRouter` runs the same gate and turns this into a typed
      // `RouteFailure`; there is no ExtractionResult without a collection date.
      expect(() => extract({ sourceId: 'x', adapterId: 'a', tier: 'E0', pages: [[]] })).toThrow(
        /not-ahfy-document/u,
      );
    });
  });

  describe('rows the registry does not know (D5)', () => {
    it('reads a table row positionally and derives an x: marker key', () => {
      const result = withRows([['Νεοδείκτης (ND)', '12.5', 'mg/L', '2 - 20', '']]);
      const row = result.rows.find((each) => each.markerKey.startsWith('x:'));

      expect(row).toMatchObject({
        markerKey: 'x:νεοδεικτησ-nd',
        label: 'Νεοδείκτης (ND)',
        status: 'value',
        value: 12.5,
        unit: 'mg/L',
        referenceRange: { kind: 'closed', min: 2, max: 20 },
        source: 'anchor',
        confidence: 'low',
      });
    });

    it('reports every unknown label as a registry gap', () => {
      expect(withRows([['Νεοδείκτης (ND)', '12.5', 'mg/L', '2 - 20', '']]).unrecognised).toEqual([
        'Νεοδείκτης (ND)',
      ]);
    });

    it('never reports a canonical marker as a gap', () => {
      // Reading the label column top to bottom reassembles a wrapped label
      // Pass A could not anchor, and some resolve to a canonical marker after
      // all. Those are rows, not registry gaps.
      const result = extracted('ahfy-full');

      expect(result.unrecognised.every((label) => label !== '')).toBe(true);
      expect(result.unrecognised).not.toContain('25-υδροξυβιταμίνη D [25(ΟΗ)D] (Vit-D 25(ΟΗ))');
      expect(result.rows.map((row) => row.markerKey)).toContain('vitamin-d');
    });

    it('reads no measurement from the page’s own furniture', () => {
      // A repeated table header and a letter-spaced banner heading both fill
      // the value column without printing a number, an interval or a unit.
      const result = withRows([
        ['Περιγραφή', 'Αποτέλεσμα', 'Μονάδα Μέτρησης', 'Φυσιολογικές Τιμές', 'Παρατηρήσεις'],
        ['Γ Ε Ν', 'Ι Κ Η Ε Ξ', 'Ε Τ Α Σ Η', 'Α Ι Μ', ''],
      ]);

      expect(result.rows.filter((row) => row.markerKey.startsWith('x:'))).toEqual([]);
      expect(result.unrecognised).toEqual([]);
    });

    it('keeps a unit-only row as a missing measurement', () => {
      // A differential sub-row prints `%` and no result. Dropping it would lose
      // a printed row the laboratory reported on. The label here is one no
      // registry entry claims, because the subject is the shape of the row
      // rather than the marker — Task 2.5r has since named most of these.
      const row = withRows([['Νεοδείκτης (ΝΔ)', '', '%', '', '']]).rows.find((each) =>
        each.markerKey.startsWith('x:'),
      );

      expect(row).toMatchObject({ status: 'missing', value: null, unit: '%' });
    });

    it('never reads the metadata block above the first table', () => {
      const result = extracted('ahfy-full');

      expect(result.rows.some((row) => row.sourceRef?.page === 1)).toBe(false);
      expect(result.unrecognised.some((label) => label.includes('ΑΜΚΑ'))).toBe(false);
    });
  });

  describe('confidence the whole document decides', () => {
    it('retains an implausible value, tagged and demoted', () => {
      // Never clamped and never dropped: review sorts it to the top and the
      // user decides whether the laboratory or the parser is wrong.
      const row = withRows([['WBC (WBC)', '9999', 'k/μl', '4,0-11,0', '']]).rows.find(
        (each) => each.markerKey === 'wbc',
      );

      expect(row).toMatchObject({ value: 9999, confidence: 'low' });
      expect(row?.flags).toContain('implausible-value');
    });

    it('leaves a plausible value at its tier', () => {
      const row = withRows([['WBC (WBC)', '6,93', 'k/μl', '4,0-11,0', '']]).rows.find(
        (each) => each.markerKey === 'wbc',
      );

      expect(row).toMatchObject({ value: 6.93, confidence: 'high', flags: [] });
    });

    it('flags two anchors that competed for one row’s cells', () => {
      const result = withRows([['WBC (WBC) RBC (RBC)', '6,93', 'k/μl', '4,0-11,0', '']]);
      const competing = result.rows.filter((row) => row.flags.includes('competing-anchor'));

      expect(competing.map((row) => row.markerKey).sort()).toEqual(['rbc', 'wbc']);
      expect(competing.every((row) => row.confidence !== 'high')).toBe(true);
    });

    it('never promotes a row above what the read-out graded it', () => {
      const rows = extracted('ahfy-full').rows;
      const crp = rows.find((row) => row.markerKey === 'crp');

      expect(crp?.confidence).toBe('medium');
    });
  });

  describe('the seed documents', () => {
    it('reads every anchored row and every unknown table row', () => {
      expect(extracted('ahfy-minimal').rows).toHaveLength(20);
      expect(extracted('ahfy-minimal').unrecognised).toEqual([]);

      const full = extracted('ahfy-full');
      expect(full.rows).toHaveLength(82);
      // Task 2.5r names eight of the nine Task 1.6b-core left unknown. eGFR is
      // the one that remains, and it stays out for a unit reason rather than a
      // vocabulary one — see `recovers the registry gaps the plan names`.
      expect(full.rows.filter((row) => row.markerKey.startsWith('x:'))).toHaveLength(1);
    });

    it('recovers the registry gaps the plan names', () => {
      // A marker no panel claims must reach review as an unknown rather than
      // vanishing, which is what Task 2.5b measures from here. eGFR is the one
      // left, and not for want of a printed name: the unit it is reported in,
      // `mL/min/1.73m^2`, is not on the `units.ts` allowlist, and the plan
      // keeps a numeric marker out of the registry until its unit is carried.
      const { unrecognised, rows } = extracted('ahfy-full');
      const keys = rows.map((row) => row.markerKey);

      expect(unrecognised).toEqual(['ρυθμός σπειραματικής διήθησης (Estimated GFR 2021 CKD-EPI']);
      expect(keys).toContain('pdw');
      expect(keys).toContain('band-neutrophils');
      expect(keys).toContain('ast');
    });

    it('closes two of Pass A’s four measured gaps by reading positionally', () => {
      // `alt` and `vitamin-d` both print a label that wraps, which costs them
      // an anchor. The label column, read top to bottom, reassembles it.
      const keys = extracted('ahfy-full').rows.map((row) => row.markerKey);

      expect(keys).toContain('alt');
      expect(keys).toContain('vitamin-d');
    });
  });
});
