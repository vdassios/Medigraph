import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAhfyDocument } from './ahfyDocument';
import type { TextItem } from './types';

const SEED = new URL('../../fixtures/seed/', import.meta.url);

function fixture(name: string, shape: 'fragmented' | 'wholeLine' = 'fragmented'): TextItem[][] {
  const parsed = JSON.parse(
    readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8'),
  ) as Record<string, { pages: TextItem[][] }>;
  return parsed[shape]?.pages ?? [];
}

let nextId = 0;

function item(text: string, x: number, y: number): TextItem {
  nextId += 1;
  return { id: `i${String(nextId)}`, text, x, y, w: 0.05, h: 0.014 };
}

/** The x positions the ΑΗΦΥ template prints its five headings at. */
const HEADING_X = { label: 0.131, value: 0.384, unit: 0.51, range: 0.636, notes: 0.763 };

const METADATA: [string, string][] = [
  ['Αρ. Υπόθεσης', '900000001'],
  ['ΑΜΚΑ', '01018099901'],
  ['Επώνυμο', 'ΠΑΠΑΔΟΠΟΥΛΟΣ'],
  ['Όνομα', 'ΓΕΩΡΓΙΟΣ'],
  ['Αριθμός Παραγγελίας', '800000001'],
  ['Ημερομηνία Λήψης Δείγματος', '14-05-2025'],
  ['Ημερομηνία Αποτελέσματος', '15-05-2025'],
  ['Επώνυμο Ιατρού', 'ΙΩΑΝΝΟΥ'],
  ['Όνομα Ιατρού', 'ΕΛΕΝΗ'],
  ['ΑΜΚΑ Ιατρού', '02029088802'],
  ['Ειδικότητα Ιατρού', 'ΒΙΟΠΑΘΟΛΟΓΟΣ'],
  ['Επωνυμία Εργαστηρίου', 'ΒΙΟΙΑΤΡΙΚΗ'],
];

function metadataPage(fields: [string, string][] = METADATA): TextItem[] {
  const page = [item('Αποτελέσματα Εργαστηριακών Εξετάσεων', 0.283, 0.117)];

  for (const [index, [label, value]] of fields.entries()) {
    const y = 0.2 + index * 0.021;
    page.push(item(`${label}:`, HEADING_X.label, y), item(value, 0.371, y));
  }

  return page;
}

/** A header row, then one row per `cells` entry keyed by column. */
function tablePage(
  rows: Partial<Record<keyof typeof HEADING_X, string>>[],
  headings = ['Περιγραφή', 'Αποτέλεσμα', 'Μονάδα Μέτρησης', 'Φυσιολογικές Τιμές', 'Παρατηρήσεις'],
): TextItem[] {
  const page = headings.map((heading, index) =>
    item(heading, Object.values(HEADING_X)[index] ?? 0, 0.1),
  );

  for (const [index, cells] of rows.entries()) {
    const y = 0.15 + index * 0.021;
    for (const [role, text] of Object.entries(cells)) {
      page.push(item(text, HEADING_X[role as keyof typeof HEADING_X], y));
    }
  }

  return page;
}

function accept(pages: TextItem[][]) {
  const validation = validateAhfyDocument(pages);
  if (!validation.ok) {
    throw new Error(`expected an ΑΗΦΥ document, got ${validation.reason}`);
  }
  return validation.document;
}

