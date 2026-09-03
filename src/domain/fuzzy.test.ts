import { describe, expect, it } from 'vitest';
import { damerauLevenshtein } from './fuzzy';

/** A bound wide enough that the function reports the true distance. */
const UNBOUNDED = 99;

describe('damerauLevenshtein', () => {
  it.each([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['χοληστερολη', 'χοληστερολη', 0],
  ])('scores %j against %j as %i', (a, b, expected) => {
    expect(damerauLevenshtein(a, b, UNBOUNDED)).toBe(expected);
  });

  it.each([
    ['abc', 'abcd', 1, 'insertion at the end'],
    ['abc', 'xabc', 1, 'insertion at the start'],
    ['abc', 'ab', 1, 'deletion at the end'],
    ['abc', 'bc', 1, 'deletion at the start'],
    ['abc', 'abd', 1, 'substitution'],
    ['abc', 'acb', 1, 'transposition of adjacent characters'],
    ['ferritin', 'feritin', 1, 'a dropped double letter'],
    ['χοληστερολη', 'χοληστεροη', 1, 'a dropped Greek letter'],
    ['ουρια', 'ουρεα', 1, 'one Greek substitution'],
  ])('scores %j against %j as %i — %s', (a, b, expected) => {
    expect(damerauLevenshtein(a, b, UNBOUNDED)).toBe(expected);
  });

  it.each([
    ['abcd', 'badc', 2, 'two separate transpositions'],
    ['abc', 'axcy', 2, 'a substitution and an insertion'],
    ['kitten', 'sitting', 3, 'the textbook example'],
    ['abc', '', 3, 'deleting everything'],
    ['', 'abc', 3, 'inserting everything'],
  ])('scores %j against %j as %i — %s', (a, b, expected) => {
    expect(damerauLevenshtein(a, b, UNBOUNDED)).toBe(expected);
  });

  it('counts an adjacent transposition once, not twice', () => {
    // Without transposition support this would be 2 substitutions.
    expect(damerauLevenshtein('ab', 'ba', UNBOUNDED)).toBe(1);
    expect(damerauLevenshtein('mvp', 'mpv', UNBOUNDED)).toBe(1);
  });

  it('is the restricted variant: a transposed substring is not edited again', () => {
    // Optimal string alignment scores this 3; the unrestricted algorithm scores
    // 2. The restriction can only reject a marginal match, never invent one.
    expect(damerauLevenshtein('ca', 'abc', UNBOUNDED)).toBe(3);
  });

  it.each([
    ['abc', 'abd', 0, 1, 'one edit against a zero bound'],
    ['abc', 'abd', 1, 1, 'one edit exactly at the bound'],
    ['abc', 'axy', 1, 2, 'two edits against a bound of one'],
    ['abc', 'axy', 2, 2, 'two edits exactly at the bound'],
    ['kitten', 'sitting', 2, 3, 'three edits against a bound of two'],
    ['kitten', 'sitting', 3, 3, 'three edits exactly at the bound'],
  ])('bounds %j against %j at %i, returning %i — %s', (a, b, bound, expected) => {
    expect(damerauLevenshtein(a, b, bound)).toBe(expected);
  });

  it('reports exactly maxDistance + 1 when the true distance is larger', () => {
    // The caller may only read this as "further than you allowed"; it is not
    // the true distance and T4 never ranks two rejections.
    expect(damerauLevenshtein('abcdefgh', 'zzzzzzzz', 2)).toBe(3);
    expect(damerauLevenshtein('abcdefgh', 'zzzzzzzz', 4)).toBe(5);
    expect(damerauLevenshtein('abcdefgh', 'zzzzzzzz', 0)).toBe(1);
  });

  it('short-circuits on a length difference the bound cannot cover', () => {
    expect(damerauLevenshtein('abc', 'abcdefghij', 2)).toBe(3);
    expect(damerauLevenshtein('abcdefghij', 'abc', 2)).toBe(3);
  });

  it('treats a zero bound as an exactness test', () => {
    // This is the rule anchors.ts applies to labels shorter than five.
    expect(damerauLevenshtein('tsh', 'tsh', 0)).toBe(0);
    expect(damerauLevenshtein('tsh', 'tsg', 0)).toBe(1);
    expect(damerauLevenshtein('ldl', 'hdl', 0)).toBe(1);
  });

  it('treats a negative bound as zero', () => {
    expect(damerauLevenshtein('abc', 'abc', -1)).toBe(0);
    expect(damerauLevenshtein('abc', 'abd', -1)).toBe(1);
  });

  it.each([
    ['', 'a', 1],
    ['a', '', 1],
    ['', '', 0],
  ])('handles the empty string: %j against %j is %i', (a, b, expected) => {
    expect(damerauLevenshtein(a, b, UNBOUNDED)).toBe(expected);
  });

  it.each([
    ['abc', 'axy'],
    ['kitten', 'sitting'],
    ['χοληστερολη', 'χοληστεροη'],
    ['ab', 'ba'],
    ['ca', 'abc'],
  ])('is symmetric for %j and %j', (a, b) => {
    expect(damerauLevenshtein(a, b, UNBOUNDED)).toBe(damerauLevenshtein(b, a, UNBOUNDED));
  });

  it('measures Greek by character, not by UTF-16 unit', () => {
    // normaliseLabel has already stripped accents, so these arrive folded; the
    // point is that one wrong Greek letter costs one edit, not two.
    expect(damerauLevenshtein('αιμοσφαιρινη', 'αιμοσφαιρινι', UNBOUNDED)).toBe(1);
    expect(damerauLevenshtein('σιδηροσ', 'σιδηρο', UNBOUNDED)).toBe(1);
  });

  it('does not choose a bound of its own', () => {
    // The length-based thresholds (0 under five, 1 for five to seven, 2 from
    // eight) belong to anchors.ts. This function applies whatever it is given.
    expect(damerauLevenshtein('abc', 'abd', 2)).toBe(1);
    expect(damerauLevenshtein('abcdefgh', 'abcdefgz', 0)).toBe(1);
  });
});
