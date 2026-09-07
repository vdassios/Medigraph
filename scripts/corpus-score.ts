import { readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { CorpusScore, MetricCount } from '../src/domain/scorer';
import type { ExtractionResult, ParsedRow, TextItem } from '../src/domain/types';

/**
 * `pnpm corpus:score` — run the parser over the hand-checked corpus (Task 2.5b).
 *
 * This script is the wiring the scorer deliberately refuses to do. `scorer.ts`
 * never imports `extract.ts`, because a scorer that called the parser could
 * only ever report what the parser already believes; the two meet here, in a
 * script nothing else depends on.
 *
 * It reports four things per laboratory and in aggregate: marker recall, value
 * precision, unit precision and range precision — as integer
 * numerator/denominator as well as percentages, so a small laboratory cannot
 * hide behind a rounded number. It reports them twice, once over every row
 * `extract` emitted and once over Pass A alone, because the plan's floors are
 * stated separately for the two and a parser that leaned on the positional
 * read to make its numbers would not be marker-driven.
 *
 */

// ---------------------------------------------------------------------------
// Loading the domain under plain Node
// ---------------------------------------------------------------------------

/**
 * Teach Node's resolver the extensions `src/` omits.
 *
 * Node strips types from `.ts` on its own, but its ESM resolver is exact:
 * `./text` and `./registry` are how the domain imports itself, and neither
 * names a file Node will find. The hook retries a failed relative specifier as
 * `<specifier>.ts` and then as `<specifier>/index.ts`, which is the whole of
 * what the domain's import style needs. Registered before the dynamic imports
 * below, since a static import would be hoisted above it.
 *
 */
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith('.')) {
      return next(specifier, context);
    }
    try {
      return next(specifier, context);
    } catch {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        return next(`${specifier}/index.ts`, context);
      }
    }
  },
});

const { extract } = await import('../src/domain/extract');
const { REGISTRY_VERSION } = await import('../src/domain/registry');
const { score } = await import('../src/domain/scorer');

// ---------------------------------------------------------------------------
// The corpus on disk
// ---------------------------------------------------------------------------

const PARSER = new URL('../fixtures/parser/', import.meta.url);

type Split = 'training' | 'holdout';

/** The subset of `expected.json` a score depends on. */
interface ExpectedRow {
  label: string;
  markerKey: string;
  status: ParsedRow['status'];
  value: number | null;
  comparator: ParsedRow['comparator'];
  textValue: string | null;
  unit: string | null;
  referenceRange: ParsedRow['referenceRange'];
}

interface Fixture {
  split: Split;
  lab: string;
  pages: TextItem[][];
  expected: ExpectedRow[];
  /** Markers this document prints whose truth the corpus could not establish. */
  notScored: ReadonlySet<string>;
}

function load(): Fixture[] {
  const found: Fixture[] = [];

  for (const split of ['training', 'holdout'] as const) {
    const dir = new URL(`${split}/`, PARSER);
    for (const lab of readdirSync(fileURLToPath(dir)).sort()) {
      const at = new URL(`${split}/${lab}`, PARSER);
      if (!statSync(fileURLToPath(at)).isDirectory()) {
        continue;
      }

      const read = (name: string): unknown =>
        JSON.parse(readFileSync(new URL(`${split}/${lab}/${name}`, PARSER), 'utf8'));
      const items = read('textitems.json') as { fragmented: { pages: TextItem[][] } };
      const expected = read('expected.json') as {
        rows: ExpectedRow[];
        coverage: { notScored: string[] };
      };

      found.push({
        split,
        lab,
        pages: items.fragmented.pages,
        expected: expected.rows,
        notScored: new Set(expected.coverage.notScored),
      });
    }
  }

  return found;
}