describe('validateAhfyDocument', () => {
  describe('V1 — accept', () => {
    it('accepts a document carrying the title, the twelve labels and a table', () => {
      expect(validateAhfyDocument([metadataPage(), tablePage([])]).ok).toBe(true);
    });

    it('rejects a source with no repository title', () => {
      const pages = [metadataPage().slice(1), tablePage([])];

      expect(validateAhfyDocument(pages)).toEqual({ ok: false, reason: 'missing-title' });
    });

    it.each(METADATA.map(([label]) => label))('rejects a document missing %s', (missing) => {
      const pages = [metadataPage(METADATA.filter(([label]) => label !== missing)), tablePage([])];

      expect(validateAhfyDocument(pages)).toEqual({ ok: false, reason: 'missing-metadata' });
    });

    it('rejects a table whose header wording differs', () => {
      const pages = [
        metadataPage(),
        tablePage([], ['Εξέταση', 'Αποτέλεσμα', 'Μονάδα Μέτρησης', 'Τιμές Αναφοράς', 'Σχόλια']),
      ];

      expect(validateAhfyDocument(pages)).toEqual({ ok: false, reason: 'missing-table' });
    });

    it('rejects a document with no table at all', () => {
      expect(validateAhfyDocument([metadataPage()])).toEqual({
        ok: false,
        reason: 'missing-table',
      });
    });

    it('rejects a collection date the calendar does not have', () => {
      const pages = [
        metadataPage(
          METADATA.map(([label, value]) =>
            label === 'Ημερομηνία Λήψης Δείγματος' ? [label, '31-02-2025'] : [label, value],
          ),
        ),
        tablePage([]),
      ];

      expect(validateAhfyDocument(pages)).toEqual({ ok: false, reason: 'missing-date' });
    });

    it('yields no columns and no document when it rejects', () => {
      // Fail closed: no rows, no partial result, no fallback parse.
      const validation = validateAhfyDocument([metadataPage()]);

      expect(validation).not.toHaveProperty('document');
    });

    it('accepts mixed-script text, which is normal in these documents', () => {
      // Greek capital mu inside a Latin abbreviation, three scripts in one
      // unit, a Latin O closing a Greek laboratory name, accented capitals.
      const pages = [
        metadataPage(
          METADATA.map(([label, value]) =>
            label === 'Επωνυμία Εργαστηρίου' ? [label, 'ΑΙΜΑΤΟΛΟΓΙΚO'] : [label, value],
          ),
        ),
        tablePage([
          {
            label: 'Μέσος Όγκος Ερυθρών (ΜCV)',
            value: '90.4',
            unit: 'Μ/μl',
            range: '77 - 100',
          },
        ]),
      ];

      expect(accept(pages).issuingLaboratory).toBe('ΑΙΜΑΤΟΛΟΓΙΚO');
    });

    it('needs neither Producer metadata nor the Κωδικός header', () => {
      // A re-saved PDF loses its metadata while remaining a valid document.
      const pages = [metadataPage(), tablePage([])];

      expect(validateAhfyDocument(pages).ok).toBe(true);
    });
  });

  describe('V2 — supply', () => {
    it('binds the five column roles by header position', () => {
      const document = accept([metadataPage(), tablePage([])]);

      expect(document.columns).toEqual({
        label: { role: 'label', xMin: 0.131, xMax: 0.384 },
        value: { role: 'value', xMin: 0.384, xMax: 0.51 },
        unit: { role: 'unit', xMin: 0.51, xMax: 0.636 },
        range: { role: 'range', xMin: 0.636, xMax: 0.763 },
        notes: { role: 'notes', xMin: 0.763, xMax: 1 },
      });
    });

    it('binds a heading the laboratory prints as two stacked items', () => {
      const pages = [metadataPage(), fixture('ahfy-full')[1] ?? []];

      expect(accept(pages).columns.unit.xMin).toBeCloseTo(0.51, 2);
    });

    it('reads the collection date, never the result date', () => {
      const document = accept([metadataPage(), tablePage([])]);

      expect(document.collectionDate).toBe('2025-05-14');
      expect(document.resultDate).toBe('2025-05-15');
    });

    it('leaves an unreadable result date null without rejecting', () => {
      const pages = [
        metadataPage(
          METADATA.map(([label, value]) =>
            label === 'Ημερομηνία Αποτελέσματος' ? [label, '—'] : [label, value],
          ),
        ),
        tablePage([]),
      ];

      expect(accept(pages).resultDate).toBeNull();
    });

    it('keeps the issuing laboratory, which is not an identifier', () => {
      expect(accept([metadataPage(), tablePage([])]).issuingLaboratory).toBe('ΒΙΟΙΑΤΡΙΚΗ');
    });

    it('marks the six identifier positions, and only those', () => {
      const zones = accept([metadataPage(), tablePage([])]).identifierZones;

      // ΑΜΚΑ, Επώνυμο, Όνομα and the doctor's three. The case number, the
      // order number and the laboratory name are not among them.
      expect(zones).toHaveLength(6);
      expect(zones.every((zone) => zone.resolution === 'redacted')).toBe(true);
      expect(zones.map((zone) => zone.rect.x)).toEqual([0.371, 0.371, 0.371, 0.371, 0.371, 0.371]);
    });

    it('boxes the value of an identifier, not its label', () => {
      const [amka] = accept([metadataPage(), tablePage([])]).identifierZones;

      expect(amka?.rect.x).toBe(0.371);
      expect(amka?.rect.y).toBeCloseTo(0.221, 3);
    });
  });

  describe('V4 — rows the table contains but a measurement is not', () => {
    it('classifies a row with no value, unit or range as a section marker', () => {
      const document = accept([
        metadataPage(),
        tablePage([
          { label: 'ΕΡΥΘΡΟΚΥΤΤΑΡΙΚΗ ΣΕΙΡΑ (LABEL RBC)' },
          { label: 'Ερυθρά Αιμοσφαίρια (RBC)', value: '5.29', unit: 'x10^6', range: '4.4 - 6.3' },
        ]),
      ]);

      expect(document.sectionTitles).toEqual([
        { page: 2, y: 0.15, title: 'ΕΡΥΘΡΟΚΥΤΤΑΡΙΚΗ ΣΕΙΡΑ (LABEL RBC)' },
      ]);
    });

    it('is not fooled by a row carrying only a note', () => {
      const document = accept([
        metadataPage(),
        tablePage([{ label: 'Γλυκόζη', value: '89', notes: 'αιμόλυση' }]),
      ]);

      expect(document.sectionTitles).toEqual([]);
    });

    it('records the panel heading that opens a table', () => {
      // V2's "panel headings between tables". A heading may be long enough to
      // overflow into the value column — `Χοληστερόλη υψηλής πυκνότητας
      // λιποπρωτεϊνών (ΗDL-C)` does — so its position above a header is what
      // identifies it, not its cells.
      const titles = accept(fixture('ahfy-full')).sectionTitles;

      expect(titles.some((section) => section.title.startsWith('Γλυκόζη (GLU)'))).toBe(true);
      expect(titles.some((section) => section.title.includes('(ΗDL-C)'))).toBe(true);
    });

    it('takes one title per row, leaving a wrapped title as two', () => {
      // What counts as a row is rows.ts's question, already answered. Pass V
      // classifies rows; it does not re-cluster them under a looser rule.
      const titles = accept([metadataPage(), fixture('ahfy-full')[1] ?? []]).sectionTitles;

      expect(titles.slice(0, 4).map((section) => section.title)).toEqual([
        'ΕΡΥΘΡΟΚΥΤΤΑΡΙΚΗ ΣΕΙΡΑ',
        '(LABEL RBC)',
        'ΛΕΥΚΟΚΥΤΤΑΡΙΚΗ ΣΕΙΡΑ (LABEL',
        'WBC)',
      ]);
    });

    it('never mistakes the table header or the page code for a section', () => {
      const titles = accept([metadataPage(), fixture('ahfy-full')[1] ?? []]).sectionTitles;

      expect(titles.some((section) => section.title.includes('Περιγραφή'))).toBe(false);
      expect(titles.some((section) => section.title.startsWith('Κωδικός'))).toBe(false);
    });

    it('never mistakes a spaced banner heading for a section', () => {
      // Its letters are spaced across the page and fill the value column.
      const titles = accept([metadataPage(), ...fixture('ahfy-full').slice(1)]).sectionTitles;

      expect(titles.some((section) => section.title.startsWith('Γ Ε Ν Ι Κ Η'))).toBe(false);
    });
  });

  describe('the seed fixtures', () => {
    it.each([
      ['ahfy-full', '2025-05-14', '2025-05-15', 'ΒΙΟΙΑΤΡΙΚΗ - ΑΘΗΝΑ - ΠΛΑΤΕΙΑ ΑΜΕΡΙΚΗΣ'],
      ['ahfy-minimal', '2024-07-08', '2024-07-08', 'ΑΙΜΑΤΟΛΟΓΙΚO'],
    ])('validates %s', (name, collectionDate, resultDate, laboratory) => {
      const document = accept(fixture(name));

      expect(document.collectionDate).toBe(collectionDate);
      expect(document.resultDate).toBe(resultDate);
      expect(document.issuingLaboratory).toBe(laboratory);
      expect(document.identifierZones).toHaveLength(6);
    });

    it('rejects a loose laboratory PDF', () => {
      expect(validateAhfyDocument(fixture('not-ahfy'))).toEqual({
        ok: false,
        reason: 'missing-title',
      });
    });

    it('rejects pages collapsed into whole-line items', () => {
      // Column roles are bound from the header's x positions, so a page with
      // one item per printed line carries nothing to bind from. Failing closed
      // is correct — but it is a real shape requirement on the caller.
      expect(validateAhfyDocument(fixture('ahfy-full', 'wholeLine'))).toEqual({
        ok: false,
        reason: 'missing-table',
      });
    });

    it('finds every heading and structural row ahfy-full prints', () => {
      const titles = accept(fixture('ahfy-full')).sectionTitles;

      expect(titles).toHaveLength(80);
      expect(titles.every((section) => section.page >= 2)).toBe(true);
    });

    it('finds none in a document that prints none', () => {
      expect(accept(fixture('ahfy-minimal')).sectionTitles).toEqual([]);
    });
  });
});
