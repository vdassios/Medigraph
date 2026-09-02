import { describe, expect, it } from 'vitest';
import { normaliseAbbreviation, normaliseLabel, tokenise } from './text';
import type { TextItem } from './types';

function item(text: string, overrides: Partial<TextItem> = {}): TextItem {
  return { id: 'item-1', text, x: 10, y: 20, w: 30, h: 8, ...overrides };
}

describe('normaliseLabel', () => {
  it.each([
    ['Λευκά Αιμοσφαίρια (WBC)', 'λευκα αιμοσφαιρια (wbc)'],
    ['Όξινη', 'οξινη'],
    ['ΤΡΑΝΣΑΜΙΝΑΣΕΣ', 'τρανσαμινασεσ'],
    ['Τρανσαμινάσες', 'τρανσαμινασεσ'],
    ['  Ουρικό   οξύ \n', 'ουρικο οξυ'],
    ['', ''],
  ])('normalises %j to %j', (input, expected) => {
    expect(normaliseLabel(input)).toBe(expected);
  });

  it.each([
    ['ΟΥΡΙΑΣ', 'Ουρίας'],
    ['ΤΡΑΝΣΑΜΙΝΑΣΕΣ', 'Τρανσαμινάσες'],
  ])('normalises the uppercase alias %j and the lowercase %j identically', (upper, lower) => {
    // The word-final Σ lowercases to ς under Unicode's Final_Sigma rule, so
    // without the sigma fold these two would not match.
    expect(normaliseLabel(upper)).toBe(normaliseLabel(lower));
  });

  it('preserves both alphabets rather than transliterating either', () => {
    expect(normaliseLabel('Βιταμίνη B12')).toBe('βιταμινη b12');
  });

  it('leaves a Greek capital mu in a Latin abbreviation alone', () => {
    // ADR-0013: `(ΜCV)` in the corpus opens with U+039C, not Latin M. A label
    // is not the place to fold that — normaliseAbbreviation is.
    expect(normaliseLabel('ΜCV')).toBe('μcv');
  });
});

describe('normaliseAbbreviation', () => {
  it.each([
    ['Lp (α)', 'lp(a)'],
    ['(Να)', '(na)'],
    ['WBC ( wbc )', 'wbc(wbc)'],
    ['ΜCV', 'mcv'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normaliseAbbreviation(input)).toBe(expected);
  });

  it('matches a Greek-lettered abbreviation to its Latin spelling', () => {
    expect(normaliseAbbreviation('Lp (α)')).toBe(normaliseAbbreviation('Lp(a)'));
  });

  it('folds only the listed confusables, keeping every other Greek letter', () => {
    // υ, κ, ο, ζ, η fold; γ and λ have no Latin confusable and stay Greek.
    expect(normaliseAbbreviation('ΓΛΥΚΟΖΗ')).toBe('γλykozh');
  });

  it('folds case-stably, so an uppercase and lowercase spelling agree', () => {
    expect(normaliseAbbreviation('ΑΛΤ')).toBe(normaliseAbbreviation('αλτ'));
  });

  it('still strips accents and folds the final sigma', () => {
    expect(normaliseAbbreviation('Ουρίας')).toBe('oypiaσ');
  });
});

describe('tokenise', () => {
  it('splits a fragment holding a number and a word', () => {
    // One pdf.js fragment, two lexical tokens. This is the cell the urine
    // panel produces.
    expect(tokenise(item('6.0 Όξινη'))).toEqual([
      { text: '6.0', parentItemId: 'item-1', start: 0, end: 3 },
      { text: 'Όξινη', parentItemId: 'item-1', start: 4, end: 9 },
    ]);
  });

  it('reports offsets into the original text, not the trimmed text', () => {
    expect(tokenise(item('  70 - 110  '))).toEqual([
      { text: '70', parentItemId: 'item-1', start: 2, end: 4 },
      { text: '-', parentItemId: 'item-1', start: 5, end: 6 },
      { text: '110', parentItemId: 'item-1', start: 7, end: 10 },
    ]);
  });

  it.each([
    ['<75', 1],
    ['< 75', 2],
    ['70-110', 1],
  ])('splits %j on whitespace alone, into %i token(s)', (text, count) => {
    // A glued comparator stays whole; parseNumber accepts both spellings, and
    // the read-out rules join only a standalone comparator.
    expect(tokenise(item(text))).toHaveLength(count);
  });

  it.each([
    ['', 'empty text'],
    ['   \n\t ', 'whitespace-only text'],
  ])('returns no tokens for %j (%s)', (text) => {
    expect(tokenise(item(text))).toEqual([]);
  });

  it('carries the parent item id onto every token', () => {
    const tokens = tokenise(item('Ουρικό οξύ 6.0', { id: 'p3-item-42' }));
    expect(tokens.map((token) => token.parentItemId)).toEqual([
      'p3-item-42',
      'p3-item-42',
      'p3-item-42',
    ]);
  });

  it('offsets slice the parent text back to the token exactly', () => {
    const source = item(' Χοληστερόλη  <  200 mg/dL ');
    for (const token of tokenise(source)) {
      expect(source.text.slice(token.start, token.end)).toBe(token.text);
    }
  });

  it('counts offsets in UTF-16 code units, not code points', () => {
    // 🧪 is one code point but two UTF-16 units, so the next token starts at 3.
    expect(tokenise(item('🧪 pH'))).toEqual([
      { text: '🧪', parentItemId: 'item-1', start: 0, end: 2 },
      { text: 'pH', parentItemId: 'item-1', start: 3, end: 5 },
    ]);
  });

  it('invents no geometry for a token', () => {
    // Splitting a fragment and interpolating x by character count is unsafe
    // under a proportional font, so a token carries no box at all.
    const [token] = tokenise(item('Αιματοκρίτης'));
    expect(token && Object.keys(token).sort()).toEqual(['end', 'parentItemId', 'start', 'text']);
  });
});