/**
 * An expectation as a `ParsedRow` the scorer will accept.
 *
 * The marker key is read from the fixture, not derived here. Identity is part
 * of what a reader states about a printed row — `Μέσος όγκος ερυθρών (MCV)`
 * names MCV whatever the parser goes on to decide — and the corpus is the only
 * place that judgement can be recorded without the score becoming circular.
 * Deriving it instead with `markerKey` is what the earlier runs did, and it
 * cost more than it looked: `markerKey` matches a whole normalised label
 * against the registry, while `anchors.ts` matches a marker *inside* a row, so
 * every wrapped or bracketed label scored as a miss and again as a spurious
 * emission. On ΙΑΣΩ that was all fifteen of its apparent misses.
 *
 * Everything the scorer does not read is filled with a value that cannot
 * affect the comparison.
 */
function asParsedRow(row: ExpectedRow, lab: string, index: number): ParsedRow {
  return {
    id: `${lab}:expected:${String(index)}`,
    label: row.label,
    markerKey: row.markerKey,
    status: row.status,
    value: row.value,
    comparator: row.comparator,
    textValue: row.textValue,
    unit: row.unit,
    referenceRange: row.referenceRange,
    categoricalReference: null,
    confidence: 'high',
    source: 'anchor',
    section: null,
    flags: [],
    sourceOrder: index,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** A row Pass A anchored to a marker, as opposed to one read by column (D5). */
function isPassA(row: ParsedRow): boolean {
  return row.id.includes(':anchor:');
}

interface Scored {
  fixture: Fixture;
  result: ExtractionResult;
  all: CorpusScore;
  passA: CorpusScore;
}

function scoreOne(fixture: Fixture): Scored {
  const result = extract({
    sourceId: fixture.lab,
    adapterId: 'pdf-text',
    tier: 'E0',
    pages: fixture.pages,
  });
  const expected = fixture.expected.map((row, index) => asParsedRow(row, fixture.lab, index));

  return {
    fixture,
    result,
    all: score(expected, result.rows, fixture.notScored),
    passA: score(expected, result.rows.filter(isPassA), fixture.notScored),
  };
}

const METRICS = ['markerRecall', 'valuePrecision', 'unitPrecision', 'rangePrecision'] as const;

/**
 * The aggregate is the sum of the per-laboratory counts, not one score over
 * every row at once.
 *
 * Marker keys repeat across laboratories — every one of them prints HGB — and
 * the scorer pairs one expectation to one emitted row by key alone. Scoring a
 * concatenated table would therefore let one laboratory's HGB answer another's,
 * turning a miss here and a hit there into a matched pair with the wrong value.
 * Summing numerators and denominators keeps each pairing inside the document it
 * came from and still reports the corpus-wide ratio the 2.5c floors are stated
 * over.
 */
function aggregate(scores: readonly CorpusScore[]): CorpusScore {
  const sum = (read: (score: CorpusScore) => MetricCount): MetricCount =>
    scores.reduce<MetricCount>(
      (total, each) => ({
        correct: total.correct + read(each).correct,
        total: total.total + read(each).total,
      }),
      { correct: 0, total: 0 },
    );

  return {
    markerRecall: sum((each) => each.markerRecall),
    valuePrecision: sum((each) => each.valuePrecision),
    unitPrecision: sum((each) => each.unitPrecision),
    rangePrecision: sum((each) => each.rangePrecision),
    unjudged: scores.reduce((total, each) => total + each.unjudged, 0),
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const NAME_WIDTH = 38;
const CELL_WIDTH = 16;

/**
 * One metric as counts and a percentage.
 *
 * A denominator of zero is printed as `—` rather than 0% or 100%: unit and
 * range precision count field opportunities, so a laboratory that prints no
 * units at all has not scored badly, it has not been asked the question.
 */
function cell(count: MetricCount): string {
  const ratio = `${String(count.correct)}/${String(count.total)}`;
  const percent = count.total === 0 ? '—' : `${((100 * count.correct) / count.total).toFixed(1)}%`;

  return `${ratio.padEnd(8)}${percent}`.padEnd(CELL_WIDTH);
}

function row(name: string, score: CorpusScore): string {
  return `  ${name.padEnd(NAME_WIDTH)}${METRICS.map((metric) => cell(score[metric])).join('')}`.trimEnd();
}

function table(
  title: string,
  scored: readonly Scored[],
  read: (each: Scored) => CorpusScore,
): void {
  const headings = ['recall', 'value', 'unit', 'range'].map((each) => each.padEnd(CELL_WIDTH));

  console.log(`${title}\n`);
  console.log(`  ${'laboratory'.padEnd(NAME_WIDTH)}${headings.join('')}`.trimEnd());
  for (const each of scored) {
    console.log(
      row(`${each.fixture.split === 'training' ? 'T' : 'H'} ${each.fixture.lab}`, read(each)),
    );
  }
  console.log(`  ${'─'.repeat(NAME_WIDTH + CELL_WIDTH * METRICS.length - 2)}`);

  const total = aggregate(scored.map(read));
  console.log(row('aggregate', total));

  // Rows set aside because the corpus derived their marker and could not judge
  // it. Printed, not swallowed: a number that grows is the corpus falling
  // further behind the documents, not the parser improving.
  if (total.unjudged > 0) {
    console.log(`  ${'set aside as notScored'.padEnd(NAME_WIDTH)}${String(total.unjudged)}`);
  }
  console.log('');
}

/**
 * Labels no registry entry claims, which is Task 2.5r's worklist.
 *
 * Training labels are printed; the holdout's are counted and withheld. The
 * corpus keeps one laboratory blind precisely so that aliases are not authored
 * against it, and a report that listed its unrecognised labels would hand
 * someone the material the seal exists to withhold. The count still moves when
 * registry coverage improves, so nothing measurable is lost.
 */
function gaps(scored: readonly Scored[]): void {
  console.log('REGISTRY GAPS — labels that stayed unrecognised\n');

  for (const each of scored) {
    const { split, lab } = each.fixture;
    const unrecognised = each.result.unrecognised;
    console.log(`  ${split}/${lab}`);

    if (unrecognised.length === 0) {
      console.log('    none');
      continue;
    }
    if (split === 'holdout') {
      console.log(`    ${String(unrecognised.length)} sealed (Task 2.5c unseals the holdout)`);
      continue;
    }

    const counted = new Map<string, number>();
    for (const label of unrecognised) {
      counted.set(label, (counted.get(label) ?? 0) + 1);
    }
    for (const [label, times] of [...counted].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )) {
      console.log(`    ${`${String(times)}×`.padStart(4)}  ${label}`);
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------

const fixtures = load();
if (fixtures.length === 0) {
  throw new Error('empty-corpus: fixtures/parser holds no laboratory');
}

const scored = fixtures.map(scoreOne);
const expectedRows = fixtures.reduce((total, each) => total + each.expected.length, 0);
const training = fixtures.filter((each) => each.split === 'training').length;

console.log(`Medigraph parser corpus — registry version ${String(REGISTRY_VERSION)}`);
console.log(
  `${String(fixtures.length)} laboratories (${String(training)} training, ` +
    `${String(fixtures.length - training)} holdout) · ${String(expectedRows)} expected rows\n`,
);

// Pass V is a gate, not a prior: `extract` throws on a document it rejects, so
// reaching this line at all is the validation result. Printing it makes that
// visible rather than implicit.
console.log('PASS V — every document validated as ΑΗΦΥ\n');
const named = scored.map((each) => `${each.fixture.split}/${each.fixture.lab}`);
const width = Math.max(...named.map((name) => name.length)) + 2;
for (const [index, each] of scored.entries()) {
  console.log(
    `  ${(named[index] ?? '').padEnd(width)}accepted (${String(each.fixture.pages.length)} pages)`,
  );
}
console.log('');

table('EVERY EMITTED ROW', scored, (each) => each.all);
table('PASS A ONLY — rows anchored to a registry marker', scored, (each) => each.passA);
gaps(scored);

console.log('T = training · H = holdout (scored blind; never tune against it)');
