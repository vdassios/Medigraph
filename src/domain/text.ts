import type { LexicalToken, TextItem } from './types';

/**
 * Normalisation for marker identity. There is deliberately no one-size-fits-all
 * `normalise`: a label and an abbreviation tolerate different damage, and unit
 * folding belongs to `normaliseUnit` in `units.ts`. Homoglyph folding is never
 * applied to a whole marker phrase, because partial transliteration produces
 * case-asymmetric and cross-language collisions.
 */

const COMBINING_MARK = /\p{M}/gu;
const FINAL_SIGMA = /ς/gu;
const WHITESPACE_RUN = /\s+/gu;
const PARENTHESIS_SPACING = /\s*([()])\s*/gu;

/**
 * The only homoglyphs folded to Latin, and only inside an abbreviation. Every
 * other Greek letter is preserved, so `ΓΛΥΚΟΖΗ` keeps its gamma and lambda.
 */
const ABBREVIATION_CONFUSABLES = new Map([
  ['α', 'a'],
  ['β', 'b'],
  ['ε', 'e'],
  ['ζ', 'z'],
  ['η', 'h'],
  ['ι', 'i'],
  ['κ', 'k'],
  ['μ', 'm'],
  ['ν', 'n'],
  ['ο', 'o'],
  ['ρ', 'p'],
  ['τ', 't'],
  ['υ', 'y'],
  ['χ', 'x'],
]);

const CONFUSABLE = new RegExp(`[${[...ABBREVIATION_CONFUSABLES.keys()].join('')}]`, 'gu');

/**
 * NFKD, strip combining marks, lowercase, fold Greek final sigma, collapse
 * whitespace. Both alphabets are preserved — nothing is transliterated — so an
 * uppercase and a lowercase Greek alias normalise identically.
 *
 * Lowercasing before the sigma fold is required, not incidental: JavaScript
 * applies the Unicode Final_Sigma rule, so `ΟΥΡΙΑΣ` lowercases to a final `ς`
 * that only then folds to `σ`, matching the already-lowercase `ουρίας`.
 */
export function normaliseLabel(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARK, '')
    .toLowerCase()
    .replace(FINAL_SIGMA, 'σ')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/**
 * `normaliseLabel`, then remove spacing around parentheses and fold the listed
 * confusables. Abbreviations are where a lab writes `Lp (α)` for `Lp(a)`, so
 * both the spacing and the alphabet of those specific letters are noise.
 */
export function normaliseAbbreviation(value: string): string {
  return normaliseLabel(value)
    .replace(PARENTHESIS_SPACING, '$1')
    .replace(CONFUSABLE, (character) => ABBREVIATION_CONFUSABLES.get(character) ?? character);
}

/**
 * Split one `TextItem` into whitespace-delimited tokens, each carrying its
 * parent item id and its UTF-16 `[start, end)` offsets into `item.text`.
 *
 * A `LexicalToken` has no geometry and never gains any. pdf.js emits fragments
 * whose boxes are real; interpolating a glyph x-coordinate by character count
 * is unsafe under a proportional font, so only parent boxes take part in page
 * geometry. What a fragment still needs is lexical work — `6.0 Όξινη` is one
 * fragment holding a number and a word.
 *
 * Splitting is on whitespace alone. A glued comparator stays one token, which
 * is why the read-out rules speak of joining a *standalone* `<` and why
 * `parseNumber` accepts both `<75` and the separated `<`, `75`.
 */
export function tokenise(item: TextItem): LexicalToken[] {
  const tokens: LexicalToken[] = [];

  for (const match of item.text.matchAll(/\S+/gu)) {
    const text = match[0];
    tokens.push({
      text,
      parentItemId: item.id,
      start: match.index,
      end: match.index + text.length,
    });
  }

  return tokens;
}
