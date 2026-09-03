/**
 * Unit normalisation, the allowlist and the enumerated conversion table.
 *
 * A unit is case-bearing in a way a label is not — `M/µL` is a million and
 * `m/µL` would be a milli — so this module never reuses `normaliseLabel`, and
 * folding is positional rather than wholesale. Matching is exact string
 * equality after the fold; a case-insensitive comparison would merge those two
 * units and misreport a haematology count by a factor of a thousand.
 */

/**
 * Canonical micro sign: U+00B5 MICRO SIGN, never U+03BC GREEK SMALL LETTER MU.
 *
 * Every Greek codepoint in this file is written as an escape. `µ` and `μ`, `Μ`
 * and `M`, `Κ` and `K` are indistinguishable in a diff and in most editors, and
 * confusing a pair of them is the exact failure this module exists to prevent —
 * so the reviewer is never asked to tell them apart by eye.
 *
 * It is also why `String.prototype.normalize` is never called here: NFKC folds
 * U+00B5 to U+03BC, the opposite of the direction this module needs.
 */
const MICRO = '\u00B5';

const WHITESPACE = /\s+/gu;

/** Both mu spellings a laboratory prints, folded to the canonical one. */
const MU_VARIANTS = /[\u00B5\u03BC]/gu;

/**
 * Count prefixes, folded only immediately before `/`. Position is the whole
 * safety argument: it is the one place where producing an uppercase letter
 * cannot change a unit's meaning.
 *
 * Lowercase mu is deliberately absent from both patterns. `μ/L` is
 * micro-per-litre or it is nothing; it is never guessed to mean million.
 */
const CAPITAL_MU_PREFIX = /\u039C(?=\/)/gu;
const KAPPA_PREFIX = /[\u039A\u03BAk](?=\/)/gu;

/**
 * The litre, uppercased. Positional so that it reaches the final letter of
 * `u/l`, `mmol/l`, `fl` and `g/dl` without touching the `l` inside `mmol` or
 * the leading `m` of `mg/dL`. A trailing `l` that is not a litre is uppercased
 * too; such a unit is outside the allowlist either way.
 */
const TRAILING_LITRE = /l$/u;

/**
 * The spellings the fold cannot produce. Everything reachable by the fold
 * rules — every case and script variant of the units below — is absent by
 * design, so this table stays short enough to audit.
 */
const PRINTED_FORMS = new Map([
  ['u/L', 'U/L'],
  [`${MICRO}IU/mL`, 'mIU/L'],
  [`K/${MICRO}L`, `10^3/${MICRO}L`],
  [`M/${MICRO}L`, `10^6/${MICRO}L`],
  [`x10^3/${MICRO}L`, `10^3/${MICRO}L`],
  [`x10^6/${MICRO}L`, `10^6/${MICRO}L`],
  // Kilo-per-millilitre is not what the analyser measured. One laboratory
  // prints `k/ml` for the quantity two others print as `k/μl` and `x10^3 / μL`,
  // and an unrecognised unit here costs the reference range too: the read-out
  // only strips a *recognised* trailing unit before `parseRange`.
  ['K/mL', `10^3/${MICRO}L`],
]);

/** The canonical units, and nothing else. Grows only from corpus evidence. */
const ALLOWLIST = new Set([
  'U/L',
  'mmol/L',
  'mg/dL',
  `${MICRO}mol/L`,
  'g/dL',
  'g/L',
  `${MICRO}g/dL`,
  `${MICRO}g/L`,
  'ng/mL',
  'ng/L',
  'pg/mL',
  'nmol/L',
  'mIU/L',
  `10^3/${MICRO}L`,
  `10^6/${MICRO}L`,
  'fL',
  '%',
]);

interface Conversion {
  from: string;
  to: string;
  factor: number;
}

/**
 * The only conversions that exist. Keyed by marker because the factor is a
 * property of the substance, not of the units: `mg/dL → mmol/L` is a different
 * number for glucose, cholesterol and triglycerides.
 */
const CONVERSIONS = new Map<string, Conversion>([
  ['glucose', { from: 'mg/dL', to: 'mmol/L', factor: 0.05551 }],
  ['cholesterol', { from: 'mg/dL', to: 'mmol/L', factor: 0.02586 }],
  ['hdl', { from: 'mg/dL', to: 'mmol/L', factor: 0.02586 }],
  ['ldl', { from: 'mg/dL', to: 'mmol/L', factor: 0.02586 }],
  ['triglycerides', { from: 'mg/dL', to: 'mmol/L', factor: 0.01129 }],
  ['creatinine', { from: 'mg/dL', to: `${MICRO}mol/L`, factor: 88.4 }],
  ['uric-acid', { from: 'mg/dL', to: `${MICRO}mol/L`, factor: 59.48 }],
  ['haemoglobin', { from: 'g/dL', to: 'g/L', factor: 10 }],
  ['mchc', { from: 'g/dL', to: 'g/L', factor: 10 }],
  ['ferritin', { from: 'ng/mL', to: `${MICRO}g/L`, factor: 1 }],
  ['vitamin-b12', { from: 'pg/mL', to: 'ng/L', factor: 1 }],
  ['folate', { from: 'ng/mL', to: 'nmol/L', factor: 2.266 }],
  ['vitamin-d', { from: 'ng/mL', to: 'nmol/L', factor: 2.496 }],
]);

/**
 * Fold one printed unit to its canonical spelling.
 *
 * Always returns trimmed normalised text, including for a unit outside the
 * allowlist: review must keep seeing what the laboratory printed, so an
 * unrecognised unit is folded and returned rather than emptied or rejected.
 * Deciding what to do about it belongs to the caller, which flags it
 * `unrecognised-unit` and demotes the row.
 */
export function normaliseUnit(value: string): string {
  const folded = value
    .trim()
    .replace(WHITESPACE, '')
    .replace(MU_VARIANTS, MICRO)
    .replace(CAPITAL_MU_PREFIX, 'M')
    .replace(KAPPA_PREFIX, 'K')
    .replace(TRAILING_LITRE, 'L');

  return PRINTED_FORMS.get(folded) ?? folded;
}

/** Whether the printed unit folds to a canonical unit this product knows. */
export function isKnownUnit(value: string): boolean {
  return ALLOWLIST.has(normaliseUnit(value));
}

/**
 * Convert between the two units enumerated for one marker, in either
 * direction. Every other combination returns `null` and the caller must not
 * convert — including `from === to`, which needs no conversion at all.
 *
 * `from` and `to` are taken already normalised; this function never folds, so
 * a caller passes `normaliseUnit`'s output. Keeping the fold out of here means
 * there is exactly one place where a printed unit becomes a canonical one.
 */
export function convert(value: number, from: string, to: string, markerKey: string): number | null {
  const conversion = CONVERSIONS.get(markerKey);
  if (conversion === undefined) {
    return null;
  }

  if (from === conversion.from && to === conversion.to) {
    return value * conversion.factor;
  }

  if (from === conversion.to && to === conversion.from) {
    return value / conversion.factor;
  }

  return null;
}
