import { describe, expect, it } from 'vitest';
import { convert, isKnownUnit, normaliseUnit } from './units';

/**
 * Every Greek and micro codepoint in this file is written as an escape, for the
 * reason `units.ts` gives: a test asserting that `Μ/μl` and `M/µL` fold alike
 * proves nothing if the reader cannot tell which script each character is in.
 */
const MICRO = '\u00B5'; // MICRO SIGN
const MU = '\u03BC'; // GREEK SMALL LETTER MU
const CAPITAL_MU = '\u039C'; // GREEK CAPITAL LETTER MU
const KAPPA = '\u039A'; // GREEK CAPITAL LETTER KAPPA

const THOUSAND_PER_MICROLITRE = `10^3/${MICRO}L`;
const MILLION_PER_MICROLITRE = `10^6/${MICRO}L`;

/** The twenty-two canonical units, as the allowlist enumerates them. */
const ALLOWLIST = [
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
  THOUSAND_PER_MICROLITRE,
  MILLION_PER_MICROLITRE,
  'fL',
  '%',
  'pg',
  'mg/L',
  'mm',
  'IU/mL',
  'ng/dL',
];

describe('normaliseUnit', () => {
  it.each([
    ['u/l', 'U/L'],
    [`${MU}g/dl`, `${MICRO}g/dL`],
    ['ng/ml', 'ng/mL'],
    ['pg/ml', 'pg/mL'],
    [`${MU}IU/ml`, 'mIU/L'],
    [`K/${MICRO}l`, THOUSAND_PER_MICROLITRE],
    [`M/${MICRO}l`, MILLION_PER_MICROLITRE],
    ['fl', 'fL'],
    ['g/dl', 'g/dL'],
    ['mmol/l', 'mmol/L'],
    ['gr/dL', 'g/dL'],
    ['gr/dl', 'g/dL'],
    ['IU/ml', 'IU/mL'],
    ['ng/dl', 'ng/dL'],
    ['mg/l', 'mg/L'],
  ])('applies the documented mapping %j', (printed, expected) => {
    expect(normaliseUnit(printed)).toBe(expected);
  });

  it.each([
    [`x10^3 / ${MU}L`, 'spaced multiplication form'],
    [`k/${MU}l`, 'Latin k, Greek mu'],
    [`k/${MU}L`, 'Latin k, Greek mu, capital litre'],
    [`${KAPPA}/${MU}l`, 'Greek kappa'],
    ['k/ml', 'the millilitre spelling one laboratory prints'],
    [`x10^3/${MICRO}L`, 'unspaced multiplication form'],
  ])('folds %j to the thousands count — %s', (printed) => {
    expect(normaliseUnit(printed)).toBe(THOUSAND_PER_MICROLITRE);
  });

  it('folds the mixed-script million the corpus prints', () => {
    // Greek capital mu + Greek small mu + Latin l, confirmed by codepoint in
    // the plan's corpus survey.
    expect(normaliseUnit(`${CAPITAL_MU}/${MU}l`)).toBe(MILLION_PER_MICROLITRE);
  });

  it.each([
    ['mg/dl', 'mg/dL'],
    [`${MU}mol/l`, `${MICRO}mol/L`],
    ['g/l', 'g/L'],
    [`${MU}g/l`, `${MICRO}g/L`],
    ['ng/l', 'ng/L'],
    ['nmol/l', 'nmol/L'],
  ])('reaches the litre in %j without a case-insensitive match', (printed, expected) => {
    expect(normaliseUnit(printed)).toBe(expected);
  });

  it('canonicalises both mu spellings to the micro sign', () => {
    expect(normaliseUnit(`${MU}g/dL`)).toBe(`${MICRO}g/dL`);
    expect(normaliseUnit(`${MICRO}g/dL`)).toBe(`${MICRO}g/dL`);
    expect(normaliseUnit(`${MU}g/dL`).codePointAt(0)).toBe(0x00b5);
  });

  it('never reads a lowercase mu as a million', () => {
    // The whole point of folding count prefixes positionally: `μ/l` is
    // micro-per-litre or it is nothing.
    expect(normaliseUnit(`${MU}/l`)).toBe(`${MICRO}/L`);
    expect(isKnownUnit(`${MU}/l`)).toBe(false);
  });

  it('keeps milli and million apart', () => {
    // A blanket case fold would merge these and misreport by a thousandfold.
    expect(normaliseUnit(`m/${MICRO}L`)).not.toBe(normaliseUnit(`M/${MICRO}L`));
    expect(normaliseUnit(`M/${MICRO}L`)).toBe(MILLION_PER_MICROLITRE);
    expect(isKnownUnit(`m/${MICRO}L`)).toBe(false);
  });

  it.each([
    ['  fl  ', 'fL', 'surrounding whitespace'],
    [`x10^3  /  ${MU}L`, THOUSAND_PER_MICROLITRE, 'internal whitespace'],
    ['', '', 'the empty string'],
    ['   ', '', 'whitespace only'],
  ])('trims %j to %j — %s', (printed, expected) => {
    expect(normaliseUnit(printed)).toBe(expected);
  });

  it.each([['mm/h'], ['mEq/L'], ['ratio'], ['\u03BA\u03AC\u03C4\u03B9']])(
    'retains the unknown unit %j as normalised text',
    (printed) => {
      // Review must keep seeing what the laboratory printed, so an unknown is
      // folded and returned — never emptied, never rejected.
      expect(normaliseUnit(printed)).not.toBe('');
      expect(isKnownUnit(printed)).toBe(false);
    },
  );

  it.each(ALLOWLIST)('is idempotent on the canonical unit %j', (canonical) => {
    expect(normaliseUnit(canonical)).toBe(canonical);
    expect(normaliseUnit(normaliseUnit(canonical))).toBe(canonical);
  });
});

