import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findIdentifierCandidates } from './identifiers';
import type { IdentifierCandidate, TextItem } from './types';

const SEED = new URL('../../fixtures/seed/', import.meta.url);

interface Fixture {
  fragmented: { pages: TextItem[][] };
  wholeLine: { pages: TextItem[][] };
}

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8')) as Fixture;
}

/**
 * One printed line, as a row of items laid out left to right.
 *
 * Passing several texts models the fragmented items pdf.js emits; passing one
 * models a whole-line reconstruction. Every rule below is asserted against
 * both shapes, because both reach this module.
 */
function line(y: number, ...texts: string[]): TextItem[] {
  let x = 0.1;
  return texts.map((text, index) => {
    const item = {
      id: `i${String(y)}-${String(index)}`,
      text,
      x,
      y,
      w: text.length * 0.01,
      h: 0.014,
    };
    x += item.w + 0.01;
    return item;
  });
}

function kindsAndTexts(candidates: IdentifierCandidate[]): [string, string][] {
  return candidates.map((candidate) => [candidate.kind, candidate.text]);
}

/** The nine labelled fields, as `[label, value, kind]`. */
const LABELLED: [string, string, string][] = [
  ['ΑΜΚΑ', '01018099901', 'national-id'],
  ['ΑΜΚΑ Ιατρού', '02029088802', 'national-id'],
  ['Επώνυμο', 'ΠΑΠΑΔΟΠΟΥΛΟΣ', 'name'],
  ['Όνομα', 'ΓΕΩΡΓΙΟΣ', 'name'],
  ['Επώνυμο Ιατρού', 'ΙΩΑΝΝΟΥ', 'name'],
  ['Όνομα Ιατρού', 'ΕΛΕΝΗ', 'name'],
  ['Αρ. Υπόθεσης', '900000001', 'patient-id'],
  ['Αριθμός Παραγγελίας', '800000001', 'patient-id'],
  ['Κωδικός', 'AAAAbbbbCCCCddddEEEEff', 'patient-id'],
];

/**
 * Labelled fields that carry no identity, and must not lengthen the gate.
 *
 * The two dates are data the user confirms; the specialty names nobody; and
 * the plan keeps the issuing laboratory as the Report's lab label, stating
 * outright that it is not an identifier.
 */
const NOT_IDENTIFIERS: [string, string][] = [
  ['Ημερομηνία Λήψης Δείγματος', '14-05-2025'],
  ['Ημερομηνία Αποτελέσματος', '15-05-2025'],
  ['Ειδικότητα Ιατρού', 'ΒΙΟΠΑΘΟΛΟΓΟΣ'],
  ['Επωνυμία Εργαστηρίου', 'ΒΙΟΙΑΤΡΙΚΗ - ΑΘΗΝΑ'],
];

