import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MarkerDef } from '../types';
import { normaliseLabel } from '../text';
import { isKnownUnit, normaliseUnit } from '../units';
import {
  BIOCHEMISTRY_MARKERS,
  COAGULATION_MARKERS,
  HAEMATOLOGY_MARKERS,
  HORMONE_MARKERS,
  INFLAMMATION_MARKERS,
  LIPID_MARKERS,
  MARKERS,
  REGISTRY_VERSION,
  URINALYSIS_MARKERS,
  VITAMIN_MARKERS,
} from './index';

const SEED = new URL('../../../fixtures/seed/', import.meta.url);
const REGISTRY_SEED = new URL('../../../fixtures/registry-seed/', import.meta.url);

interface Item {
  text: string;
  x: number;
  y: number;
}

interface Fixture {
  fragmented: { pages: Item[][] };
  wholeLine: { pages: Item[][] };
}

/** The label column starts every ΑΗΦΥ row; the result column starts at 0.384. */
const LABEL_COLUMN_MAX_X = 0.37;

/**
 * Everything alias rule 4 allows an alias to be quoted from: the Task 0.5c
 * ΚΕΟΚΕΕ seed and the two Task 0.3 fixtures.
 *
 * The fixtures contribute three readings of the same pages, because a printed
 * `Περιγραφή` cell can be split three ways by pdf.js: the whole-line items as
 * they stand, and the label-column fragments of each page in reading order,
 * which rejoins a cell the laboratory wrapped across two lines.
 *
 * Substring containment is the check, not equality. It cannot prove an alias
 * is the *right* marker's — only human review does that, one panel at a time —
 * but it does stop the failure this rule exists for: a plausible Greek
 * spelling no laboratory prints and no catalogue lists, invented by a model
 * and silently matching the wrong row.
 */
function sourcedVocabulary(): string {
  const sources = [readFileSync(new URL('keokee.tsv', REGISTRY_SEED), 'utf8')];

  for (const name of ['ahfy-minimal', 'ahfy-full']) {
    const fixture = JSON.parse(
      readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8'),
    ) as Fixture;

    for (const page of fixture.wholeLine.pages) {
      sources.push(page.map((item) => item.text).join(' '));
    }

    for (const page of fixture.fragmented.pages) {
      const labelColumn = page
        .filter((item) => item.x < LABEL_COLUMN_MAX_X)
        .sort((a, b) => a.y - b.y || a.x - b.x);
      sources.push(labelColumn.map((item) => item.text).join(' '));
    }
  }

  return sources.join('\n');
}

const VOCABULARY = sourcedVocabulary();

/** Every printed form a marker claims: `markerKey` indexes exactly these. */
function printedForms(marker: MarkerDef): string[] {
  return [...marker.aliases, ...marker.abbreviations];
}

const PANELS: [string, readonly MarkerDef[]][] = [
  ['haematology', HAEMATOLOGY_MARKERS],
  ['biochemistry', BIOCHEMISTRY_MARKERS],
  ['lipids', LIPID_MARKERS],
  ['hormones', HORMONE_MARKERS],
  ['vitamins', VITAMIN_MARKERS],
  ['inflammation', INFLAMMATION_MARKERS],
  ['coagulation', COAGULATION_MARKERS],
  ['urinalysis', URINALYSIS_MARKERS],
];

describe('REGISTRY_VERSION', () => {
  it('starts at 1', () => {
    expect(REGISTRY_VERSION).toBe(1);
  });

  it('is an integer, because equality is what fixtures assert', () => {
    expect(Number.isInteger(REGISTRY_VERSION)).toBe(true);
  });
});

