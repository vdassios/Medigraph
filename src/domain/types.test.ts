import { describe, expect, it } from 'vitest';
import { assertProfileSafe, validateProfile, type Profile } from './types';

/**
 * A minimal valid Measurement; override one field per test.
 *
 * Overrides are `Record<string, unknown>` rather than `Partial<Measurement>` on
 * purpose: these tests exist to feed malformed input to a validator that accepts
 * `unknown`, so the helper must be able to express shapes the type forbids.
 */
function measurement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    markerKey: 'ferritin',
    status: 'value',
    value: 245,
    comparator: null,
    unit: 'ng/mL',
    referenceRange: { kind: 'closed', min: 30, max: 400 },
    sourceOrder: 0,
    ...overrides,
  };
}

function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'report-1',
    collectedAt: { date: '2025-03-14', time: null, precision: 'day' },
    measurements: [measurement()],
    ...overrides,
  };
}

function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, id: 'profile-1', reports: [report()], ...overrides };
}

describe('validateProfile — accepts valid shapes', () => {
  it('accepts a minimal profile and returns it', () => {
    const result = validateProfile(profile());
    expect(result.schemaVersion).toBe(1);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]?.measurements[0]?.value).toBe(245);
  });

  it('accepts an empty report list', () => {
    expect(validateProfile(profile({ reports: [] })).reports).toEqual([]);
  });

  it('accepts each reference-range kind', () => {
    for (const range of [
      { kind: 'closed', min: 30, max: 400 },
      { kind: 'minOnly', min: 30, comparator: '>' },
      { kind: 'minOnly', min: 30, comparator: '>=' },
      { kind: 'maxOnly', max: 400, comparator: '<' },
      { kind: 'maxOnly', max: 400, comparator: '<=' },
    ]) {
      const p = profile({
        reports: [report({ measurements: [measurement({ referenceRange: range })] })],
      });
      expect(() => validateProfile(p)).not.toThrow();
    }
  });

  it('accepts min === max as a closed range', () => {
    const p = profile({
      reports: [
        report({
          measurements: [measurement({ referenceRange: { kind: 'closed', min: 5, max: 5 } })],
        }),
      ],
    });
    expect(() => validateProfile(p)).not.toThrow();
  });

  it("keeps a ReferenceRange on a 'missing' measurement", () => {
    const p = profile({
      reports: [
        report({
          measurements: [measurement({ status: 'missing', value: null, comparator: null })],
        }),
      ],
    });
    expect(validateProfile(p).reports[0]?.measurements[0]?.referenceRange).toEqual({
      kind: 'closed',
      min: 30,
      max: 400,
    });
  });

  it('accepts two same-day reports at distinct minute times', () => {
    const p = profile({
      reports: [
        report({
          id: 'r1',
          collectedAt: { date: '2025-03-14', time: '08:30', precision: 'minute' },
        }),
        report({
          id: 'r2',
          collectedAt: { date: '2025-03-14', time: '14:05', precision: 'minute' },
        }),
      ],
    });
    expect(validateProfile(p).reports).toHaveLength(2);
  });

  it('accepts a label on a derived x:* marker key', () => {
    const p = profile({
      reports: [
        report({
          measurements: [measurement({ markerKey: 'x:καποιος-δεικτης', label: 'Κάποιος Δείκτης' })],
        }),
      ],
    });
    expect(validateProfile(p).reports[0]?.measurements[0]?.label).toBe('Κάποιος Δείκτης');
  });
});

