import { describe, expect, it } from 'vitest';
import { parseRange } from './ranges';

describe('parseRange', () => {
  it.each([
    [['70', '-', '110'], { kind: 'closed', min: 70, max: 110 }],
    [['70-110'], { kind: 'closed', min: 70, max: 110 }],
    [['0,270-4,480'], { kind: 'closed', min: 0.27, max: 4.48 }],
    [['4', '-', '10.5'], { kind: 'closed', min: 4, max: 10.5 }],
    [['4,0-11,0'], { kind: 'closed', min: 4, max: 11 }],
    [['70', '–', '110'], { kind: 'closed', min: 70, max: 110 }],
    [['70', '—', '110'], { kind: 'closed', min: 70, max: 110 }],
  ])('reads the two-sided range %j', (tokens, expected) => {
    expect(parseRange(tokens)).toEqual(expected);
  });

  it('assembles a split range and a glued one identically', () => {
    // The corpus prints `4 - 10.5`, `4,0 - 10,0` and `4,0-11,0` in the same
    // template, and pdf.js may fragment any of them.
    expect(parseRange(['70', '-', '110'])).toEqual(parseRange(['70-110']));
    expect(parseRange(['70-', '110'])).toEqual(parseRange(['70-110']));
    expect(parseRange(['70', '-110'])).toEqual(parseRange(['70-110']));
  });

  it.each([
    [['<', '75'], { kind: 'maxOnly', comparator: '<', max: 75 }],
    [['<75'], { kind: 'maxOnly', comparator: '<', max: 75 }],
    [['≤', '75'], { kind: 'maxOnly', comparator: '<=', max: 75 }],
    [['>', '20'], { kind: 'minOnly', comparator: '>', min: 20 }],
    [['>20'], { kind: 'minOnly', comparator: '>', min: 20 }],
    [['≥', '20'], { kind: 'minOnly', comparator: '>=', min: 20 }],
  ])('preserves the printed strictness of %j', (tokens, expected) => {
    expect(parseRange(tokens)).toEqual(expected);
  });

  it.each([
    [['Έως', '200']],
    [['έως', '200']],
    [['ΕΩΣ', '200']],
    [['μέχρι', '200']],
    [['Μέχρι', '200']],
  ])('reads the textual upper bound %j as inclusive', (tokens) => {
    // Textual "up to" carries no strictness marker, so it is <=. Only a
    // printed symbol says otherwise.
    expect(parseRange(tokens)).toEqual({ kind: 'maxOnly', comparator: '<=', max: 200 });
  });

  it.each([
    [['70'], 'a bare number is never a range'],
    [['0,270'], 'a bare decimal is never a range'],
    [[], 'no tokens'],
    [['-'], 'a lone separator'],
    [['<'], 'a comparator with no bound'],
    [['έως'], 'the textual form with no bound'],
    [['70', '-', 'abc'], 'an unparsable bound'],
    [['70', '-', '110', '-', '150'], 'three bounds'],
    [['Λευκά', 'Αιμοσφαίρια'], 'a label'],
  ])('rejects %j — %s', (tokens) => {
    expect(parseRange(tokens)).toBeNull();
  });

  it('rejects a closed range whose minimum exceeds its maximum', () => {
    // Rejected, not reordered: a reversed range means the read-out took two
    // numbers that do not belong together.
    expect(parseRange(['110', '-', '70'])).toBeNull();
  });

  it('accepts a closed range whose bounds are equal', () => {
    expect(parseRange(['70', '-', '70'])).toEqual({ kind: 'closed', min: 70, max: 70 });
  });

  it('rejects a bound that carries its own comparator', () => {
    expect(parseRange(['<5', '-', '10'])).toBeNull();
  });

  it('rejects a range with a unit inside it', () => {
    // The corpus prints `4,0 - 10,0 k/μl`. Stripping the unit is the read-out's
    // work in Task 2.2, which knows the unit allowlist; parseRange does not.
    expect(parseRange(['4,0', '-', '10,0', 'k/μl'])).toBeNull();
  });
});