describe('findIdentifierCandidates', () => {
  describe('labelled ΑΗΦΥ metadata', () => {
    it.each(LABELLED)('reads %s from a fragmented label and value', (label, value, kind) => {
      const found = findIdentifierCandidates('s', [line(0.2, `${label}:`, value)]);

      expect(kindsAndTexts(found)).toEqual([[kind, value]]);
    });

    it.each(LABELLED)('reads %s from one whole-line item', (label, value, kind) => {
      const found = findIdentifierCandidates('s', [line(0.2, `${label}:  ${value}`)]);

      expect(kindsAndTexts(found)).toEqual([[kind, value]]);
    });

    it('reads a label the document splits across items', () => {
      // pdf.js emits `Αρ.` and `Υπόθεσης:` separately, and `Αριθμός`
      // separately from `Παραγγελίας:`.
      const found = findIdentifierCandidates('s', [
        line(0.2, 'Αρ.', 'Υπόθεσης:', '900000001'),
        line(0.3, 'Αριθμός', 'Παραγγελίας:', '800000001'),
      ]);

      expect(kindsAndTexts(found)).toEqual([
        ['patient-id', '900000001'],
        ['patient-id', '800000001'],
      ]);
    });

    it.each(NOT_IDENTIFIERS)('raises nothing for %s', (label, value) => {
      expect(findIdentifierCandidates('s', [line(0.2, `${label}:`, value)])).toEqual([]);
    });

    it('never reads ΑΜΚΑ Ιατρού as ΑΜΚΑ', () => {
      // The label is matched whole, against everything before the first colon.
      const found = findIdentifierCandidates('s', [line(0.2, 'ΑΜΚΑ Ιατρού:', 'ΧΩΡΙΣ ΑΡΙΘΜΟ')]);

      expect(kindsAndTexts(found)).toEqual([['national-id', 'ΧΩΡΙΣ ΑΡΙΘΜΟ']]);
    });

    it.each([['ΕΠΏΝΥΜΟ'], ['επωνυμο'], ['Επώνυμο ']])(
      'matches the label %j through normaliseLabel',
      (label) => {
        const found = findIdentifierCandidates('s', [line(0.2, `${label}:`, 'ΠΑΠΑΔΟΠΟΥΛΟΣ')]);

        expect(kindsAndTexts(found)).toEqual([['name', 'ΠΑΠΑΔΟΠΟΥΛΟΣ']]);
      },
    );

    it('raises nothing for a label with no value', () => {
      expect(findIdentifierCandidates('s', [line(0.2, 'Επώνυμο:', '   ')])).toEqual([]);
    });

    it('raises nothing for a colon that introduces no known label', () => {
      // The reference-range column prints these; none names a person.
      const found = findIdentifierCandidates('s', [
        line(0.2, 'Φυσιολογική Τιμή:', '<150'),
        line(0.3, 'Έλλειψη:', '< 187'),
        line(0.4, 'ΜΕΘΟΔΟΣ ΠΡΟΣΔΙΟΡΙΣΜΟΥ:', 'ΚΥΤΤΑΡΟΜΕΤΡΙΑ ΡΟΗΣ'),
      ]);

      expect(found).toEqual([]);
    });
  });

  describe('free-text patterns', () => {
    it.each([
      ['01018099901', 'national-id'],
      ['patient@example.gr', 'email'],
      ['2101234567', 'phone'],
      ['6941234567', 'phone'],
      ['+30 210 1234567', 'phone'],
      ['210-123-4567', 'phone'],
    ])('finds %j unlabelled, as %s', (text, kind) => {
      const found = findIdentifierCandidates('s', [line(0.2, 'Παρατηρήσεις', text)]);

      expect(kindsAndTexts(found)).toEqual([[kind, text]]);
    });

    it('finds a number the document split across two items', () => {
      const found = findIdentifierCandidates('s', [line(0.2, 'Τηλ.', '210', '0000000')]);

      expect(kindsAndTexts(found)).toEqual([['phone', '210 0000000']]);
    });

    it('never joins two fragments into a longer number', () => {
      // Items are joined with a space, so adjacent digit runs stay separate:
      // reading `0101` beside `8099901` as an AMKA would invent one.
      expect(findIdentifierCandidates('s', [line(0.2, '0101', '8099901')])).toEqual([]);
    });

    it('scans every page, not only the metadata page', () => {
      const found = findIdentifierCandidates('s', [
        line(0.2, 'Περιγραφή'),
        line(0.2, 'Σχόλιο', 'lab@example.gr'),
      ]);

      expect(kindsAndTexts(found)).toEqual([['email', 'lab@example.gr']]);
      expect(found[0]?.sourceRef?.page).toBe(2);
    });

    it('layers over the labels: an unknown label with a known shape still fires', () => {
      const found = findIdentifierCandidates('s', [line(0.2, 'ΑΜΚΑ Συζύγου:', '04049066604')]);

      expect(kindsAndTexts(found)).toEqual([['national-id', '04049066604']]);
    });
  });

  describe('what it must not consume', () => {
    it.each([
      ['1031', 'a urine specific gravity'],
      ['4,0-11,0', 'a reference range'],
      ['0-1 κ.ο.π.', 'a sediment count'],
      ['14-05-2025', 'a printed date'],
      ['x10^3 / μL', 'a unit'],
      ['< 100', 'a one-sided range'],
      ['5.29', 'a measured value'],
      ['12227001779820260115115801', 'a twenty-six-digit repository code'],
      ['900000001', 'a nine-digit order number'],
    ])('leaves %j alone — %s', (text) => {
      expect(findIdentifierCandidates('s', [line(0.2, 'Τιμή', text)])).toEqual([]);
    });

    it('reads no identifier from thirteen pages of laboratory results', () => {
      // The whole of ahfy-full past its metadata page: every marker, value,
      // unit, range and narrative note the document prints.
      const [, ...resultPages] = fixture('ahfy-full').fragmented.pages;
      const found = findIdentifierCandidates('ahfy-full', resultPages);

      expect(found.filter((candidate) => candidate.kind !== 'patient-id')).toEqual([]);
    });
  });

  describe('one candidate per distinct identifier', () => {
    it('collapses a repeat, keeping the first occurrence as evidence', () => {
      // The repository code heads all thirteen pages. Redact removes the
      // substring from every derived field, so a second prompt resolves
      // nothing and only lengthens the gate.
      const found = findIdentifierCandidates('s', [
        line(0.2, 'Κωδικός:', 'ABC123'),
        line(0.2, 'Κωδικός:', 'ABC123'),
        line(0.2, 'Κωδικός:', 'ABC123'),
      ]);

      expect(found).toHaveLength(1);
      expect(found[0]?.sourceRef?.page).toBe(1);
    });

    it('collapses a labelled value its own pattern also matches', () => {
      const found = findIdentifierCandidates('s', [line(0.2, 'ΑΜΚΑ:', '01018099901')]);

      expect(found).toHaveLength(1);
      expect(found[0]?.kind).toBe('national-id');
    });

    it('numbers candidates in reading order, under the source id', () => {
      const found = findIdentifierCandidates('doc-7', [
        line(0.2, 'Επώνυμο:', 'ΠΑΠΑΔΟΠΟΥΛΟΣ'),
        line(0.3, 'Όνομα:', 'ΓΕΩΡΓΙΟΣ'),
      ]);

      expect(found.map((candidate) => candidate.id)).toEqual([
        'doc-7:identifier:1',
        'doc-7:identifier:2',
      ]);
    });
  });

  describe('source references', () => {
    it('addresses a span inside the one item that holds it', () => {
      const items = line(0.2, 'ΑΜΚΑ:  01018099901');
      const found = findIdentifierCandidates('s', [items]);

      expect(found[0]?.sourceRef).toEqual({
        sourceId: 's',
        page: 1,
        box: { x: 0.1, y: 0.2, w: items[0]?.w, h: 0.014 },
        itemIds: [items[0]?.id],
        textRange: { itemId: items[0]?.id, start: 7, end: 18 },
      });
    });

    it('names every item a span crosses, and no textRange across the join', () => {
      // A range spanning the separator would index text no item contains.
      const items = line(0.2, 'Τηλ.', '210', '0000000');
      const found = findIdentifierCandidates('s', [items]);

      expect(found[0]?.sourceRef?.itemIds).toEqual([items[1]?.id, items[2]?.id]);
      expect(found[0]?.sourceRef?.textRange).toBeUndefined();
    });

    it('boxes the union of the items a span crosses', () => {
      const items = line(0.2, 'Τηλ.', '210', '0000000');
      const second = items[1] ?? items[0];
      const third = items[2] ?? items[0];
      const box = findIdentifierCandidates('s', [items])[0]?.sourceRef?.box;

      // Geometry, so compared as geometry: the union spans the two digit
      // items and excludes the `Τηλ.` label the match does not touch.
      expect(box?.x).toBeCloseTo(second?.x ?? 0, 12);
      expect(box?.y).toBeCloseTo(0.2, 12);
      expect(box?.w).toBeCloseTo((third?.x ?? 0) + (third?.w ?? 0) - (second?.x ?? 0), 12);
      expect(box?.h).toBeCloseTo(0.014, 12);
    });
  });

  describe('the seed fixtures', () => {
    const expected: [string, string][][] = [
      [
        ['patient-id', 'AAAAbbbbCCCCddddEEEEff'],
        ['patient-id', '900000001'],
        ['national-id', '01018099901'],
        ['name', 'ΠΑΠΑΔΟΠΟΥΛΟΣ'],
        ['name', 'ΓΕΩΡΓΙΟΣ'],
        ['patient-id', '800000001'],
        ['name', 'ΙΩΑΝΝΟΥ'],
        ['name', 'ΕΛΕΝΗ'],
        ['national-id', '02029088802'],
      ],
      [
        ['patient-id', 'GGGGhhhhIIIIjjjjKKKKl-m'],
        ['patient-id', '900000002'],
        ['national-id', '01018099901'],
        ['name', 'ΠΑΠΑΔΟΠΟΥΛΟΣ'],
        ['name', 'ΓΕΩΡΓΙΟΣ'],
        ['patient-id', '800002'],
        ['name', 'ΝΙΚΟΛΆΟΥ'],
        ['name', 'ΔΗΜΉΤΡΙΟΣ'],
        ['national-id', '03039077703'],
      ],
    ];

    it.each([
      ['ahfy-full', 0],
      ['ahfy-minimal', 1],
    ])('reads the same nine identifiers from either shape of %s', (name, index) => {
      const { fragmented, wholeLine } = fixture(name);

      expect(kindsAndTexts(findIdentifierCandidates(name, fragmented.pages))).toEqual(
        expected[index],
      );
      expect(kindsAndTexts(findIdentifierCandidates(name, wholeLine.pages))).toEqual(
        expected[index],
      );
    });

    it('reads a loose laboratory PDF only where its shapes are unmistakable', () => {
      // not-ahfy prints `Ονοματεπώνυμο: ΠΑΠΑΔΟΠΟΥΛΟΣ ΓΕΩΡΓΙΟΣ`, and that label
      // is not one this document class fixes, so only the telephone number is
      // found. The gap costs nothing: a non-ΑΗΦΥ source is rejected by Pass V
      // at attach and never reaches a review session at all.
      const found = findIdentifierCandidates('not-ahfy', fixture('not-ahfy').wholeLine.pages);

      expect(kindsAndTexts(found)).toEqual([['phone', '210 0000000']]);
    });
  });

  it('reads nothing from nothing', () => {
    expect(findIdentifierCandidates('s', [])).toEqual([]);
    expect(findIdentifierCandidates('s', [[]])).toEqual([]);
  });
});
