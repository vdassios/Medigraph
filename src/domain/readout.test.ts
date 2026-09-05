import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAhfyDocument } from './ahfyDocument';
import { findAnchors } from './anchors';
import { readAnchor } from './readout';
import { clusterRows } from './rows';
import { normaliseLabel } from './text';
import { normaliseUnit } from './units';
import type { ParsedRow, ReferenceRange, Row, TextItem } from './types';

const SEED = new URL('../../fixtures/seed/', import.meta.url);

function pages(name: string): TextItem[][] {
  const parsed = JSON.parse(readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8')) as {
    fragmented: { pages: TextItem[][] };
  };
  return parsed.fragmented.pages;
}

interface ExpectedRow {
  page: number;
  label: string;
  status: string;
  value: number | null;
  comparator: string | null;
  unit: string | null;
  referenceRange: ReferenceRange | null;
}

function expectations(name: string): ExpectedRow[] {
  const parsed = JSON.parse(readFileSync(new URL(`${name}.expected.json`, SEED), 'utf8')) as {
    rows: ExpectedRow[];
  };
  return parsed.rows;
}

/** Read a whole seed document the way `extract` will: Pass V, rows, Pass A. */
function readFixture(name: string): ParsedRow[] {
  const validation = validateAhfyDocument(pages(name));
  if (!validation.ok) {
    throw new Error(`expected an ΑΗΦΥ document, got ${validation.reason}`);
  }

  const rows = clusterRows(name, pages(name));
  const anchors = findAnchors(rows, validation.document.sectionTitles);
  const byId = new Map(rows.map((row) => [row.id, row]));

  return anchors.flatMap((anchor) => {
    const row = byId.get(anchor.id.slice(0, anchor.id.indexOf(':anchor:')));
    return row === undefined ? [] : [readAnchor(anchor, row, rows, anchors)];
  });
}

/**
 * The row an expectation is about.
 *
 * An anchor's label is the matched span, so it is a substring of the printed
 * label cell the independent derivation recorded. The longest such span wins,
 * which is what keeps `(MCHC)` from being answered by `(MCH)`.
 */
function match(rows: readonly ParsedRow[], expected: ExpectedRow): ParsedRow | undefined {
  const printed = normaliseLabel(expected.label);

  return rows
    .filter((row) => row.sourceRef?.page === expected.page)
    .filter((row) => printed.includes(normaliseLabel(row.label)))
    .sort((a, b) => b.label.length - a.label.length)[0];
}

/** One synthetic row, its items laid out left to right on page 1. */
function row(texts: string[], overrides: Partial<Row> = {}): Row {
  let x = 0.131;
  const items = texts.map((text, index) => {
    const item = { id: `i${String(index)}`, text, x, y: 0.2, w: text.length * 0.008, h: 0.014 };
    x += item.w + 0.01;
    return item;
  });

  return { id: 'r1', sourceId: 's', page: 1, items, y: 0.2, h: 0.014, ...overrides };
}

/** Read the first anchor of a synthetic row, as `extract` would. */
function read(texts: string[]): ParsedRow {
  return readRows([row(texts)])[0] ?? fail();
}

function readRows(rows: readonly Row[]): ParsedRow[] {
  const anchors = findAnchors(rows, []);
  const byId = new Map(rows.map((each) => [each.id, each]));

  return anchors.flatMap((anchor) => {
    const owner = byId.get(anchor.id.slice(0, anchor.id.indexOf(':anchor:')));
    return owner === undefined ? [] : [readAnchor(anchor, owner, rows, anchors)];
  });
}

function fail(): never {
  throw new Error('the row anchored no marker');
}

