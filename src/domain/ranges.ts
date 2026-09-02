import { parseNumber } from './numbers';
import { normaliseLabel } from './text';
import type { ReferenceRange } from './types';

/**
 * Reference-range parsing. Every bound goes through `parseNumber`, so a range
 * inherits one decimal grammar rather than repeating it.
 */

/** Hyphen-minus, en dash and em dash all separate a two-sided range. */
const TWO_SIDED = /^(.+?)\s*[-–—]\s*(.+)$/u;

/** A printed comparator and its bound. Strictness is preserved exactly. */
const SYMBOLIC = /^([<>≤≥])\s*(.+)$/u;

/**
 * Greek "up to", written the way a laboratory prints it and normalised here so
 * the pattern cannot drift from `normaliseLabel`. Spelling the normalised form
 * by hand is a trap: the accent is stripped and the word-final sigma is folded,
 * so `Έως` arrives as `εωσ` (U+03C3), not the visually near-identical `εως`
 * (U+03C2) that the lowercase step produces one transformation earlier.
 */
const TEXTUAL_MAX_WORDS = ['Έως', 'μέχρι'].map(normaliseLabel);
const TEXTUAL_MAX = new RegExp(`^(?:${TEXTUAL_MAX_WORDS.join('|')})\\s+(.+)$`, 'u');

type SymbolicShape =
  { kind: 'maxOnly'; comparator: '<' | '<=' } | { kind: 'minOnly'; comparator: '>' | '>=' };

const SYMBOLIC_KINDS = new Map<string, SymbolicShape>([
  ['<', { kind: 'maxOnly', comparator: '<' }],
  ['≤', { kind: 'maxOnly', comparator: '<=' }],
  ['>', { kind: 'minOnly', comparator: '>' }],
  ['≥', { kind: 'minOnly', comparator: '>=' }],
]);

/**
 * Parse one candidate range. Tokens are joined before matching, so a range
 * split across fragments (`70`, `-`, `110`) and a glued one (`70-110`) read
 * identically.
 *
 * Returns `null` for anything that is not a range. A bare number is never a
 * range — a single measurement is not printed as an interval — and a closed
 * range whose minimum exceeds its maximum is rejected rather than reordered.
 */
export function parseRange(tokens: readonly string[]): ReferenceRange | null {
  const text = normaliseLabel(tokens.join(' '));

  const textual = TEXTUAL_MAX.exec(text);
  if (textual !== null) {
    const max = bound(textual[1]);
    // Textual "up to" is inclusive; only a printed symbol carries strictness.
    return max === null ? null : { kind: 'maxOnly', comparator: '<=', max };
  }

  const symbolic = SYMBOLIC.exec(text);
  if (symbolic !== null) {
    const shape = SYMBOLIC_KINDS.get(symbolic[1] ?? '');
    const value = bound(symbolic[2]);
    if (shape === undefined || value === null) {
      return null;
    }
    return shape.kind === 'maxOnly'
      ? { kind: 'maxOnly', comparator: shape.comparator, max: value }
      : { kind: 'minOnly', comparator: shape.comparator, min: value };
  }

  const twoSided = TWO_SIDED.exec(text);
  if (twoSided !== null) {
    const min = bound(twoSided[1]);
    const max = bound(twoSided[2]);
    if (min === null || max === null || min > max) {
      return null;
    }
    return { kind: 'closed', min, max };
  }

  return null;
}

/** A range bound is a plain number: a comparator inside one is not a bound. */
function bound(text: string | undefined): number | null {
  if (text === undefined) {
    return null;
  }

  const parsed = parseNumber(text.split(' '));
  return parsed?.comparator === null ? parsed.value : null;
}