describe('isKnownUnit', () => {
  it.each(ALLOWLIST)('accepts the canonical unit %j', (canonical) => {
    expect(isKnownUnit(canonical)).toBe(true);
  });

  it('accepts the percent sign the differential rows print', () => {
    // Without it, `40,0 - 75,0 %` cannot be stripped and the range is lost.
    expect(isKnownUnit('%')).toBe(true);
  });

  it.each([['mm/h'], ['mEq/L'], ['mol'], ['k/l'], [''], ['/'], ['mg']])(
    'rejects %j, which the allowlist does not carry',
    (printed) => {
      expect(isKnownUnit(printed)).toBe(false);
    },
  );
});

describe('convert', () => {
  const cases: [string, string, string, number][] = [
    ['glucose', 'mg/dL', 'mmol/L', 0.05551],
    ['cholesterol', 'mg/dL', 'mmol/L', 0.02586],
    ['hdl', 'mg/dL', 'mmol/L', 0.02586],
    ['ldl', 'mg/dL', 'mmol/L', 0.02586],
    ['triglycerides', 'mg/dL', 'mmol/L', 0.01129],
    ['creatinine', 'mg/dL', `${MICRO}mol/L`, 88.4],
    ['uric-acid', 'mg/dL', `${MICRO}mol/L`, 59.48],
    ['haemoglobin', 'g/dL', 'g/L', 10],
    ['mchc', 'g/dL', 'g/L', 10],
    ['ferritin', 'ng/mL', `${MICRO}g/L`, 1],
    ['vitamin-b12', 'pg/mL', 'ng/L', 1],
    ['folate', 'ng/mL', 'nmol/L', 2.266],
    ['vitamin-d', 'ng/mL', 'nmol/L', 2.496],
  ];

  it.each(cases)('converts %s from %s to %s', (markerKey, from, to, factor) => {
    expect(convert(100, from, to, markerKey)).toBeCloseTo(100 * factor, 10);
  });

  it.each(cases)('inverts %s from %s to %s', (markerKey, from, to, factor) => {
    expect(convert(100, to, from, markerKey)).toBeCloseTo(100 / factor, 10);
  });

  it('round-trips a value through both directions', () => {
    const forward = convert(95, 'mg/dL', 'mmol/L', 'glucose');
    expect(forward).not.toBeNull();
    expect(convert(forward ?? 0, 'mmol/L', 'mg/dL', 'glucose')).toBeCloseTo(95, 10);
  });

  it('reads the worked corpus values', () => {
    expect(convert(95, 'mg/dL', 'mmol/L', 'glucose')).toBeCloseTo(5.27345, 5);
    expect(convert(30, 'ng/mL', `${MICRO}g/L`, 'ferritin')).toBe(30);
  });

  it.each([
    ['glucose', 'mg/dL', `${MICRO}mol/L`, 'a target off this marker\u2019s row'],
    ['glucose', 'mg/dL', 'mg/dL', 'identical units, which need no conversion'],
    ['ferritin', 'ng/mL', 'nmol/L', 'a target belonging to another marker'],
    ['haemoglobin', 'g/L', 'mmol/L', 'a source belonging to another marker'],
    ['ldl', 'mg/dl', 'mmol/L', 'an unnormalised source unit'],
    ['ldl', 'mg/dL', 'mmol/l', 'an unnormalised target unit'],
    ['x:something', 'mg/dL', 'mmol/L', 'an unknown marker'],
    ['sodium', 'mmol/L', 'mEq/L', 'a marker with no enumerated conversion'],
    ['', 'mg/dL', 'mmol/L', 'no marker at all'],
  ])('returns null for %s %s to %s — %s', (markerKey, from, to) => {
    expect(convert(100, from, to, markerKey)).toBeNull();
  });

  it('never folds its arguments', () => {
    // The seam is deliberate: exactly one place turns a printed unit into a
    // canonical one, and it is normaliseUnit.
    expect(convert(100, 'mg/dl', 'mmol/L', 'glucose')).toBeNull();
    expect(convert(100, normaliseUnit('mg/dl'), normaliseUnit('mmol/l'), 'glucose')).toBeCloseTo(
      5.551,
      10,
    );
  });

  it('preserves the sign and passes zero through', () => {
    expect(convert(0, 'mg/dL', 'mmol/L', 'glucose')).toBe(0);
    expect(convert(-1, 'g/dL', 'g/L', 'haemoglobin')).toBe(-10);
  });
});
