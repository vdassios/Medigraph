import type { Comparator, ParsedNumber } from './types';

/**
 * The one numeric parser. Every value and every range bound goes through it, so
 * the decimal and comparator rules are stated once.
 */

/**
 * A signed integer or decimal with a single comma or dot separator. Anything
 * carrying a letter, a second separator or a bare sign is not a number: a
 * grouped `1.234,56`, a marker fragment like `Β12` and a glued unit like
 * `12mg` all fail here rather than being guessed at.
 */
const NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/u;

/**
 * A leading group of one to three digits, a separator, then exactly three
 * digits. `250.000` is either 250 or 250000 and the document does not say
 * which — the same lab writes both period and comma decimals. The parser never
 * guesses grouping: it keeps the decimal reading and marks the result, which
 * demotes the row to low confidence and adds `ambiguous-thousands` downstream.
 *
 * The leading digit may not be zero. Thousands grouping never emits a
 * leading-zero group, so `0,270` has only one possible reading and flagging it
 * would report an ambiguity that does not exist. This narrows the rule to the
 * genuinely two-way cases; it does not choose between two readings.
 */
const AMBIGUOUS_THOUSANDS = /^[+-]?[1-9]\d{0,2}[.,]\d{3}$/u;

/** The printed comparators, normalised to the `Comparator` contract. */
const COMPARATORS = new Map<string, Comparator>([
  ['<', '<'],
  ['>', '>'],
  ['≤', '<='],
  ['≥', '>='],
]);

/**
 * Parse one numeric group: a number, optionally carrying a comparator either
 * glued to it (`<75`) or as its own preceding token (`<`, `75`).
 *
 * Returns `null` for anything else — no number, a comparator with nothing to
 * compare, two numbers, or a token that is not purely numeric. A second number
 * means the caller handed over a range, which is `parseRange`'s work.
 */
export function parseNumber(tokens: readonly string[]): ParsedNumber | null {
  const [first, second, ...rest] = tokens;
  if (first === undefined || rest.length > 0) {
    return null;
  }

  if (second === undefined) {
    const glued = COMPARATORS.get(first.slice(0, 1));
    return glued === undefined ? numeric(first, null) : numeric(first.slice(1), glued);
  }

  const comparator = COMPARATORS.get(first);
  return comparator === undefined ? null : numeric(second, comparator);
}

function numeric(text: string, comparator: Comparator | null): ParsedNumber | null {
  if (!NUMBER.test(text)) {
    return null;
  }

  return {
    value: Number(text.replace(',', '.')),
    comparator,
    ambiguousThousands: AMBIGUOUS_THOUSANDS.test(text),
  };
}
