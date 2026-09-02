import { describe, expect, it } from 'vitest';
import { parseNumber } from './numbers';

describe('parseNumber', () => {
  it.each([
    [['530'], { value: 530, comparator: null, ambiguousThousands: false }],
    [['0,10'], { value: 0.1, comparator: null, ambiguousThousands: false }],
    [['4,0'], { value: 4, comparator: null, ambiguousThousands: false }],
    [['10.5'], { value: 10.5, comparator: null, ambiguousThousands: false }],
    [['+5'], { value: 5, comparator: null, ambiguousThousands: false }],
    [['-5'], { value: -5, comparator: null, ambiguousThousands: false }],
  ])('reads the standalone number %j', (tokens, expected) => {
    expect(parseNumber(tokens)).toEqual(expected);
  });

  it.each([
    [['<', '0,10'], { value: 0.1, comparator: '<', ambiguousThousands: false }],
    [['<0,10'], { value: 0.1, comparator: '<', ambiguousThousands: false }],
    [['>', '20'], { value: 20, comparator: '>', ambiguousThousands: false }],
    [['>20'], { value: 20, comparator: '>', ambiguousThousands: false }],
    [['≤', '5'], { value: 5, comparator: '<=', ambiguousThousands: false }],
    [['≤5'], { value: 5, comparator: '<=', ambiguousThousands: false }],
    [['≥', '5'], { value: 5, comparator: '>=', ambiguousThousands: false }],
    [['≥5'], { value: 5, comparator: '>=', ambiguousThousands: false }],
  ])('normalises the comparator in %j', (tokens, expected) => {
    expect(parseNumber(tokens)).toEqual(expected);
  });

  it('reads a separated and a glued comparator identically', () => {
    expect(parseNumber(['<', '75'])).toEqual(parseNumber(['<75']));
  });

  it.each([
    [['250.000'], 250],
    [['250,000'], 250],
    [['1.250'], 1.25],
    [['4,480'], 4.48],
    [['12.345'], 12.345],
  ])('keeps the decimal reading of %j but flags the grouping as ambiguous', (tokens, value) => {
    // Never guess grouping: the value is retained for review and marked, which
    // is what forces low confidence rather than silently picking a magnitude.
    expect(parseNumber(tokens)).toEqual({ value, comparator: null, ambiguousThousands: true });
  });

  it('flags ambiguity through a comparator too', () => {
    expect(parseNumber(['<', '250.000'])).toEqual({
      value: 250,
      comparator: '<',
      ambiguousThousands: true,
    });
  });

  it.each([
    [['1.2500'], 1.25],
    [['1.25'], 1.25],
    [['1250.5'], 1250.5],
    [['12.3456'], 12.3456],
  ])('does not flag %j, which cannot be read as grouping', (tokens, value) => {
    expect(parseNumber(tokens)).toEqual({ value, comparator: null, ambiguousThousands: false });
  });

  it.each([
    [['0,270'], 0.27],
    [['0.270'], 0.27],
    [['-0,270'], -0.27],
    [['0,000'], 0],
  ])('does not flag %j, whose leading zero rules grouping out', (tokens, value) => {
    // Thousands grouping never emits a leading-zero group, so `0,270` has one
    // possible reading. Flagging it would report an ambiguity that is not
    // there and demote a correct row to low confidence.
    expect(parseNumber(tokens)).toEqual({ value, comparator: null, ambiguousThousands: false });
  });

  it('still flags the other bound of the same printed range', () => {
    // `0,270-4,480` is a real corpus range: the lower bound is unambiguous by
    // its leading zero, the upper bound is genuinely 4.48 or 4480.
    expect(parseNumber(['0,270'])?.ambiguousThousands).toBe(false);
    expect(parseNumber(['4,480'])?.ambiguousThousands).toBe(true);
  });

  it.each([
    [['Β12'], 'a marker fragment'],
    [['12mg'], 'a glued unit'],
    [['mg/dL'], 'a bare unit'],
    [['1.234,56'], 'two separators'],
    [['1,234.56'], 'two separators the other way round'],
    [['.5'], 'no integer part'],
    [['5.'], 'no fractional part'],
    [['-'], 'a lone dash'],
    [['<'], 'a comparator with nothing to compare'],
    [[], 'no tokens'],
    [[''], 'an empty token'],
  ])('rejects %j — %s', (tokens) => {
    expect(parseNumber(tokens)).toBeNull();
  });

  it.each([
    [['70', '110'], 'two numbers'],
    [['70', '-', '110'], 'a split range'],
    [['<', '<', '5'], 'a repeated comparator'],
    [['<', '75', 'mg/dL'], 'a trailing unit'],
    [['-', '5'], 'a separated sign, which a range separator is indistinguishable from'],
    [['5', 'mg/dL'], 'a number and a unit'],
  ])('rejects %j — %s', (tokens) => {
    // More than one numeric group is a range, and belongs to parseRange.
    expect(parseNumber(tokens)).toBeNull();
  });
});
