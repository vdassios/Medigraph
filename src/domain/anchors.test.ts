import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SectionTitle } from './ahfyDocument';
import { validateAhfyDocument } from './ahfyDocument';
import { findAnchors } from './anchors';
import { markerKey } from './markerKey';
import { clusterRows } from './rows';
import type { Anchor, Row, TextItem } from './types';

const SEED = new URL('../../fixtures/seed/', import.meta.url);

function pages(name: string): TextItem[][] {
  const parsed = JSON.parse(readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8')) as {
    fragmented: { pages: TextItem[][] };
  };
  return parsed.fragmented.pages;
}

/** Anchor a whole seed document the way `extract` will: Pass V, rows, Pass A. */
function anchorFixture(name: string): { anchors: Anchor[]; rows: Row[] } {
  const validation = validateAhfyDocument(pages(name));
  if (!validation.ok) {
    throw new Error(`expected an ΑΗΦΥ document, got ${validation.reason}`);
  }

  const rows = clusterRows(name, pages(name));
  return { anchors: findAnchors(rows, validation.document.sectionTitles), rows };
}

/** One row, its items laid out left to right on page 1. */
function row(texts: string[], overrides: Partial<Row> = {}): Row {
  let x = 0.131;
  const items = texts.map((text, index) => {
    const item = { id: `i${String(index)}`, text, x, y: 0.2, w: text.length * 0.008, h: 0.014 };
    x += item.w + 0.01;
    return item;
  });

  return { id: 'r1', sourceId: 's', page: 1, items, y: 0.2, h: 0.014, ...overrides };
}

function anchor(texts: string[], sections: SectionTitle[] = []): Anchor | undefined {
  return findAnchors([row(texts)], sections)[0];
}

