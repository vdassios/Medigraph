import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards on the Task 0.3 seed fixtures.
 *
 * These are derived from the real ΑΗΦΥ documents under `corpus/greek-labs/gov/`
 * — real geometry, synthetic identity and values. The corpus is gitignored and
 * never leaves the machine; only the derived JSON here is committed.
 */

const SEED = new URL('../../fixtures/seed/', import.meta.url);

interface Item {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Fixture {
  sourceId: string;
  pageCount: number;
  fragmented: { pages: Item[][] };
  wholeLine: { pages: Item[][] };
}

function read(name: string): string {
  return readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8');
}

function load(name: string): Fixture {
  return JSON.parse(read(name)) as Fixture;
}

function items(fixture: Fixture): Item[] {
  return [...fixture.fragmented.pages.flat(), ...fixture.wholeLine.pages.flat()];
}

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function allText(fixture: Fixture): string {
  return items(fixture)
    .map((item) => item.text)
    .join('\n');
}

const FIXTURES: [string, number][] = [
  ['ahfy-full', 13],
  ['ahfy-minimal', 2],
];

describe.each(FIXTURES)('%s', (name, expectedPages) => {
  const fixture = load(name);

  it('has the recorded page count in both variants', () => {
    expect(fixture.pageCount).toBe(expectedPages);
    expect(fixture.fragmented.pages).toHaveLength(expectedPages);
    expect(fixture.wholeLine.pages).toHaveLength(expectedPages);
  });

  it('carries page-normalised geometry inside the unit square', () => {
    // The bounds observation validation enforces: nothing may sit outside the
    // page or run off its right or bottom edge.
    for (const item of items(fixture)) {
      expect(item.x, item.id).toBeGreaterThanOrEqual(0);
      expect(item.y, item.id).toBeGreaterThanOrEqual(0);
      expect(item.w, item.id).toBeGreaterThan(0);
      expect(item.h, item.id).toBeGreaterThan(0);
      expect(item.x + item.w, item.id).toBeLessThanOrEqual(1.0001);
      expect(item.y + item.h, item.id).toBeLessThanOrEqual(1.0001);
    }
  });

  it('gives every observation a unique id and clean text', () => {
    const all = items(fixture);
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
    for (const item of all) {
      expect(item.text.trim(), item.id).not.toBe('');
      // A control character would mean the extraction mangled a text run.
      expect(hasControlCharacter(item.text), item.id).toBe(false);
    }
  });

  it('preserves the structural chrome Pass V validates', () => {
    const text = allText(fixture);
    expect(text).toContain('Αποτελέσματα Εργαστηριακών Εξετάσεων');
    expect(text).toContain('Κωδικός:');

    const metadataLabels = [
      'Αρ. Υπόθεσης:',
      'ΑΜΚΑ:',
      'Επώνυμο:',
      'Όνομα:',
      'Αριθμός Παραγγελίας:',
      'Ημερομηνία Λήψης Δείγματος:',
      'Ημερομηνία Αποτελέσματος:',
      'Επώνυμο Ιατρού:',
      'Όνομα Ιατρού:',
      'ΑΜΚΑ Ιατρού:',
      'Ειδικότητα Ιατρού:',
      'Επωνυμία Εργαστηρίου:',
    ];
    for (const label of metadataLabels) {
      expect(text, label).toContain(label);
    }

    for (const header of ['Περιγραφή', 'Αποτέλεσμα', 'Μονάδα', 'Φυσιολογικές', 'Παρατηρήσεις']) {
      expect(text, header).toContain(header);
    }
  });

  it('carries synthetic identity of the right shape', () => {
    const text = allText(fixture);
    expect(text).toContain('ΠΑΠΑΔΟΠΟΥΛΟΣ');
    expect(text).toContain('ΓΕΩΡΓΙΟΣ');
    // An ΑΜΚΑ is eleven digits and may lead with a zero. A substitution that
    // silently renumbered one would break Task 1.7's identifier detection.
    expect(text).toMatch(/(?:^|\D)0\d{10}(?:\D|$)/u);
  });

  it('states each whole-line row as a single observation', () => {
    // Pass A's whole-line lexical mode needs label, value, unit and range in
    // one item, so the read-out tokenises inside it and reports textRange
    // offsets rather than leaning on per-cell geometry.
    const rows = fixture.wholeLine.pages.flat().map((item) => item.text);
    const combined = rows.filter((row) => row.includes('(WBC)') && /\d/u.test(row));
    expect(combined.length).toBeGreaterThan(0);
    expect(combined.some((row) => row.split(/\s{2,}/u).length >= 3)).toBe(true);
  });
});

describe('ahfy-full covers the printed variation later tasks depend on', () => {
  const rows = load('ahfy-full')
    .wholeLine.pages.flat()
    .map((item) => item.text);

  it.each([
    [/\(LABEL[^)]*\)/u, 'a section-marker row'],
    [/x10\^3\s?\/\s?μL/u, 'the x10^3 unit spelling'],
    [/[<>]\s?\d/u, 'a printed comparator'],
    [/Αρνητικό/u, 'a categorical result'],
    [/mg\/dL/u, 'the most common Greek unit'],
    [/ΜCV/u, 'a label opening with Greek capital mu'],
  ])('contains %s — %s', (pattern) => {
    expect(rows.some((row) => pattern.test(row))).toBe(true);
  });
});

