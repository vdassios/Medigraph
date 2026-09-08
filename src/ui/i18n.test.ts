// @vitest-environment jsdom
import { COPY, LANGUAGES, detectLanguage, loadLanguage, localisedDate, saveLanguage } from './i18n';
import type { Copy, Language } from './i18n';

/**
 * The string tables, read as data.
 *
 * Copy bound by D13 is only reviewable if it is somewhere a test can read it,
 * which is the reason for one table rather than a constant per component. What
 * is asserted here is what the product may not say — in either language — and
 * that neither language has a hole in it.
 */

/** Every string in a table, flattened, with the path that reached it. */
function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') {
    return [[path, value]];
  }
  if (typeof value === 'function') {
    // A parameterised string: called with values that read plausibly, so its
    // words are covered by the same rules as the rest.
    const called: unknown = (value as (...args: unknown[]) => unknown)(2, 'X', 3, 4);

    return typeof called === 'string' ? [[path, called]] : [];
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, each]) =>
      strings(each, path === '' ? key : `${path}.${key}`),
    );
  }

  return [];
}

describe('the tables', () => {
  it.each(LANGUAGES)('has no empty string in %s', (language) => {
    const empty = strings(COPY[language]).filter(([, value]) => value.trim() === '');

    expect(empty).toEqual([]);
  });

  it('says the same things in both languages', () => {
    const el = strings(COPY.el).map(([path]) => path);
    const en = strings(COPY.en).map(([path]) => path);

    expect(en).toEqual(el);
  });

  it('leaves nothing untranslated', () => {
    const el = new Map(strings(COPY.el));
    const shared = strings(COPY.en).filter(([path, value]) => el.get(path) === value);

    // Two strings are the same in both languages by nature: the product's own
    // name, and the dash standing for a value nobody reported.
    expect(shared.map(([path]) => path)).toEqual(['appName', 'panel.missing']);
  });
});

describe('what the copy may not say (D13)', () => {
  const FORBIDDEN = [
    // Severity and judgement, in both languages.
    /\bυψηλ|\bχαμηλ|κίνδυν|σοβαρ|ανησυχ|φυσιολογικ/iu,
    /\bhigh\b|\blow\b|\brisk|\bsevere|\bcritical|\bnormal\b|\bhealthy\b|\babnormal/iu,
    // Direction over time.
    /αυξάν|μειών|βελτ|χειροτ|\bτάση|επιδείν/iu,
    /\brising\b|\bfalling\b|\bimproving\b|\bworsening\b|\btrend(ing)?\b|\bdeclin/iu,
    // Advice.
    /συμβουλευτ|διάγνωσ|θεραπε/iu,
    /\bdiagnos|\btreatment\b|\byou should\b/iu,
  ];

  it.each(LANGUAGES)('names no severity, direction or advice in %s', (language) => {
    const offending = strings(COPY[language]).filter(([, value]) =>
      FORBIDDEN.some((pattern) => pattern.test(value)),
    );

    expect(offending).toEqual([]);
  });

  it.each(LANGUAGES)('states the display-only limit outright in %s', (language) => {
    const copy: Copy = COPY[language];

    expect(copy.disclaimer.displayOnly.length).toBeGreaterThan(40);
    expect(copy.privacy.displayOnly.length).toBeGreaterThan(40);
  });
});

describe('what the privacy copy may not promise', () => {
  it.each(LANGUAGES)('does not promise an empty Network tab in %s', (language) => {
    const { networkTab } = COPY[language].privacy;

    // It offers the check and immediately says what it is worth. Promising an
    // empty tab would be false — the app downloads its own assets — and
    // presenting the check as proof would be worse.
    expect(networkTab).toMatch(language === 'el' ? /δεν θα είναι άδεια/u : /will not be empty/u);
    expect(networkTab).toMatch(language === 'el' ? /όχι απόδειξη/u : /not proof/u);
  });

  it.each(LANGUAGES)('claims no absolute safety in %s', (language) => {
    const { privacy } = COPY[language];
    const all = [privacy.local, privacy.noServer, privacy.plaintext, privacy.xss].join(' ');

    expect(all).not.toMatch(/απόλυτ|εγγυημέν|100%|\bguarantee|\bimpossible\b|\bfully secure\b/iu);
    // The XSS paragraph is the one that has to admit a limit.
    expect(privacy.xss).toMatch(
      language === 'el' ? /χωρίς αυτό να αποτελεί/u : /not the same as proof/u,
    );
  });

  it.each(LANGUAGES)('enumerates no origin allowlist in %s (ADR-0015)', (language) => {
    const flat = strings(COPY[language])
      .map(([, value]) => value)
      .join(' ');

    expect(flat).not.toMatch(/connect-src|allowlist|λίστα επιτρεπ/iu);
  });
});

describe('choosing a language', () => {
  it.each([
    [['el-GR', 'en-US'], 'el'],
    [['en-GB'], 'en'],
    [['fr-FR', 'en-US'], 'en'],
    [['fr-FR'], 'el'],
    [[], 'el'],
  ] as [string[], Language][])('reads %o as %s', (preferred, expected) => {
    expect(detectLanguage(preferred)).toBe(expected);
  });

  it('remembers a choice, and ignores anything else it finds', () => {
    saveLanguage('en');
    expect(loadLanguage()).toBe('en');

    globalThis.localStorage.setItem('medigraph:language', 'de');
    expect(loadLanguage()).toBeNull();

    globalThis.localStorage.clear();
    expect(loadLanguage()).toBeNull();
  });
});

describe('dates', () => {
  it('always prints the ISO form beside the localised one', () => {
    expect(localisedDate('2025-05-14', 'el')).toContain('(2025-05-14)');
    expect(localisedDate('2025-05-14', 'en')).toContain('(2025-05-14)');
    // Which is the point: 05/04 is April in one country and May in another.
    expect(localisedDate('2025-05-14', 'el')).not.toBe(localisedDate('2025-05-14', 'en'));
  });

  it('prints an unparseable date as it stands rather than as an error', () => {
    expect(localisedDate('', 'el')).toBe('');
  });
});
