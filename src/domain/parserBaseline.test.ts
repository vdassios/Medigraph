import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extract } from './extract';
import { REGISTRY_VERSION } from './registry';
import { score } from './scorer';
import type { CorpusScore, MetricCount } from './scorer';
import type { ParsedRow, TextItem } from './types';

const PARSER = new URL('../../fixtures/parser/', import.meta.url);
type Metric = 'markerRecall' | 'valuePrecision' | 'unitPrecision' | 'rangePrecision';
type Counts = Record<Metric, MetricCount>;

interface Baseline {
  registryVersion: number;
  laboratories: { split: string; lab: string; all: Counts; passA: Counts }[];
  aggregate: { all: Counts; passA: Counts };
}

const baseline = JSON.parse(readFileSync(new URL('baseline.json', PARSER), 'utf8')) as Baseline;

/** The counts alone: `score` returns `unjudged` too, which is not a metric. */
function counts(found: CorpusScore): Counts {
  return {
    markerRecall: found.markerRecall,
    valuePrecision: found.valuePrecision,
    unitPrecision: found.unitPrecision,
    rangePrecision: found.rangePrecision,
  };
}

function scoreLab(split: string, lab: string): { all: Counts; passA: Counts } {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(`${split}/${lab}/${name}`, PARSER), 'utf8'));
  const items = read('textitems.json') as { fragmented: { pages: TextItem[][] } };
  const fixture = read('expected.json') as {
    rows: (Pick<
      ParsedRow,
      'label' | 'markerKey' | 'status' | 'value' | 'comparator' | 'textValue' | 'unit'
    > & { referenceRange: ParsedRow['referenceRange'] })[];
    coverage: { notScored: string[] };
  };

  const rows = extract({
    sourceId: lab,
    adapterId: 'pdf-text',
    tier: 'E0',
    pages: items.fragmented.pages,
  }).rows;

  const expected: ParsedRow[] = fixture.rows.map((row, index) => ({
    ...row,
    id: `${lab}:expected:${String(index)}`,
    categoricalReference: null,
    confidence: 'high',
    source: 'anchor',
    section: null,
    flags: [],
    sourceOrder: index,
  }));
  const notScored = new Set(fixture.coverage.notScored);

  return {
    all: counts(score(expected, rows, notScored)),
    passA: counts(
      score(
        expected,
        rows.filter((row) => row.id.includes(':anchor:')),
        notScored,
      ),
    ),
  };
}

function sum(pick: (lab: Baseline['laboratories'][number]) => Counts): Counts {
  const add = (metric: Metric): MetricCount =>
    baseline.laboratories.reduce<MetricCount>(
      (total, lab) => ({
        correct: total.correct + pick(lab)[metric].correct,
        total: total.total + pick(lab)[metric].total,
      }),
      { correct: 0, total: 0 },
    );

  return {
    markerRecall: add('markerRecall'),
    valuePrecision: add('valuePrecision'),
    unitPrecision: add('unitPrecision'),
    rangePrecision: add('rangePrecision'),
  };
}

/**
 * The committed release baseline (Task 2.5c).
 *
 * `scripts/corpus-score.ts` enforces the floors, which are the numbers a
 * release may not fall below. This file enforces something narrower and just
 * as useful: that the committed record still says what the parser actually
 * scores. A change that moves the corpus by a row has to update the baseline
 * in the same commit, so the number is reviewed rather than drifting quietly
 * somewhere above the floor.
 */
describe('the parser release baseline', () => {
  it('was recorded against this registry version', () => {
    // A score produced by a different vocabulary is a different score.
    expect(baseline.registryVersion).toBe(REGISTRY_VERSION);
  });

  it('names every laboratory the corpus carries, and only those', () => {
    const committed = baseline.laboratories.map((lab) => `${lab.split}/${lab.lab}`);
    const found: string[] = [];

    for (const split of ['training', 'holdout'] as const) {
      const dir = new URL(`${split}/`, PARSER);
      for (const lab of readdirSync(fileURLToPath(dir)).sort()) {
        if (statSync(fileURLToPath(new URL(`${split}/${lab}`, PARSER))).isDirectory()) {
          found.push(`${split}/${lab}`);
        }
      }
    }

    expect(committed).toEqual(found);
  });

  it.each(baseline.laboratories.map((lab) => [`${lab.split}/${lab.lab}`, lab] as const))(
    'still scores %s as the baseline records',
    (_name, lab) => {
      const found = scoreLab(lab.split, lab.lab);

      expect(found.all).toEqual(lab.all);
      expect(found.passA).toEqual(lab.passA);
    },
  );

  it('aggregates as the sum of its laboratories', () => {
    // The same rule `corpus-score.ts` uses: marker keys repeat across
    // laboratories, so one score over a concatenated table would pair one
    // document's row against another's.
    expect(baseline.aggregate.all).toEqual(sum((lab) => lab.all));
    expect(baseline.aggregate.passA).toEqual(sum((lab) => lab.passA));
  });
});