describe('ahfy-minimal covers the second laboratory', () => {
  const text = allText(load('ahfy-minimal'));

  it.each([
    ['ΑΙΜΑΤΟΛΟΓΙΚO', 'a laboratory name ending in a Latin O'],
    ['k/μl', 'the lowercase count prefix'],
    ['Μ/μl', 'the Greek capital mu count prefix'],
    ['WBC (WBC)', 'a bare abbreviation label with no Greek name'],
  ])('contains %j — %s', (needle) => {
    expect(text).toContain(needle);
  });
});

describe('the committed PDFs', () => {
  const PDFS: [string, number][] = [
    ['ahfy-full', 13],
    ['ahfy-minimal', 2],
    ['not-ahfy', 1],
  ];

  it.each(PDFS)('%s.pdf is a real PDF of %i page(s)', (name, pages) => {
    const bytes = readFileSync(new URL(`${name}.pdf`, SEED));
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.subarray(-6).toString('latin1')).toContain('EOF');
    // Chromium writes one /Type /Page object per page.
    const pageObjects = bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/gu) ?? [];
    expect(pageObjects.length).toBe(pages);
  });

  it.each(PDFS)('%s.pdf embeds only the OFL font', (name) => {
    // A subsetted proprietary system font would be both a licensing problem and
    // a reason the fixture differs from machine to machine.
    const text = readFileSync(new URL(`${name}.pdf`, SEED)).toString('latin1');
    expect(text).toContain('Roboto');
    for (const proprietary of ['HelveticaNeue', 'TimesNewRoman', 'ArialMT', 'SFPro']) {
      expect(text, proprietary).not.toContain(proprietary);
    }
  });
});

describe('not-ahfy is rejectable', () => {
  const fixture = load('not-ahfy');
  const text = allText(fixture);

  it('carries none of the markers Pass V requires', () => {
    expect(text).not.toContain('Αποτελέσματα Εργαστηριακών Εξετάσεων');
    for (const label of ['ΑΜΚΑ:', 'Αρ. Υπόθεσης:', 'Ημερομηνία Λήψης Δείγματος:']) {
      expect(text, label).not.toContain(label);
    }
    // Its table is three columns with its own headings, not the ΑΗΦΥ five.
    expect(text).not.toContain('Περιγραφή');
    expect(text).not.toContain('Μονάδα');
    expect(text).toContain('ΕΞΕΤΑΣΗ');
    expect(text).toContain('ΤΙΜΕΣ ΑΝΑΦΟΡΑΣ');
  });

  it('is still a plausible laboratory report', () => {
    // A negative fixture that looked nothing like a report would prove little:
    // Pass V has to reject a document a user could reasonably have attached.
    expect(text).toContain('Γλυκόζη');
    expect(text).toContain('mg/dL');
    expect(fixture.pageCount).toBe(1);
  });
});