describe('findAnchors', () => {
  describe('the tiers', () => {
    it.each([
      ['a bare abbreviation', ['WBC'], 'wbc'],
      ['a parenthesised abbreviation', ['(RBC)'], 'rbc'],
      ['an abbreviation beside its Greek name', ['Ερυθρά', 'Αιμοσφαίρια', '(RBC)'], 'rbc'],
    ])('matches %s at T1', (_name, texts, markerKey) => {
      expect(anchor(texts)).toMatchObject({ markerKey, tier: 'T1', confidence: 'high' });
    });

    it('tolerates a space between an abbreviation and its parenthesis', () => {
      // The corpus prints `Lp (α)` for `Lp(a)`; the same fold reaches this.
      expect(anchor(['( RBC )'])).toMatchObject({ markerKey: 'rbc', tier: 'T1' });
    });

    it('folds Greek and Latin confusables, but only in an abbreviation', () => {
      // ahfy-full prints `(ΗDL-C)` opening with a GREEK CAPITAL ETA. The
      // registry stores it as printed, and the fold is what lets the Latin
      // spelling reach the same marker.
      expect(anchor(['(ΗDL-C)'])).toMatchObject({ markerKey: 'hdl', tier: 'T1' });
      expect(anchor(['(HDL-C)'])).toMatchObject({ markerKey: 'hdl', tier: 'T1' });
    });

    it('matches a printed cell against a registry alias at T2', () => {
      expect(anchor(['Χροιά', '(Χροιά)'])).toMatchObject({
        markerKey: 'urine-colour',
        tier: 'T2',
        confidence: 'high',
      });
    });

    it('matches a near miss at T4, at medium confidence', () => {
      // `φερριτιν` is one edit from the alias `ΦΕΡΡΙΤΙΝΗ`, and nothing else in
      // the registry is within the bound its length allows.
      expect(anchor(['Φερριτίν'])).toMatchObject({
        markerKey: 'ferritin',
        tier: 'T4',
        confidence: 'medium',
      });
    });

    it('rejects a fuzzy tie it cannot break', () => {
      // Equidistant from `hdl-χοληστερολη` and `ldl-χοληστερολη`, and neither
      // marker declares a sectionHint. A match that cannot tell two markers
      // apart is worth less than the review prompt an unknown raises.
      //
      // The tie-break's *success* path needs two colliding markers of which
      // exactly one declares a hint matching the heading. The seed registry
      // contains no such pair; Task 2.5r's panels are where it becomes
      // reachable.
      expect(findAnchors([row(['xdl-χοληστερολη'])], [])).toEqual([]);
    });

    it('reads nothing from a row naming no marker', () => {
      expect(findAnchors([row(['Παρατηρήσεις', 'Γενικής', 'Εξέτασης'])], [])).toEqual([]);
      expect(findAnchors([], [])).toEqual([]);
    });
  });

  describe('tier-wide search', () => {
    it('prefers an abbreviation to an alias printed left of it', () => {
      // Evaluating tier by candidate would let the leading alias win merely by
      // being visited first.
      const found = anchor(['Χροιά', '(HGB)']);

      expect(found).toMatchObject({ markerKey: 'haemoglobin', tier: 'T1' });
    });
  });

  describe('the matched span', () => {
    it('is the abbreviation, not the run used to find it', () => {
      // Choosing a longer context to search with must not let an anchor
      // swallow the marker or value beside it.
      expect(anchor(['Ερυθρά', 'Αιμοσφαίρια', '(RBC)'])?.label).toBe('(RBC)');
    });

    it('keeps the whole span when the abbreviation itself is spaced', () => {
      expect(anchor(['( RBC )'])?.label).toBe('( RBC )');
    });

    it('points at the item holding it, with an exact text range', () => {
      const found = anchor(['Αιματοκρίτης', '(HCT)']);

      expect(found?.sourceRef).toMatchObject({
        sourceId: 's',
        page: 1,
        itemIds: ['i1'],
        textRange: { itemId: 'i1', start: 0, end: 5 },
      });
    });

    it('names every item a span crosses, and drops the range across the join', () => {
      const found = anchor(['( RBC )'.replace(/ /gu, ' ')]);
      const crossing = findAnchors([row(['Lp', '(a)'])], []);

      expect(found?.sourceRef.itemIds).toHaveLength(1);
      // Nothing in the seed registry spans two items, so the same rule is
      // asserted through the span that does: a two-item run yields no anchor
      // here and this stays a statement about geometry, not about matching.
      expect(crossing).toEqual([]);
    });
  });

  describe('choosing between hits', () => {
    it('emits one anchor per marker, however often the row prints it', () => {
      // The ΑΗΦΥ label cell prints its abbreviation twice.
      const found = findAnchors([row(['WBC', '(WBC)'])], []);

      expect(found).toHaveLength(1);
      expect(found[0]?.markerKey).toBe('wbc');
    });

    it('reads a parenthesised code over a bare one in the prose', () => {
      // `Μέση Περιεκτικότης HGB (MCH)` is mean corpuscular haemoglobin.
      // Reading its `HGB` as haemoglobin would chart a measurement the
      // laboratory never reported.
      const found = findAnchors([row(['Μέση', 'Περιεκτικότης', 'HGB', '(MCH)', '(MCH)'])], []);

      expect(found.map((each) => each.markerKey)).toEqual(['mch']);
    });

    it('keeps the longest of two overlapping spans', () => {
      // `( RBC )` and the `RBC` inside it are both T1 hits over the same
      // characters; only the longer survives.
      const found = findAnchors([row(['( RBC )'])], []);

      expect(found).toHaveLength(1);
      expect(found[0]?.label).toBe('( RBC )');
    });

    it('never emits two anchors over the same characters', () => {
      const { anchors, rows } = anchorFixture('ahfy-full');

      for (const each of rows) {
        const spans = anchors
          .filter((found) => found.sourceRef.page === each.page)
          .map((found) => found.sourceRef.itemIds ?? []);
        const flat = spans.flat();
        expect(new Set(flat).size).toBe(flat.length);
      }
    });
  });

  describe('section context', () => {
    const heading: SectionTitle = { page: 1, y: 0.1, title: 'ΕΡΥΘΡΟΚΥΤΤΑΡΙΚΗ ΣΕΙΡΑ' };

    it('carries the nearest heading above the row', () => {
      expect(anchor(['(RBC)'], [heading])?.section).toBe('ΕΡΥΘΡΟΚΥΤΤΑΡΙΚΗ ΣΕΙΡΑ');
    });

    it('ignores a heading printed below the row', () => {
      expect(anchor(['(RBC)'], [{ ...heading, y: 0.9 }])?.section).toBeNull();
    });

    it('carries a heading across a page break', () => {
      const found = findAnchors([row(['(RBC)'], { page: 3 })], [heading]);

      expect(found[0]?.section).toBe('ΕΡΥΘΡΟΚΥΤΤΑΡΙΚΗ ΣΕΙΡΑ');
    });

    it('leaves the section null when the caller supplies no headings', () => {
      expect(anchor(['(RBC)'])?.section).toBeNull();
    });

    it('anchors no marker on a heading row itself', () => {
      // A section marker emits no ParsedRow (V4), so it anchors nothing: a
      // panel heading printing `Γλυκόζη (GLU)` names the table below it.
      const found = findAnchors(
        [row(['Γλυκόζη', '(GLU)'])],
        [{ page: 1, y: 0.2, title: 'Γλυκόζη (GLU)' }],
      );

      expect(found).toEqual([]);
    });
  });

  describe('the seed fixtures', () => {
    it('anchors every row of the Latin-code dialect, all at T1', () => {
      const { anchors } = anchorFixture('ahfy-minimal');

      expect(anchors).toHaveLength(20);
      expect(anchors.every((found) => found.tier === 'T1')).toBe(true);
      expect(new Set(anchors.map((found) => found.markerKey)).size).toBe(20);
    });

    it('anchors at most one marker per printed row of the Greek dialect', () => {
      const { anchors } = anchorFixture('ahfy-full');
      const rowIds = anchors.map((found) => found.id.slice(0, found.id.indexOf(':anchor:')));

      expect(anchors).toHaveLength(59);
      expect(new Set(rowIds).size).toBe(anchors.length);
    });

    it.each([
      'haemoglobin',
      'mch',
      'mchc',
      'wbc',
      'glucose',
      'cholesterol',
      'hdl',
      'ldl',
      'ggt',
      'alp',
      'ferritin',
      'hba1c',
      'psa',
      'esr',
      'crp',
      'urine-colour',
      'urine-glucose',
    ])('anchors %s exactly once in ahfy-full', (markerKey) => {
      const { anchors } = anchorFixture('ahfy-full');

      expect(anchors.filter((found) => found.markerKey === markerKey)).toHaveLength(1);
    });

    it('anchors every marker the expectations record but the wrapped one', () => {
      // The one exception is the fixture's own artefact: `ahfy-full` wraps the
      // urine erythrocyte cell and the expectation records the first printed
      // line alone, so the label it names is not the label the document prints.
      const { anchors } = anchorFixture('ahfy-full');
      const expected = JSON.parse(
        readFileSync(new URL('ahfy-full.expected.json', SEED), 'utf8'),
      ) as { rows: { label: string }[] };

      const missed = expected.rows
        .map((each) => markerKey(each.label))
        .filter((key) => !anchors.some((found) => found.markerKey === key));

      expect(missed).toEqual(['x:ερυθρα-αιμοσφαιρια-ερυθρα']);
    });

    describe('what it does not reach, and why', () => {
      // Recorded rather than hidden: each is a registry or layout gap this
      // task surfaced, not a defect in the tier rules.

      it.each([
        ['ast', '(SGOT/AST)', 'AST/SGOT'],
        ['alt', '(SGPT/ALT)', 'ALT/SGPT'],
      ])('misses %s, printed %s where the registry holds %s', (markerKey) => {
        // The laboratory prints the pair in the opposite order to ΚΕΟΚΕΕ, and
        // a slash-joined pair is neither a standalone token nor parenthesised
        // on its own. Two fixture-sourced abbreviations in Task 2.5r close it.
        const { anchors } = anchorFixture('ahfy-full');

        expect(anchors.filter((found) => found.markerKey === markerKey)).toEqual([]);
      });

      it.each(['vitamin-d', 'urine-erythrocytes'])('misses %s, whose label wraps', (markerKey) => {
        // A wrapped label's two lines start at the same x, so the row orders
        // them interleaved with the cells between and the alias is no longer a
        // contiguous token run. `vitamin-d` also prints `[25(ΟΗ)D]` in square
        // brackets, which the parenthesised abbreviation rule does not cover.
        const { anchors } = anchorFixture('ahfy-full');

        expect(anchors.filter((found) => found.markerKey === markerKey)).toEqual([]);
      });

      it('anchors rbc twice, the second on a marker the registry lacks', () => {
        // Page 3 prints `Εμπύρηνα RBC (ΕμπύρηναRBC)` — nucleated red cells,
        // which the seed registry does not carry. It contains a standalone
        // `RBC`, so T1 matches as specified. The duplicate reaches review as a
        // conflict rather than becoming a silent wrong reading.
        const { anchors } = anchorFixture('ahfy-full');

        expect(anchors.filter((found) => found.markerKey === 'rbc')).toHaveLength(2);
      });
    });

    it('reads the mean-corpuscular rows as themselves, not as haemoglobin', () => {
      const { anchors } = anchorFixture('ahfy-full');
      const haemoglobin = anchors.filter((found) => found.markerKey === 'haemoglobin');

      expect(haemoglobin).toHaveLength(1);
      expect(haemoglobin[0]?.label).toBe('(HGB)');
    });

    it('carries the printed section into the anchors under it', () => {
      const { anchors } = anchorFixture('ahfy-full');
      const rbc = anchors.find((found) => found.markerKey === 'rbc');

      expect(rbc?.section).toBe('(LABEL RBC)');
    });
  });
});
