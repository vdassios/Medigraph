import { normaliseLabel } from './text';
import { normaliseUnit } from './units';
import type { ParsedRow, ReferenceRange } from './types';

/**
 * Corpus metrics.
 *
 * The scorer is deliberately blind to how a row was produced: it takes two
 * arrays of `ParsedRow` and compares them. `src/domain/scorer.ts` never imports
 * `extract.ts` — the scripts do the wiring — because a scorer that called the
 * parser could only ever report what the parser already believes, and the
 * metric definitions would have no independent test.
 *
 * Every rule below is from the plan's "Metric semantics". The two that decide
 * what the numbers mean are worth stating up front:
 *
 * - **Recall counts expected markers; precision counts emitted rows.** Missing
 *   a marker costs recall. Emitting one that should not exist, or emitting a
 *   second copy of one that should, costs precision. A parser cannot buy recall
 *   by guessing, because every guess it emits is a precision denominator.
 * - **Unit and range precision count field opportunities, not rows.** A field
 *   scores when either side printed it, so an omitted unit and an invented one
 *   are both wrong, and a pair with no unit on either side is not counted at
 *   all — otherwise a corpus of unitless urine rows would inflate the score.
 */

export interface MetricCount {
  correct: number;
  total: number;
}

export interface CorpusScore {
  markerRecall: MetricCount;
  valuePrecision: MetricCount;
  unitPrecision: MetricCount;
  rangePrecision: MetricCount;
}

/**
 * Relative tolerance with an absolute floor.
 *
 * Relative alone cannot compare against zero, and absolute alone is wrong
 * across the six orders of magnitude a laboratory prints — 0.02 K/μL and
 * 250000 all appear in one document.
 */
const RELATIVE = 1e-6;
const FLOOR = 1e-9;

function close(expected: number, actual: number): boolean {
  return Math.abs(actual - expected) <= Math.max(FLOOR, Math.abs(expected) * RELATIVE);
}

const STATUSES = new Set(['value', 'categorical', 'missing']);

/**
 * Refuse to score a row that cannot be compared.
 *
 * A golden table is written by hand and a prediction table is written by a
 * parser under development; either can be malformed, and a scorer that
 * silently counted a malformed row would report a number nobody could act on.
 * These are the invariants scoring itself depends on, not a restatement of the
 * persisted schema — `validateProfile` owns that, and nothing here is
 * persisted.
 */
function assertScorable(rows: readonly ParsedRow[], side: 'expected' | 'actual'): void {
  for (const [index, row] of rows.entries()) {
    const at = `${side}[${String(index)}]`;

    if (row.markerKey === '') {
      fail(at, 'has no marker key');
    }
    if (!STATUSES.has(row.status)) {
      fail(at, `has an unknown status ${JSON.stringify(row.status)}`);
    }
    if (row.value !== null && !Number.isFinite(row.value)) {
      fail(at, 'has a value that is not a finite number');
    }
    if (row.status === 'value' && row.value === null) {
      fail(at, "has status 'value' and no value");
    }
    if (row.status === 'missing' && (row.value !== null || row.comparator !== null)) {
      fail(at, "has status 'missing' and a value or comparator");
    }
    if (row.status === 'categorical' && (row.textValue === null || row.textValue.trim() === '')) {
      fail(at, "has status 'categorical' and no textValue");
    }
    assertRange(row.referenceRange, at);
  }
}

function assertRange(range: ReferenceRange | null, at: string): void {
  if (range === null) {
    return;
  }
  if (range.kind === 'closed') {
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      fail(at, 'has a reference range bound that is not a finite number');
    }
    if (range.min > range.max) {
      fail(at, 'has a reference range with min greater than max');
    }
    return;
  }

  const bound = range.kind === 'minOnly' ? range.min : range.max;
  if (!Number.isFinite(bound)) {
    fail(at, 'has a reference range bound that is not a finite number');
  }
}

function fail(at: string, message: string): never {
  throw new Error(`unscorable-row: ${at} ${message}`);
}

interface Pairing {
  matched: { expected: ParsedRow; actual: ParsedRow }[];
  /** Emitted rows that answered no expected marker: a false positive or a duplicate. */
  spurious: ParsedRow[];
}

/**
 * Pair the two tables one-to-one on marker key.
 *
 * One expected marker can be answered once. A second emitted row carrying the
 * same key is not a second answer but a duplicate, and it is scored exactly as
 * a marker the document never printed — which is what stops a parser from
 * hedging between two readings of one row and being paid for the one that
 * happens to be right.
 */
