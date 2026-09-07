import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAhfyDocument } from './ahfyDocument';
import { findIdentifierCandidates } from './identifiers';
import type { ParsedRow, ReferenceRange, TextItem } from './types';

const PARSER = new URL('../../fixtures/parser/', import.meta.url);

interface Fixture {
  split: 'training' | 'holdout';
  lab: string;
  items: { sourceId: string; pageCount: number; fragmented: { pages: TextItem[][] } };
  expected: {
    sourceId: string;
    derivation: string;
    collectionDate: string;
    resultDate: string | null;
    issuingLaboratory: string;
    sectionMarkers: { page: number; title: string }[];
    rows: (Pick<
      ParsedRow,
      'label' | 'status' | 'value' | 'comparator' | 'textValue' | 'unit' | 'referenceRange'
    > & { page: number; categoricalReference: string | null })[];
    coverage: { note: string; rowsDerived: number; rowsCorroborated: number };
  };
}

function load(): Fixture[] {
  const out: Fixture[] = [];
  for (const split of ['training', 'holdout'] as const) {
    const dir = new URL(`${split}/`, PARSER);
    for (const lab of readdirSync(fileURLToPath(dir)).sort()) {
      if (!statSync(fileURLToPath(new URL(`${split}/${lab}`, PARSER))).isDirectory()) continue;
      const read = (name: string): unknown =>
        JSON.parse(readFileSync(new URL(`${split}/${lab}/${name}`, PARSER), 'utf8'));
      out.push({
        split,
        lab,
        items: read('textitems.json') as Fixture['items'],
        expected: read('expected.json') as Fixture['expected'],
      });
    }
  }
  return out;
}

const fixtures = load();
const training = fixtures.filter((f) => f.split === 'training');
const holdout = fixtures.filter((f) => f.split === 'holdout');
const everyText = fixtures.flatMap((f) => f.items.fragmented.pages.flat().map((i) => i.text));

describe('the corpus meets its sourcing floor', () => {
  it('carries at least three issuing laboratories', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
    expect(new Set(fixtures.map((f) => f.expected.issuingLaboratory)).size).toBe(fixtures.length);
  });

  it('holds one entire laboratory blind', () => {
    expect(holdout).toHaveLength(1);
    expect(training.length).toBeGreaterThanOrEqual(2);
  });

  it('never splits one laboratory across training and holdout', () => {
    const labs = fixtures.map((f) => f.lab);
    expect(new Set(labs).size).toBe(labs.length);
  });

  it('commits no source document', () => {
    const walk = (dir: URL): string[] =>
      readdirSync(fileURLToPath(dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : [e.name],
      );
    expect(walk(PARSER).filter((n) => !n.endsWith('.json'))).toEqual([]);
  });
});