describe('MARKERS', () => {
  it('is every panel, in panel order, and nothing else', () => {
    expect(MARKERS).toEqual(PANELS.flatMap(([, markers]) => [...markers]));
  });

  it('seeds the markers the two fixtures print', () => {
    // The Task 1.6b-core scope: enough to unblock Wave 2, not the v1 coverage
    // target of ≥120 markers, which Task 2.5r reaches from the 0.5a corpus.
    expect(MARKERS.length).toBeGreaterThanOrEqual(40);
  });

  it('carries no coagulation marker yet', () => {
    // Neither fixture orders one, and rule 4 admits nothing unsourced.
    expect(COAGULATION_MARKERS).toEqual([]);
  });

  it.each(MARKERS.map((marker) => [marker.id, marker] as const))(
    '%s has a stable lower-case id',
    (id) => {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    },
  );

  it('never repeats an id', () => {
    const ids = MARKERS.map((marker) => marker.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(MARKERS.map((marker) => [marker.id, marker] as const))(
    '%s has display names in both languages',
    (_id, marker) => {
      expect(marker.en.trim()).toBe(marker.en);
      expect(marker.el.trim()).toBe(marker.el);
      expect(marker.en).not.toBe('');
      expect(marker.el).not.toBe('');
    },
  );

  it.each(MARKERS.map((marker) => [marker.id, marker] as const))(
    '%s claims at least one alias, each stored as printed',
    (_id, marker) => {
      expect(marker.aliases.length).toBeGreaterThan(0);
      for (const printed of printedForms(marker)) {
        expect(printed.trim()).toBe(printed);
        expect(printed).not.toBe('');
      }
    },
  );

  it('never lets two markers claim one printed form', () => {
    // A shared alias would resolve to whichever entry `markerKey` indexed
    // last — a wrong marker key, and downstream a wrong health chart.
    const claimedBy = new Map<string, string>();
    const collisions: string[] = [];

    for (const marker of MARKERS) {
      for (const printed of printedForms(marker)) {
        const normalised = normaliseLabel(printed);
        const prior = claimedBy.get(normalised);
        if (prior !== undefined) {
          collisions.push(`${normalised}: ${prior} and ${marker.id}`);
        }
        claimedBy.set(normalised, marker.id);
      }
    }

    expect(collisions).toEqual([]);
  });

  it('quotes every alias and abbreviation from a sourced vocabulary', () => {
    const unsourced: string[] = [];

    for (const marker of MARKERS) {
      for (const printed of printedForms(marker)) {
        if (!VOCABULARY.includes(printed)) {
          unsourced.push(`${marker.id}: ${JSON.stringify(printed)}`);
        }
      }
    }

    expect(unsourced).toEqual([]);
  });

  it('names only units the allowlist carries, already canonical', () => {
    const wrong = MARKERS.filter(
      (marker) =>
        marker.canonicalUnit !== null &&
        (!isKnownUnit(marker.canonicalUnit) ||
          normaliseUnit(marker.canonicalUnit) !== marker.canonicalUnit),
    );

    expect(wrong.map((marker) => `${marker.id}: ${String(marker.canonicalUnit)}`)).toEqual([]);
  });

  it('leaves canonicalUnit null only where the laboratory prints no unit', () => {
    // The urinalysis dipstick and sediment rows, and nothing else so far.
    const unitless = MARKERS.filter((marker) => marker.canonicalUnit === null).map(
      (marker) => marker.id,
    );

    expect(unitless).toEqual(URINALYSIS_MARKERS.map((marker) => marker.id));
  });

  it.each(
    MARKERS.filter((marker) => marker.plausibleRange !== undefined).map(
      (marker) => [marker.id, marker] as const,
    ),
  )('%s bounds a plausible range that is wide and ordered', (_id, marker) => {
    const [low, high] = marker.plausibleRange ?? [0, 0];
    expect(Number.isFinite(low)).toBe(true);
    expect(Number.isFinite(high)).toBe(true);
    expect(low).toBeLessThan(high);
  });

  it.each([
    'glucose',
    'cholesterol',
    'hdl',
    'ldl',
    'triglycerides',
    'creatinine',
    'uric-acid',
    'haemoglobin',
    'mchc',
    'ferritin',
    'vitamin-b12',
    'folate',
    'vitamin-d',
  ])('keeps the id %s that the units conversion table is keyed by', (id) => {
    // `convert` is keyed by marker key, so renaming one of these silently
    // disables its conversion instead of failing.
    const marker = MARKERS.find((candidate) => candidate.id === id);
    expect(marker).toBeDefined();
    expect(marker?.canonicalUnit).not.toBeNull();
  });

  it('gives a sectionHint only where it breaks a tie', () => {
    // The plan reserves sectionHint for the T4 tier's unique tie-break, so a
    // hint on a marker no other entry can be confused with is noise.
    const hinted = MARKERS.filter((marker) => marker.sectionHint !== undefined);
    expect(hinted.map((marker) => marker.id)).toEqual(
      URINALYSIS_MARKERS.map((marker) => marker.id),
    );
  });
});
