import { describe, expect, it } from 'vitest';
import { score } from './scorer';
import type { ParsedRow } from './types';

/** One scorable row. Only the fields the scorer reads are ever varied. */
function row(markerKey: string, overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    id: `row-${markerKey}`,
    label: markerKey,
    markerKey,
    status: 'value',
    value: 1,
    comparator: null,
    textValue: null,
    unit: null,
    referenceRange: null,
    categoricalReference: null,
    confidence: 'high',
    source: 'anchor',
    section: null,
    flags: [],
    sourceOrder: 0,
    ...overrides,
  };
}

const MISSING: Partial<ParsedRow> = { status: 'missing', value: null, comparator: null };

describe('score', () => {
  describe('marker recall', () => {
    it('counts an expected marker once, whether or not its value is right', () => {
      // Recall answers "did the parser find the row", and nothing else. A
      // found marker with a wrong number is a precision failure, not a recall
      // one, and conflating them would hide which half is broken.
      const found = score([row('wbc'), row('rbc')], [row('wbc'), row('rbc', { value: 99 })]);

      expect(found.markerRecall).toEqual({ correct: 2, total: 2 });
    });

    it('counts a marker the parser never emitted as missed', () => {
      expect(score([row('wbc'), row('rbc')], [row('wbc')]).markerRecall).toEqual({
        correct: 1,
        total: 2,
      });
    });

    it('takes its denominator from the expectations, not the predictions', () => {
      // Emitting more rows can never raise recall.
      expect(score([row('wbc')], [row('wbc'), row('rbc'), row('plt')]).markerRecall).toEqual({
        correct: 1,
        total: 1,
      });
    });

    it('scores two empty tables as a vacuous pass', () => {
      expect(score([], [])).toEqual({
        markerRecall: { correct: 0, total: 0 },
        valuePrecision: { correct: 0, total: 0 },
        unitPrecision: { correct: 0, total: 0 },
        rangePrecision: { correct: 0, total: 0 },
      });
    });
  });

  describe('value precision', () => {
    it('counts every emitted row, and a false positive is wrong', () => {
      const found = score([row('wbc')], [row('wbc'), row('ferritin')]);

      expect(found.valuePrecision).toEqual({ correct: 1, total: 2 });
    });

    it('answers one expected marker once, so a duplicate is wrong', () => {
      // Both emitted rows say the same true thing. Paying for both would let a
      // parser hedge between two readings of one printed row.
      const found = score([row('wbc')], [row('wbc'), row('wbc')]);

      expect(found.valuePrecision).toEqual({ correct: 1, total: 2 });
      expect(found.markerRecall).toEqual({ correct: 1, total: 1 });
    });

    it('requires the comparator as well as the number', () => {
      const found = score(
        [row('crp', { value: 1.03, comparator: '<' })],
        [row('crp', { value: 1.03 })],
      );

      expect(found.valuePrecision).toEqual({ correct: 0, total: 1 });
    });

    it('counts a missing row emitted for a printed value as wrong', () => {
      expect(score([row('wbc', { value: 5.03 })], [row('wbc', MISSING)]).valuePrecision).toEqual({
        correct: 0,
        total: 1,
      });
    });

    it('counts a value invented for a blank cell as wrong', () => {
      expect(score([row('wbc', MISSING)], [row('wbc', { value: 5.03 })]).valuePrecision).toEqual({
        correct: 0,
        total: 1,
      });
    });

    it('matches a missing row only on null value and null comparator', () => {
      expect(score([row('wbc', MISSING)], [row('wbc', MISSING)]).valuePrecision).toEqual({
        correct: 1,
        total: 1,
      });
    });

    it('compares a categorical result on its printed string (D15)', () => {
      const expected = [
        row('urine-glucose', { status: 'categorical', value: null, textValue: 'Αρνητικό' }),
      ];

      expect(
        score(expected, [
          row('urine-glucose', { status: 'categorical', value: null, textValue: 'Αρνητικό' }),
        ]).valuePrecision,
      ).toEqual({ correct: 1, total: 1 });

      expect(
        score(expected, [
          row('urine-glucose', { status: 'categorical', value: null, textValue: 'Θετικό' }),
        ]).valuePrecision,
      ).toEqual({ correct: 0, total: 1 });
    });

    it('ignores accent and case differences in a categorical result', () => {
      const found = score(
        [row('urine-colour', { status: 'categorical', value: null, textValue: 'Ωχροκίτρινη' })],
        [row('urine-colour', { status: 'categorical', value: null, textValue: 'ΩΧΡΟΚΙΤΡΙΝΗ' })],
      );

      expect(found.valuePrecision).toEqual({ correct: 1, total: 1 });
    });
  });

  describe('numeric tolerance', () => {
    it.each([
      ['inside the relative bound', 250, 250.0002, 1],
      ['on the relative bound exactly', 250, 250 + 250 * 1e-6, 1],
      ['outside the relative bound', 250, 250.001, 0],
    ])('scores a value %s', (_name, expectedValue, actualValue, correct) => {
      expect(
        score([row('wbc', { value: expectedValue })], [row('wbc', { value: actualValue })])
          .valuePrecision.correct,
      ).toBe(correct);
    });

    it('compares against zero using the absolute floor', () => {
      // A relative tolerance alone can never compare against zero, and the
      // sedimentation rate is printed as 0.
      expect(
        score([row('esr', { value: 0 })], [row('esr', { value: 1e-10 })]).valuePrecision.correct,
      ).toBe(1);
      expect(
        score([row('esr', { value: 0 })], [row('esr', { value: 1e-8 })]).valuePrecision.correct,
      ).toBe(0);
    });
  });

  describe('unit precision', () => {
    it('counts an opportunity when either side printed a unit', () => {
      const found = score([row('wbc', { unit: 'k/μl' })], [row('wbc', { unit: 'x10^3 / μL' })]);

      // Both spellings fold to one canonical unit, so this is one correct
      // opportunity rather than a mismatch the corpus has to keep explaining.
      expect(found.unitPrecision).toEqual({ correct: 1, total: 1 });
    });

    it('excludes a pair that printed no unit on either side', () => {
      // A corpus of unitless urine rows must not inflate unit precision.
      expect(score([row('urine-colour')], [row('urine-colour')]).unitPrecision).toEqual({
        correct: 0,
        total: 0,
      });
    });

    it('counts an omitted unit as wrong', () => {
      expect(score([row('wbc', { unit: 'k/μl' })], [row('wbc')]).unitPrecision).toEqual({
        correct: 0,
        total: 1,
      });
    });

    it('counts an invented unit as wrong', () => {
      expect(score([row('wbc')], [row('wbc', { unit: 'k/μl' })]).unitPrecision).toEqual({
        correct: 0,
        total: 1,
      });
    });

    it('counts a unit on a spurious row as an opportunity it cannot win', () => {
      expect(score([], [row('ferritin', { unit: 'ng/mL' })]).unitPrecision).toEqual({
        correct: 0,
        total: 1,
      });
    });

    it('ignores a unit on an expected marker the parser never emitted', () => {
      // The miss is already counted, once, against recall. Counting it again
      // here would charge one failure to two metrics.
      expect(score([row('wbc', { unit: 'k/μl' })], []).unitPrecision).toEqual({
        correct: 0,
        total: 0,
      });
    });
  });

  describe('range precision', () => {
    const closed = { kind: 'closed', min: 4, max: 10.5 } as const;

    it('counts a matching interval as correct', () => {
      expect(
        score(
          [row('wbc', { referenceRange: closed })],
          [row('wbc', { referenceRange: { kind: 'closed', min: 4, max: 10.5 } })],
        ).rangePrecision,
      ).toEqual({ correct: 1, total: 1 });
    });

    it('requires the same kind', () => {
      expect(
        score(
          [row('wbc', { referenceRange: closed })],
          [row('wbc', { referenceRange: { kind: 'maxOnly', comparator: '<', max: 10.5 } })],
        ).rangePrecision,
      ).toEqual({ correct: 0, total: 1 });
    });

    it('requires the printed strictness of a one-sided bound', () => {
      expect(
        score(
          [row('crp', { referenceRange: { kind: 'maxOnly', comparator: '<', max: 5 } })],
          [row('crp', { referenceRange: { kind: 'maxOnly', comparator: '<=', max: 5 } })],
        ).rangePrecision,
      ).toEqual({ correct: 0, total: 1 });
    });

    it('compares every bound within tolerance', () => {
      expect(
        score(
          [row('wbc', { referenceRange: closed })],
          [row('wbc', { referenceRange: { kind: 'closed', min: 4, max: 10.6 } })],
        ).rangePrecision,
      ).toEqual({ correct: 0, total: 1 });
    });

    it('counts an omitted and an invented interval alike', () => {
      expect(score([row('wbc', { referenceRange: closed })], [row('wbc')]).rangePrecision).toEqual({
        correct: 0,
        total: 1,
      });
      expect(score([row('wbc')], [row('wbc', { referenceRange: closed })]).rangePrecision).toEqual({
        correct: 0,
        total: 1,
      });
    });

    it('scores a range retained beside a missing value normally', () => {
      const found = score(
        [row('reticulocytes', { ...MISSING, referenceRange: closed })],
        [row('reticulocytes', { ...MISSING, referenceRange: closed })],
      );

      expect(found.valuePrecision).toEqual({ correct: 1, total: 1 });
      expect(found.rangePrecision).toEqual({ correct: 1, total: 1 });
    });
  });

  describe('the rows it refuses to score', () => {
    it.each([
      ['no marker key', row('wbc', { markerKey: '' })],
      ['an unknown status', row('wbc', { status: 'guessed' as ParsedRow['status'] })],
      ['a non-finite value', row('wbc', { value: Number.NaN })],
      ["status 'value' and no value", row('wbc', { status: 'value', value: null })],
      ["status 'missing' with a value", row('wbc', { status: 'missing', value: 5 })],
      ["status 'categorical' and no text", row('wbc', { status: 'categorical', value: null })],
      ['an inverted interval', row('wbc', { referenceRange: { kind: 'closed', min: 9, max: 1 } })],
    ])('refuses a row with %s', (_name, bad) => {
      // A malformed table is a broken fixture or a broken caller. Scoring it
      // as a parser failure would send someone hunting in the wrong place.
      expect(() => score([bad], [])).toThrow(/unscorable-row: expected\[0\]/u);
      expect(() => score([], [bad])).toThrow(/unscorable-row: actual\[0\]/u);
    });
  });

  describe('a whole table', () => {
    it('reports the four metrics independently', () => {
      // One marker missed, one invented, one right, one whose unit was
      // omitted, and one whose interval was invented.
      const expected = [
        row('wbc', {
          value: 5.03,
          unit: 'k/μl',
          referenceRange: { kind: 'closed', min: 4, max: 10.5 },
        }),
        row('rbc', { value: 5.29, unit: 'M/μl' }),
        row('plt', { value: 329, unit: 'k/μl' }),
      ];
      const actual = [
        row('wbc', {
          value: 5.03,
          unit: 'x10^3 / μL',
          referenceRange: { kind: 'closed', min: 4, max: 10.5 },
        }),
        row('rbc', { value: 5.29 }),
        row('ferritin', { value: 45.5, referenceRange: { kind: 'closed', min: 30, max: 400 } }),
      ];

      expect(score(expected, actual)).toEqual({
        markerRecall: { correct: 2, total: 3 },
        valuePrecision: { correct: 2, total: 3 },
        unitPrecision: { correct: 1, total: 2 },
        rangePrecision: { correct: 1, total: 2 },
      });
    });
  });
});