describe('readAnchor', () => {
  describe('the neighbourhood', () => {
    it('reads the cells printed to the right of the anchor', () => {
      expect(read(['WBC', '5.03', 'x10^3', '/', 'μL', '4', '-', '10.5'])).toMatchObject({
        markerKey: 'wbc',
        status: 'value',
        value: 5.03,
        unit: normaliseUnit('x10^3/μL'),
        referenceRange: { kind: 'closed', min: 4, max: 10.5 },
      });
    });

    it('reads a cell stacked directly below the anchor', () => {
      // The narrow-column layout § A2 allows for: the value is under the
      // label rather than beside it, and no item sits to the right at all.
      const label: TextItem = { id: 'a', text: 'WBC', x: 0.13, y: 0.2, w: 0.03, h: 0.014 };
      const value: TextItem = { id: 'b', text: '5.03', x: 0.13, y: 0.22, w: 0.03, h: 0.014 };

      const rows: Row[] = [
        { id: 'r1', sourceId: 's', page: 1, items: [label], y: 0.2, h: 0.014 },
        { id: 'r2', sourceId: 's', page: 1, items: [value], y: 0.22, h: 0.014 },
      ];

      expect(readRows(rows)[0]).toMatchObject({ markerKey: 'wbc', value: 5.03 });
    });

    it('reads to the left when nothing sits right of the anchor', () => {
      // A right-aligned label prints its value first. `5.03` is left of the
      // anchor, so only the third search direction reaches it.
      expect(read(['5.03', 'WBC'])).toMatchObject({ markerKey: 'wbc', value: 5.03 });
    });

    it('reads the rest of a whole printed line lexically', () => {
      // Pass V rejects a document whose pages are one item per line, but a
      // single row may still arrive collapsed, and § A2's lexical mode is
      // what reads it: tokens after the anchor, in token order.
      const line = row(['WBC (WBC) 5.03 x10^3 / μL 4 - 10.5']);

      expect(readRows([line])[0]).toMatchObject({
        markerKey: 'wbc',
        value: 5.03,
        unit: normaliseUnit('x10^3/μL'),
        referenceRange: { kind: 'closed', min: 4, max: 10.5 },
      });
    });

    it('never reads a value from another line in lexical mode', () => {
      // The reference range is printed on the line below, directly under the
      // anchor. Lexical mode reads this line and stops at its end.
      const first = row(['WBC (WBC) 5.03 k/μl']);
      const second: Row = {
        id: 'r2',
        sourceId: 's',
        page: 1,
        items: [{ id: 'j0', text: '4 - 10.5', x: 0.131, y: 0.215, w: 0.064, h: 0.014 }],
        y: 0.215,
        h: 0.014,
      };

      expect(readRows([first, second])[0]).toMatchObject({
        markerKey: 'wbc',
        value: 5.03,
        unit: normaliseUnit('k/μl'),
        referenceRange: null,
      });
    });
  });

  describe('numeric groups', () => {
    it('joins a standalone comparator to the number after it', () => {
      expect(read(['CRP', '<', '1.03', 'mg/L', '<', '5'])).toMatchObject({
        value: 1.03,
        comparator: '<',
        unit: 'mg/L',
        referenceRange: { kind: 'maxOnly', comparator: '<', max: 5 },
      });
    });

    it('reads a comparator glued to its number identically', () => {
      expect(read(['CRP', '<1.03', 'mg/L', '<5'])).toMatchObject({
        value: 1.03,
        comparator: '<',
        referenceRange: { kind: 'maxOnly', comparator: '<', max: 5 },
      });
    });

    it('joins a range split across fragments', () => {
      expect(read(['WBC', '5.03', '4', '-', '10.5']).referenceRange).toEqual({
        kind: 'closed',
        min: 4,
        max: 10.5,
      });
    });

    it('reads a glued range and a comma decimal the same way', () => {
      expect(read(['WBC', '6,93', 'k/μl', '4,0-11,0'])).toMatchObject({
        value: 6.93,
        unit: normaliseUnit('k/μl'),
        referenceRange: { kind: 'closed', min: 4, max: 11 },
      });
    });

    it('separates a unit glued to its number', () => {
      // Splitting here is lexical, so the two halves keep the box the
      // adapter measured for the fragment they came from.
      expect(read(['CRP', '1.03mg/L'])).toMatchObject({ value: 1.03, unit: 'mg/L' });
    });

    it('preserves the printed strictness of a one-sided range', () => {
      expect(read(['CRP', '1.03', 'mg/L', '≤', '5']).referenceRange).toEqual({
        kind: 'maxOnly',
        comparator: '<=',
        max: 5,
      });
      expect(read(['CRP', '1.03', 'mg/L', '>', '5']).referenceRange).toEqual({
        kind: 'minOnly',
        comparator: '>',
        min: 5,
      });
    });

    it('reads a textual “up to” as an inclusive maximum', () => {
      // Only a printed symbol carries strictness; `Έως` is inclusive.
      expect(read(['CRP', '1.03', 'mg/L', 'Έως', '5']).referenceRange).toEqual({
        kind: 'maxOnly',
        comparator: '<=',
        max: 5,
      });
    });
  });

  describe('roles', () => {
    it('reads a sole interval as a range with no value', () => {
      // A single measurement is never printed as an interval, so this row is
      // a reference range whose result the laboratory left blank.
      expect(read(['WBC', '4', '-', '10.5'])).toMatchObject({
        status: 'missing',
        value: null,
        referenceRange: { kind: 'closed', min: 4, max: 10.5 },
      });
    });

    it('assigns the two-sided group to the range whatever the printed order', () => {
      expect(read(['WBC', '4-10.5', '5.03'])).toMatchObject({
        status: 'value',
        value: 5.03,
        referenceRange: { kind: 'closed', min: 4, max: 10.5 },
      });
    });

    it('reads a comparator group with a recognised unit as the value', () => {
      // `< 1.03 mg/L` is a result under the assay's floor; `< 5` beside it is
      // the reference. The unit is the only thing that tells them apart.
      expect(read(['CRP', '<', '1.03', 'mg/L', '<', '5'])).toMatchObject({
        status: 'value',
        value: 1.03,
        comparator: '<',
      });
    });

    it('keeps a comparator group it cannot place, and says so', () => {
      // Discarding it would lose a printed measurement and choosing silently
      // would invent one, so it is preserved for review at low confidence.
      expect(read(['CRP', '<', '5'])).toMatchObject({
        status: 'value',
        value: 5,
        comparator: '<',
        confidence: 'low',
        flags: ['ambiguous-role'],
      });
    });

    it('reads a numeric cell that also carries a word (D15)', () => {
      // `6.0 Όξινη` is the number with the laboratory's gloss beside it. The
      // number is the measurement; § A2 then reads the token following the
      // value as the unit, so the gloss is stored — flagged and demoted —
      // rather than silently dropped.
      expect(read(['Αντίδραση', 'PH', '(PH)', '6.0', 'Όξινη', '4.5', '-', '7.5'])).toMatchObject({
        markerKey: 'urine-ph',
        status: 'value',
        value: 6,
        unit: normaliseUnit('Όξινη'),
        flags: ['unrecognised-unit'],
        referenceRange: { kind: 'closed', min: 4.5, max: 7.5 },
      });
    });
  });

  describe('non-numeric results (D15)', () => {
    it('reads a printed word as a categorical result', () => {
      expect(read(['Χροιά', '(Χροιά)', 'Ωχροκίτρινη', 'Κίτρινη'])).toMatchObject({
        markerKey: 'urine-colour',
        status: 'categorical',
        value: null,
        comparator: null,
        unit: null,
        referenceRange: null,
        textValue: 'Ωχροκίτρινη',
        categoricalReference: 'Κίτρινη',
      });
    });

    it('keeps a compound reference verbatim', () => {
      expect(read(['Λεύκωμα', '(Λεύκωμα)', 'Αρνητικό', 'Αρνητικό(<=10', 'mg/dl)'])).toMatchObject({
        markerKey: 'urine-protein',
        status: 'categorical',
        textValue: 'Αρνητικό',
        categoricalReference: 'Αρνητικό(<=10 mg/dl)',
      });
    });

    it('emits a missing row rather than a categorical one when nothing follows', () => {
      expect(read(['Χροιά', '(Χροιά)'])).toMatchObject({
        markerKey: 'urine-colour',
        status: 'missing',
        textValue: null,
      });
    });
  });

  describe('units', () => {
    it('accepts a unit spanning up to three printed tokens', () => {
      expect(read(['WBC', '5.03', 'x10^3', '/', 'μL']).unit).toBe(normaliseUnit('x10^3/μL'));
    });

    it('folds the count prefixes a laboratory prints before a slash', () => {
      expect(read(['RBC', '5.23', 'Μ/μl']).unit).toBe(normaliseUnit('M/μL'));
      expect(read(['WBC', '6.93', 'Κ/μl']).unit).toBe(normaliseUnit('K/μL'));
    });

    it('stores an unrecognised unit as printed, flagged and demoted', () => {
      // Review must keep seeing what the laboratory printed; acceptance is
      // not a precondition for storing it.
      expect(read(['WBC', '5.03', 'zz/qq'])).toMatchObject({
        unit: normaliseUnit('zz/qq'),
        confidence: 'medium',
        flags: ['unrecognised-unit'],
      });
    });

    it('never reads a range bound as a unit', () => {
      expect(
        read(['Ειδικό', 'βάρος', '(Ειδικό', 'βάρος)', '1031', '1010', '-', '1030']),
      ).toMatchObject({
        markerKey: 'urine-specific-gravity',
        value: 1031,
        unit: null,
        referenceRange: { kind: 'closed', min: 1010, max: 1030 },
      });
    });

    it('strips a recognised unit repeated inside the range cell', () => {
      expect(read(['WBC', '6,93', 'k/μl', '4,0', '-', '10,0', 'k/μl'])).toMatchObject({
        value: 6.93,
        referenceRange: { kind: 'closed', min: 4, max: 10 },
        flags: [],
      });
    });

    it('fails a range loudly when its remainder is not a unit', () => {
      // `parseRange` rejects a trailing token rather than skipping it, so an
      // unaccounted remainder reaches review instead of being discarded.
      expect(read(['WBC', '6,93', 'k/μl', '4,0', '-', '10,0', 'κ.ο.π.'])).toMatchObject({
        value: 6.93,
        referenceRange: null,
        confidence: 'medium',
        flags: ['unparsed-range'],
      });
    });
  });

  describe('stop conditions', () => {
    it('stops at the next anchor on the same row', () => {
      // Two markers share a printed row. The first must not read the second's
      // result, so it reads nothing at all.
      const [first, second] = readRows([row(['WBC', 'RBC', '5.29'])]);

      expect(first).toMatchObject({ markerKey: 'wbc', status: 'missing', value: null });
      expect(second).toMatchObject({ markerKey: 'rbc', status: 'value', value: 5.29 });
    });

    it('stops at the next anchor below', () => {
      const label: TextItem = { id: 'a', text: 'WBC', x: 0.13, y: 0.2, w: 0.03, h: 0.014 };
      const next: TextItem = { id: 'b', text: 'RBC', x: 0.13, y: 0.215, w: 0.03, h: 0.014 };
      const value: TextItem = { id: 'c', text: '5.29', x: 0.13, y: 0.23, w: 0.03, h: 0.014 };

      const rows: Row[] = [
        { id: 'r1', sourceId: 's', page: 1, items: [label], y: 0.2, h: 0.014 },
        { id: 'r2', sourceId: 's', page: 1, items: [next], y: 0.215, h: 0.014 },
        { id: 'r3', sourceId: 's', page: 1, items: [value], y: 0.23, h: 0.014 },
      ];

      expect(readRows(rows)[0]).toMatchObject({ markerKey: 'wbc', status: 'missing' });
    });

    it('stops after a horizontal gap wider than a quarter of the page', () => {
      const label: TextItem = { id: 'a', text: 'WBC', x: 0.13, y: 0.2, w: 0.03, h: 0.014 };
      const far: TextItem = { id: 'b', text: '5.03', x: 0.45, y: 0.2, w: 0.03, h: 0.014 };

      const rows: Row[] = [
        { id: 'r1', sourceId: 's', page: 1, items: [label, far], y: 0.2, h: 0.014 },
      ];

      expect(readRows(rows)[0]).toMatchObject({ markerKey: 'wbc', status: 'missing' });
    });

    it('does not widen when the neighbourhood holds no value', () => {
      expect(read(['WBC'])).toMatchObject({ status: 'missing', value: null, unit: null });
    });
  });

  describe('confidence and flags', () => {
    it('keeps the tier the anchor matched at when the row reads cleanly', () => {
      expect(read(['WBC', '5.03', 'k/μl', '4', '-', '10.5'])).toMatchObject({
        confidence: 'high',
        flags: [],
      });
    });

    it('demotes a value carrying a comparator to medium', () => {
      expect(read(['CRP', '<', '1.03', 'mg/L', '<', '5']).confidence).toBe('medium');
    });

    it('flags an ambiguous thousands separator and forces low confidence', () => {
      // `250.000` is either 250 or 250000 and the document never says which.
      expect(read(['WBC', '250.000', 'k/μl'])).toMatchObject({
        value: 250,
        confidence: 'low',
        flags: ['ambiguous-thousands'],
      });
    });

    it('demotes a row whose value is missing to low', () => {
      expect(read(['WBC', '4', '-', '10.5']).confidence).toBe('low');
    });

    it('never promotes above the tier the anchor matched at', () => {
      // `Φερριτίν` is one edit from the registry alias, so the anchor is T4.
      expect(read(['Φερριτίν', '45.5', 'ng/mL', '30', '-', '400'])).toMatchObject({
        markerKey: 'ferritin',
        confidence: 'medium',
      });
    });
  });

  describe('the row it emits', () => {
    it('carries the marker, section and source order of its anchor', () => {
      const rows = readRows([row(['WBC', '5.03']), row(['RBC', '5.29'], { id: 'r2', y: 0.3 })]);

      expect(rows.map((each) => each.sourceOrder)).toEqual([0, 1]);
      expect(rows[0]).toMatchObject({ markerKey: 'wbc', source: 'anchor', section: null });
    });

    it('points at every box it read, and none it did not', () => {
      const parsed = readRows([row(['WBC', '(WBC)', '5.03'])])[0];

      // The first `WBC` is neither the anchor nor a cell it consumed.
      expect(parsed?.sourceRef?.itemIds).toEqual(['i1', 'i2']);
    });
  });

  describe('the seed fixtures', () => {
    it.each(['ahfy-full', 'ahfy-minimal'])(
      'reads %s as the independent derivation says',
      (name) => {
        const rows = readFixture(name);
        const gaps = new Set(['Ουροχολινογόνο', 'Ερυθρά αιμοσφαίρια (Ερυθρά']);

        for (const expected of expectations(name).filter((each) => !gaps.has(each.label))) {
          const actual = match(rows, expected);

          expect(actual, `no row read for ${expected.label}`).toBeDefined();
          expect({
            status: actual?.status,
            value: actual?.value,
            comparator: actual?.comparator,
            unit: actual?.unit,
            referenceRange: actual?.referenceRange,
          }).toEqual({
            status: expected.status,
            value: expected.value,
            comparator: expected.comparator,
            unit: expected.unit === null ? null : normaliseUnit(expected.unit),
            referenceRange: expected.referenceRange,
          });
        }
      },
    );

    it('emits one row per anchor, and reads a result into all but one', () => {
      // Every anchored row yields a ParsedRow. The single exception on
      // ahfy-full is the urine leukocyte count, whose result cell prints an
      // interval rather than a measurement.
      expect(readFixture('ahfy-minimal')).toHaveLength(20);

      const full = readFixture('ahfy-full');
      expect(full).toHaveLength(59);
      expect(
        full.filter((each) => each.status === 'missing').map((each) => each.markerKey),
      ).toEqual(['urine-leukocytes']);
    });

    it('reads the urine panel as categorical rather than discarding it', () => {
      const rows = readFixture('ahfy-full');
      const urine = rows.filter((each) => each.markerKey.startsWith('urine-'));

      expect(urine.filter((each) => each.status === 'categorical')).toHaveLength(9);
      expect(urine.find((each) => each.markerKey === 'urine-glucose')).toMatchObject({
        status: 'categorical',
        textValue: 'Αρνητικό',
        categoricalReference: 'Αρνητικό',
      });
    });

    it('keeps a reference range on a row whose result is missing', () => {
      const leukocytes = readFixture('ahfy-full').find(
        (each) => each.markerKey === 'urine-leukocytes',
      );

      // `(Σπανιότατα) 0-1 κ.ο.π.` prints an interval and a unit nothing knows,
      // so the row is missing and the interval is flagged, not invented.
      expect(leukocytes).toMatchObject({
        status: 'missing',
        value: null,
        referenceRange: null,
        flags: ['unparsed-range'],
      });
    });

    it('reads a result printed below the assay floor as a comparator value', () => {
      const crp = readFixture('ahfy-full').find((each) => each.markerKey === 'crp');

      expect(crp).toMatchObject({
        status: 'value',
        value: 1.03,
        comparator: '<',
        unit: 'mg/L',
        referenceRange: { kind: 'maxOnly', comparator: '<', max: 5 },
        confidence: 'medium',
      });
    });
  });
  /**
   * Two of ahfy-full's 35 expectations are not met, and neither is a defect in
   * the read-out rules. They are recorded here rather than hidden, the way
   * `anchors.test.ts` records Pass A's four.
   */
  describe('the measured gaps', () => {
    it('reads Ουροχολινογόνο as a result the derivation lost', () => {
      // The expectation says `missing`. Its derivation is a poppler column
      // reconstruction, which splits this wrapped row into two printed lines
      // and strands the result from its label; the row itself does print
      // `Αρνητικό`. The reference is assembled in the row's x order rather
      // than the printed line order — the laboratory printed `Αρνητικό ή`
      // above `ίχνη` — which is `rows.ts`'s documented ordering and needs the
      // column roles Pass V bound to undo.
      const row = readFixture('ahfy-full').find((each) => each.markerKey === 'urine-urobilinogen');

      expect(row).toMatchObject({
        status: 'categorical',
        textValue: 'Αρνητικό',
        categoricalReference: 'Αρνητικό ίχνη ή',
      });
    });

    it('emits no row for a label Pass A could not anchor', () => {
      // `Ερυθρά αιμοσφαίρια (Ερυθρά αιμοσφ.)` wraps, so its alias stops being
      // a contiguous token run and no anchor is raised — one of the four gaps
      // `anchors.test.ts` already measures. Nothing downstream can invent the
      // row, and the read-out does not try.
      expect(
        readFixture('ahfy-full').filter((each) => each.markerKey === 'urine-erythrocytes'),
      ).toEqual([]);
    });
  });
});
