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

    const haystack = FIXTURES.map(([name]) => read(name)).join('\n');
    expect(needles.filter((needle) => haystack.includes(needle))).toEqual([]);
  });
});