describe('no real identity survives', () => {
  // The denylist holds the real substrings and is gitignored, so this runs on a
  // maintainer's machine and skips elsewhere, rather than committing the very
  // data it checks for.
  const denylist = new URL('.identity-denylist.txt', SEED);

  it.runIf(existsSync(denylist))('contains no substring from the local denylist', () => {
    const needles = readFileSync(denylist, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(needles.length).toBeGreaterThan(0);

    // JSON only, and that is sufficient rather than a shortcut: both ΑΗΦΥ PDFs
    // are generated from these very files, so their text is this text. Scanning
    // the PDF bytes directly would prove nothing anyway — the content sits in
    // Flate-compressed streams under Identity-H, so the glyphs are font indices
    // and only a ToUnicode mapping turns them back into Greek. That check runs
    // with pdftotext at generation time, not here.
    const haystack = FIXTURES.map(([name]) => read(name)).join('\n');
    expect(needles.filter((needle) => haystack.includes(needle))).toEqual([]);
  });
});

interface ExpectedRow {
  page: number;
  label: string;
  status: 'value' | 'categorical' | 'missing';
  value: number | null;
  comparator: string | null;
  textValue: string | null;
  unit: string | null;
  referenceRange: { kind: string; min?: number; max?: number; comparator?: string } | null;
  categoricalReference: string | null;
  sourceRef: { sourceId: string; page: number };
}

interface Expected {
  sourceId: string;
  derivation: string;
  collectionDate: string;
  resultDate: string | null;
  issuingLaboratory: string | null;
  sectionMarkers: { page: number; title: string }[];
  coverage: { note: string; rowsDerived: number; rowsCorroborated: number };
  rows: ExpectedRow[];
}

function loadExpected(name: string): Expected {
  return JSON.parse(readFileSync(new URL(`${name}.expected.json`, SEED), 'utf8')) as Expected;
}

describe.each(FIXTURES)('%s expectations', (name) => {
  const expected = loadExpected(name);
  const fixture = load(name);

  it('records where it came from and that it is not exhaustive', () => {
    // These expectations come from poppler's column reconstruction, a different
    // algorithm from the geometry the parser will use. Absence of a row is not
    // an expectation that the parser find nothing there.
    expect(expected.derivation).toContain('poppler');
    expect(expected.coverage.rowsCorroborated).toBeLessThanOrEqual(expected.coverage.rowsDerived);
    expect(expected.rows.length).toBe(expected.coverage.rowsCorroborated);
  });

  it('states both dates as real ISO civil dates', () => {
    expect(expected.collectionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(Number.isNaN(Date.parse(expected.collectionDate))).toBe(false);
    if (expected.resultDate !== null) {
      expect(expected.resultDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(Date.parse(expected.resultDate)).toBeGreaterThanOrEqual(
        Date.parse(expected.collectionDate),
      );
    }
  });

  it('names a row the committed TextItems also contain', () => {
    // The two derivations are independent; this is where they must agree.
    for (const row of expected.rows) {
      const page = fixture.wholeLine.pages[row.page - 1] ?? [];
      const onPage = page.map((item) => item.text).join('\n');
      expect(onPage, row.label).toContain(row.label);
      expect(row.sourceRef.sourceId).toBe(name);
      expect(row.sourceRef.page).toBe(row.page);
    }
  });

  it('keeps every row consistent with its status', () => {
    for (const row of expected.rows) {
      if (row.status === 'value') {
        expect(typeof row.value, row.label).toBe('number');
        expect(Number.isFinite(row.value), row.label).toBe(true);
      }
      if (row.status === 'missing') {
        expect(row.value, row.label).toBeNull();
      }
      if (row.status === 'categorical') {
        // D15: a categorical Measurement is a printed string and nothing else.
        expect(row.textValue, row.label).not.toBe(null);
        expect(row.value, row.label).toBeNull();
        expect(row.unit, row.label).toBeNull();
        expect(row.comparator, row.label).toBeNull();
        expect(row.referenceRange, row.label).toBeNull();
      }
    }
  });

  it('states only well-formed reference ranges', () => {
    for (const row of expected.rows) {
      const range = row.referenceRange;
      if (range === null) continue;
      if (range.kind === 'closed') {
        expect(range.min, row.label).toBeTypeOf('number');
        expect(range.max, row.label).toBeTypeOf('number');
        expect(range.min ?? 0, row.label).toBeLessThanOrEqual(range.max ?? 0);
      } else if (range.kind === 'maxOnly') {
        expect(['<', '<='], row.label).toContain(range.comparator);
      } else {
        expect(range.kind, row.label).toBe('minOnly');
        expect(['>', '>='], row.label).toContain(range.comparator);
      }
    }
  });
});

describe('the expectations cover the cases later tasks need', () => {
  const full = loadExpected('ahfy-full');
  const minimal = loadExpected('ahfy-minimal');
  const all = [...full.rows, ...minimal.rows];

  it.each([
    ['value', 'a parsed numeric result'],
    ['categorical', 'a printed non-numeric result'],
    ['missing', 'a row with a range but no value'],
  ])('includes at least one %s row — %s', (status) => {
    expect(all.some((row) => row.status === status)).toBe(true);
  });

  it('includes both a closed and a one-sided reference range', () => {
    expect(all.some((row) => row.referenceRange?.kind === 'closed')).toBe(true);
    expect(all.some((row) => row.referenceRange?.kind === 'maxOnly')).toBe(true);
  });

  it('records the ΑΗΦΥ section markers the read-out must skip', () => {
    const titles = full.sectionMarkers.map((marker) => marker.title).join('|');
    expect(titles).toContain('LABEL');
    expect(titles).toContain('ΣΕΙΡΑ');
  });
});