describe.each(fixtures)('$split/$lab', (fixture) => {
  const pages = fixture.items.fragmented.pages;

  it('names itself consistently across both files', () => {
    expect(fixture.items.sourceId).toBe(fixture.lab);
    expect(fixture.expected.sourceId).toBe(fixture.lab);
    expect(fixture.items.pageCount).toBe(pages.length);
  });

  it('states every observation inside the page', () => {
    for (const item of pages.flat()) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.x + item.w).toBeLessThanOrEqual(1);
      expect(item.y + item.h).toBeLessThanOrEqual(1);
      expect(item.text).not.toBe('');
    }
  });

  it('gives every observation an id naming its page and position', () => {
    pages.forEach((page, index) => {
      const ids = page.map((_, i) => `p${String(index + 1)}-f${String(i)}`);
      expect(page.map((item) => item.id)).toEqual(ids);
    });
  });

  it('preserves the chrome Pass V validates', () => {
    expect(validateAhfyDocument(pages).ok).toBe(true);
  });

  it('derives its expectations independently of the parser', () => {
    // A corpus scored against its own parser's output would measure nothing.
    expect(fixture.expected.derivation).toMatch(/poppler/u);
    for (const module of ['rows.ts', 'anchors.ts', 'numbers.ts', 'ranges.ts']) {
      expect(fixture.expected.derivation).toContain(module);
    }
  });

  it('reports the dates and the issuing laboratory', () => {
    expect(fixture.expected.collectionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    if (fixture.expected.resultDate !== null) {
      expect(fixture.expected.resultDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    }
    expect(fixture.expected.issuingLaboratory).not.toBe('');
  });

  it('states rows that agree with the committed observations', () => {
    const { rows, coverage } = fixture.expected;
    expect(rows.length).toBe(coverage.rowsCorroborated);
    expect(coverage.rowsCorroborated).toBeLessThanOrEqual(coverage.rowsDerived);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.page).toBeGreaterThanOrEqual(1);
      expect(row.page).toBeLessThanOrEqual(pages.length);
      expect(row.label).not.toBe('');
    }
  });

  it('keeps every field consistent with its row status', () => {
    for (const row of fixture.expected.rows) {
      if (row.status === 'value') {
        expect(typeof row.value).toBe('number');
        expect(Number.isFinite(row.value)).toBe(true);
        expect(row.textValue).toBeNull();
        expect(row.categoricalReference).toBeNull();
      } else {
        // The range column prints a qualitative expectation for these rows,
        // so it is read as categoricalReference and never as a numeric range.
        expect(row.value).toBeNull();
        expect(row.comparator).toBeNull();
        expect(row.referenceRange).toBeNull();
      }
      if (row.status === 'categorical') expect(row.textValue).not.toBeNull();
      if (row.status === 'missing') expect(row.textValue).toBeNull();
    }
  });

  it('states only well-formed reference ranges', () => {
    const ranges = fixture.expected.rows
      .map((row) => row.referenceRange)
      .filter((range): range is ReferenceRange => range !== null);
    for (const range of ranges) {
      if (range.kind === 'closed') {
        expect(range.min).toBeLessThanOrEqual(range.max);
      } else if (range.kind === 'minOnly') {
        expect(['>', '>=']).toContain(range.comparator);
      } else {
        expect(['<', '<=']).toContain(range.comparator);
      }
    }
  });

  it('carries no identity beyond the synthetic stand-ins', () => {
    // Redaction replaced each identifier in place, so the detector still fires
    // on every position it will fire on in production — with nothing real.
    const found = findIdentifierCandidates(fixture.lab, pages);
    expect(found.length).toBeGreaterThan(0);
    const names = found.filter((c) => c.kind === 'name').map((c) => c.text);
    for (const name of names) {
      expect(name).toMatch(/ΠΑΠΑΔΟΠΟΥΛΟΣ|ΓΕΩΡΓΙΟΣ|ΙΩΑΝΝΙΔΗΣ|ΕΛΕΝΗ/u);
    }
  });
});

describe('the corpus covers the observed content dialects', () => {
  it.each([
    [/^[Α-ΩΆΈΉΊΌΎΏα-ωάέήίόύώ][Α-ΩΆΈΉΊΌΎΏα-ωάέήίόύώ ]+\(/u, 'Greek-name labels'],
    [/^[A-Z]{2,6}[%#]? \([A-Z]{2,6}[%#]?\)$/u, 'bare Latin-code labels'],
    [/^\d+,\d+$/u, 'comma decimals'],
    [/^\d+\.\d+$/u, 'period decimals'],
    [/\d\s*-\s*\d[\d,.\s]*[A-Za-zμ%]/u, 'a unit inside the range column'],
    [/κ\.ο\.π/u, 'the qualitative urine panel'],
    // ΙΑΣΩ ΘΕΣΣΑΛΙΑΣ prints all three: an abbreviation with no space before its
    // bracket, which defeats a label-then-abbreviation split; ΜΟΝΟ spelled in
    // Greek capitals inside a bracket that every other laboratory fills with
    // Latin ones; and a reference the laboratory printed as a bound rather than
    // an interval.
    [/[Α-Ωα-ω]\([A-ZΑ-Ω]/u, 'an abbreviation glued to its label'],
    [/\(ΜΟΝΟ%\)/u, 'a Greek homoglyph inside a Latin-looking abbreviation'],
    [/^<\s*\d/u, 'a one-sided printed reference'],
  ])('states %s (%s)', (pattern) => {
    expect(everyText.some((text) => pattern.test(text))).toBe(true);
  });

  it('states the (LABEL …) structural rows', () => {
    const titles = fixtures.flatMap((f) => f.expected.sectionMarkers.map((m) => m.title));
    expect(titles.some((title) => title.includes('(LABEL'))).toBe(true);
  });
});