function pair(expected: readonly ParsedRow[], actual: readonly ParsedRow[]): Pairing {
  const queues = new Map<string, ParsedRow[]>();
  for (const row of actual) {
    queues.set(row.markerKey, [...(queues.get(row.markerKey) ?? []), row]);
  }

  const matched: { expected: ParsedRow; actual: ParsedRow }[] = [];
  const claimed = new Set<ParsedRow>();

  for (const row of expected) {
    const answer = queues.get(row.markerKey)?.shift();
    if (answer !== undefined) {
      matched.push({ expected: row, actual: answer });
      claimed.add(answer);
    }
  }

  return { matched, spurious: actual.filter((row) => !claimed.has(row)) };
}

/**
 * Whether the emitted result says what the document says.
 *
 * Status is part of the answer, not a wrapper around it: emitting `missing`
 * for a value the laboratory printed is wrong in exactly the way a wrong
 * number is wrong, and the metric says so. A categorical result compares on
 * its printed string, normalised — D15's equality rule — because that string
 * is the whole of what was measured.
 */
function sameResult(expected: ParsedRow, actual: ParsedRow): boolean {
  if (expected.status !== actual.status || expected.comparator !== actual.comparator) {
    return false;
  }

  if (expected.status === 'categorical') {
    return normaliseLabel(expected.textValue ?? '') === normaliseLabel(actual.textValue ?? '');
  }

  if (expected.value === null || actual.value === null) {
    return expected.value === actual.value;
  }

  return close(expected.value, actual.value);
}

/** Units compare folded, so `k/μl` and `x10^3 / μL` are the same unit. */
function sameUnit(expected: string, actual: string): boolean {
  return normaliseUnit(expected) === normaliseUnit(actual);
}

/** A range matches on kind, on printed strictness, and on every bound. */
function sameRange(expected: ReferenceRange, actual: ReferenceRange): boolean {
  if (expected.kind !== actual.kind) {
    return false;
  }
  if (expected.kind === 'closed' && actual.kind === 'closed') {
    return close(expected.min, actual.min) && close(expected.max, actual.max);
  }
  if (expected.kind === 'minOnly' && actual.kind === 'minOnly') {
    return expected.comparator === actual.comparator && close(expected.min, actual.min);
  }
  if (expected.kind === 'maxOnly' && actual.kind === 'maxOnly') {
    return expected.comparator === actual.comparator && close(expected.max, actual.max);
  }

  return false;
}

/**
 * Count one optional field by opportunity.
 *
 * A matched pair contributes when either side printed the field; a spurious
 * row contributes when it printed one, and can never be correct. A pair with
 * the field absent on both sides is no opportunity at all and is excluded, so
 * the denominator counts places the field could have been got wrong rather
 * than rows.
 */
function opportunities<T>(
  pairing: Pairing,
  read: (row: ParsedRow) => T | null,
  same: (expected: T, actual: T) => boolean,
): MetricCount {
  let correct = 0;
  let total = 0;

  for (const { expected, actual } of pairing.matched) {
    const want = read(expected);
    const got = read(actual);
    if (want === null && got === null) {
      continue;
    }
    total += 1;
    if (want !== null && got !== null && same(want, got)) {
      correct += 1;
    }
  }

  for (const row of pairing.spurious) {
    if (read(row) !== null) {
      total += 1;
    }
  }

  return { correct, total };
}

/**
 * Score one table of predictions against one table of expectations.
 *
 * Both are plain `ParsedRow` arrays, so the caller decides what a "corpus" is:
 * `scripts/corpus-score.ts` calls this once per issuing laboratory and once
 * over everything, which is the per-laboratory axis the parser gate reads. The
 * counts are returned as integers rather than ratios so a small laboratory
 * cannot hide behind a rounded percentage.
 *
 * Throws on a row it cannot compare, rather than scoring it as wrong: a
 * malformed table is a broken fixture or a broken caller, and reporting it as
 * a parser failure would send someone hunting in the wrong place.
 */
export function score(expected: readonly ParsedRow[], actual: readonly ParsedRow[]): CorpusScore {
  assertScorable(expected, 'expected');
  assertScorable(actual, 'actual');

  const pairing = pair(expected, actual);

  return {
    markerRecall: { correct: pairing.matched.length, total: expected.length },
    valuePrecision: {
      correct: pairing.matched.filter((each) => sameResult(each.expected, each.actual)).length,
      total: actual.length,
    },
    unitPrecision: opportunities(pairing, (row) => row.unit, sameUnit),
    rangePrecision: opportunities(pairing, (row) => row.referenceRange, sameRange),
  };
}