describe('validateProfile — rejects malformed boundaries', () => {
  const cases: [string, unknown][] = [
    ['a non-object', 42],
    ['null', null],
    ['an array', []],
    ['a wrong schemaVersion', profile({ schemaVersion: 2 })],
    ['an empty profile id', profile({ id: '' })],
    ['a non-array reports field', profile({ reports: {} })],
    ['a non-object report', profile({ reports: [7] })],
    ['an empty report id', profile({ reports: [report({ id: '' })] })],
  ];
  for (const [name, value] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => validateProfile(value)).toThrow(/invalid-profile/);
    });
  }

  const badMeasurements: [string, Record<string, unknown>][] = [
    ['an empty marker key', { markerKey: '' }],
    ['an unknown status', { status: 'unknown' }],
    ['a non-finite value', { value: Number.NaN }],
    ['an infinite value', { value: Number.POSITIVE_INFINITY }],
    ['a null value with status value', { value: null }],
    ['an unknown comparator', { comparator: '~' }],
    ['a negative sourceOrder', { sourceOrder: -1 }],
    ['a fractional sourceOrder', { sourceOrder: 1.5 }],
    ['a numeric unit', { unit: 7 }],
  ];
  for (const [name, patch] of badMeasurements) {
    it(`rejects ${name}`, () => {
      const p = profile({ reports: [report({ measurements: [measurement(patch)] })] });
      expect(() => validateProfile(p)).toThrow(/invalid-profile/);
    });
  }

  it("rejects a non-null value when status is 'missing'", () => {
    const p = profile({
      reports: [report({ measurements: [measurement({ status: 'missing', value: 5 })] })],
    });
    expect(() => validateProfile(p)).toThrow(/must be null/);
  });

  it("rejects a non-null comparator when status is 'missing'", () => {
    const p = profile({
      reports: [
        report({
          measurements: [measurement({ status: 'missing', value: null, comparator: '<' })],
        }),
      ],
    });
    expect(() => validateProfile(p)).toThrow(/comparator/);
  });

  it('rejects min greater than max', () => {
    const p = profile({
      reports: [
        report({
          measurements: [measurement({ referenceRange: { kind: 'closed', min: 400, max: 30 } })],
        }),
      ],
    });
    expect(() => validateProfile(p)).toThrow(/min greater than max/);
  });

  it('rejects a minOnly range with a max-direction comparator', () => {
    const p = profile({
      reports: [
        report({
          measurements: [
            measurement({ referenceRange: { kind: 'minOnly', min: 30, comparator: '<' } }),
          ],
        }),
      ],
    });
    expect(() => validateProfile(p)).toThrow(/minOnly/);
  });

  it('rejects a maxOnly range with a min-direction comparator', () => {
    const p = profile({
      reports: [
        report({
          measurements: [
            measurement({ referenceRange: { kind: 'maxOnly', max: 30, comparator: '>' } }),
          ],
        }),
      ],
    });
    expect(() => validateProfile(p)).toThrow(/maxOnly/);
  });

  it('rejects an unknown reference-range kind', () => {
    const p = profile({
      reports: [report({ measurements: [measurement({ referenceRange: { kind: 'open' } })] })],
    });
    expect(() => validateProfile(p)).toThrow(/kind/);
  });

  it('rejects duplicate report ids', () => {
    const p = profile({
      reports: [
        report({ id: 'same', collectedAt: { date: '2025-01-01', time: null, precision: 'day' } }),
        report({ id: 'same', collectedAt: { date: '2025-06-01', time: null, precision: 'day' } }),
      ],
    });
    expect(() => validateProfile(p)).toThrow(/repeats report id/);
  });

  it('rejects a repeated marker key within one report', () => {
    const p = profile({
      reports: [report({ measurements: [measurement(), measurement()] })],
    });
    expect(() => validateProfile(p)).toThrow(/repeats marker key/);
  });
});

describe('validateProfile — dates and times', () => {
  const badDates = ['2025-02-30', '2025-13-01', '2025-00-10', '2025-1-1', '20250101', 'not-a-date'];
  for (const date of badDates) {
    it(`rejects the date ${date}`, () => {
      const p = profile({
        reports: [report({ collectedAt: { date, time: null, precision: 'day' } })],
      });
      expect(() => validateProfile(p)).toThrow(/invalid-profile/);
    });
  }

  it('accepts a real leap day', () => {
    const p = profile({
      reports: [report({ collectedAt: { date: '2024-02-29', time: null, precision: 'day' } })],
    });
    expect(() => validateProfile(p)).not.toThrow();
  });

  it('rejects 29 February in a non-leap year', () => {
    const p = profile({
      reports: [report({ collectedAt: { date: '2025-02-29', time: null, precision: 'day' } })],
    });
    expect(() => validateProfile(p)).toThrow(/calendar day/);
  });

  it("rejects a time when precision is 'day'", () => {
    const p = profile({
      reports: [report({ collectedAt: { date: '2025-03-14', time: '08:30', precision: 'day' } })],
    });
    expect(() => validateProfile(p)).toThrow(/must be null/);
  });

  it("rejects a null time when precision is 'minute'", () => {
    const p = profile({
      reports: [report({ collectedAt: { date: '2025-03-14', time: null, precision: 'minute' } })],
    });
    expect(() => validateProfile(p)).toThrow(/HH:mm/);
  });

  for (const time of ['24:00', '08:60', '8:30', '0830']) {
    it(`rejects the time ${time}`, () => {
      const p = profile({
        reports: [report({ collectedAt: { date: '2025-03-14', time, precision: 'minute' } })],
      });
      expect(() => validateProfile(p)).toThrow(/invalid-profile/);
    });
  }

  it('rejects two same-day reports when either is day-precision', () => {
    const p = profile({
      reports: [
        report({ id: 'r1', collectedAt: { date: '2025-03-14', time: null, precision: 'day' } }),
        report({
          id: 'r2',
          collectedAt: { date: '2025-03-14', time: '09:00', precision: 'minute' },
        }),
      ],
    });
    expect(() => validateProfile(p)).toThrow(/minute-precision/);
  });

  it('rejects two same-day reports sharing a time', () => {
    const p = profile({
      reports: [
        report({
          id: 'r1',
          collectedAt: { date: '2025-03-14', time: '09:00', precision: 'minute' },
        }),
        report({
          id: 'r2',
          collectedAt: { date: '2025-03-14', time: '09:00', precision: 'minute' },
        }),
      ],
    });
    expect(() => validateProfile(p)).toThrow(/not unique/);
  });
});

describe('validateProfile — free-text policy', () => {
  it('rejects a label on a canonical marker key', () => {
    const p = profile({
      reports: [report({ measurements: [measurement({ label: 'Φερριτίνη' })] })],
    });
    expect(() => validateProfile(p)).toThrow(/x:\*/);
  });

  it('rejects a non-string label', () => {
    const p = profile({
      reports: [report({ measurements: [measurement({ markerKey: 'x:foo', label: 7 })] })],
    });
    expect(() => validateProfile(p)).toThrow(/label/);
  });
});

describe('assertProfileSafe', () => {
  function withLabel(label: string): Profile {
    return validateProfile(
      profile({
        reports: [report({ measurements: [measurement({ markerKey: 'x:unknown', label })] })],
      }),
    );
  }

  it('accepts an ordinary Greek unknown label', () => {
    expect(() => {
      assertProfileSafe(withLabel('Κάποιος άγνωστος δείκτης'));
    }).not.toThrow();
  });

  it('accepts a profile with no labels at all', () => {
    expect(() => {
      assertProfileSafe(validateProfile(profile()));
    }).not.toThrow();
  });

  it('rejects a label over 120 characters', () => {
    expect(() => {
      assertProfileSafe(withLabel('α'.repeat(121)));
    }).toThrow(/exceeds 120/);
  });

  it('accepts a label of exactly 120 characters', () => {
    expect(() => {
      assertProfileSafe(withLabel('α'.repeat(120)));
    }).not.toThrow();
  });

  it('rejects a newline in a label', () => {
    expect(() => {
      assertProfileSafe(withLabel('Δείκτης\nΌνομα Ασθενούς'));
    }).toThrow(/control/);
  });

  it('rejects a tab in a label', () => {
    expect(() => {
      assertProfileSafe(withLabel('Δείκτης\tτιμή'));
    }).toThrow(/control/);
  });

  it('rejects an AMKA-shaped label', () => {
    expect(() => {
      assertProfileSafe(withLabel('Δείκτης 12345678901'));
    }).toThrow(/AMKA/);
  });

  it('does not treat a 10-digit run as an AMKA', () => {
    expect(() => {
      assertProfileSafe(withLabel('Δείκτης 1234567890'));
    }).not.toThrow();
  });

  it('rejects an email-shaped label', () => {
    expect(() => {
      assertProfileSafe(withLabel('contact patient@example.com'));
    }).toThrow(/email/);
  });

  it('rejects a Greek mobile number', () => {
    expect(() => {
      assertProfileSafe(withLabel('Δείκτης 6971234567'));
    }).toThrow(/phone/);
  });

  it('rejects a +30-prefixed phone number', () => {
    expect(() => {
      assertProfileSafe(withLabel('+30 2101234567'));
    }).toThrow(/phone/);
  });
});
