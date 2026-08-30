import { describe, expect, it } from 'vitest';
import { assertProfileSafe, validateProfile, type Profile } from './types';

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

function profileWithMeasurement(overrides: Record<string, unknown>): Record<string, unknown> {
  return profile({ reports: [report({ measurements: [measurement(overrides)] })] });
}

function profileWithCollectedAt(collectedAt: Record<string, unknown>): Record<string, unknown> {
  return profile({ reports: [report({ collectedAt })] });
}

describe('validateProfile', () => {
  it('returns a valid profile', () => {
    expect(validateProfile(profile())).toEqual(profile());
  });

  it.each([
    ['an empty profile', profile({ reports: [] })],
    [
      'a missing measurement with its range',
      profileWithMeasurement({ status: 'missing', value: null, comparator: null }),
    ],
    [
      'a derived marker label',
      profileWithMeasurement({ markerKey: 'x:unknown', label: 'Άγνωστος δείκτης' }),
    ],
    [
      'equal closed-range bounds',
      profileWithMeasurement({ referenceRange: { kind: 'closed', min: 5, max: 5 } }),
    ],
    [
      'a minimum-only range',
      profileWithMeasurement({ referenceRange: { kind: 'minOnly', min: 30, comparator: '>=' } }),
    ],
    [
      'a maximum-only range',
      profileWithMeasurement({ referenceRange: { kind: 'maxOnly', max: 400, comparator: '<=' } }),
    ],
    ['a leap day', profileWithCollectedAt({ date: '2024-02-29', time: null, precision: 'day' })],
    [
      'distinct reports on the same day',
      profile({
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
      }),
    ],
  ])('accepts %s', (_name, value) => {
    expect(() => validateProfile(value)).not.toThrow();
  });

  const invalidCases: [string, () => unknown, RegExp][] = [
    ['a malformed profile shape', () => profile({ reports: {} }), /profile.reports/],
    [
      'a present missing value',
      () => profileWithMeasurement({ status: 'missing', value: 5, comparator: null }),
      /must be null/,
    ],
    [
      'a comparator on a missing value',
      () => profileWithMeasurement({ status: 'missing', value: null, comparator: '<' }),
      /comparator/,
    ],
    [
      'reversed closed-range bounds',
      () => profileWithMeasurement({ referenceRange: { kind: 'closed', min: 400, max: 30 } }),
      /min greater than max/,
    ],
    [
      'a minimum range with a maximum comparator',
      () =>
        profileWithMeasurement({
          referenceRange: { kind: 'minOnly', min: 30, comparator: '<' },
        }),
      /comparator/,
    ],
    [
      'a malformed date',
      () => profileWithCollectedAt({ date: '2025-1-1', time: null, precision: 'day' }),
      /YYYY-MM-DD/,
    ],
    [
      'an invalid calendar day',
      () => profileWithCollectedAt({ date: '2025-02-29', time: null, precision: 'day' }),
      /calendar day/,
    ],
    [
      'a time at day precision',
      () => profileWithCollectedAt({ date: '2025-03-14', time: '08:30', precision: 'day' }),
      /collectedAt.time/,
    ],
    [
      'no time at minute precision',
      () => profileWithCollectedAt({ date: '2025-03-14', time: null, precision: 'minute' }),
      /collectedAt.time/,
    ],
    [
      'an invalid time',
      () => profileWithCollectedAt({ date: '2025-03-14', time: '24:00', precision: 'minute' }),
      /time of day/,
    ],
    [
      'duplicate report ids',
      () =>
        profile({
          reports: [
            report({ id: 'same' }),
            report({
              id: 'same',
              collectedAt: { date: '2025-06-01', time: null, precision: 'day' },
            }),
          ],
        }),
      /repeats report id/,
    ],
    [
      'duplicate marker keys',
      () => profile({ reports: [report({ measurements: [measurement(), measurement()] })] }),
      /repeats marker key/,
    ],
    [
      'day precision for same-day reports',
      () =>
        profile({
          reports: [
            report({ id: 'r1' }),
            report({
              id: 'r2',
              collectedAt: { date: '2025-03-14', time: '09:00', precision: 'minute' },
            }),
          ],
        }),
      /minute-precision/,
    ],
    [
      'duplicate same-day times',
      () =>
        profile({
          reports: ['r1', 'r2'].map((id) =>
            report({
              id,
              collectedAt: { date: '2025-03-14', time: '09:00', precision: 'minute' },
            }),
          ),
        }),
      /not unique/,
    ],
    ['a label on a canonical marker', () => profileWithMeasurement({ label: 'Φερριτίνη' }), /x:\*/],
    [
      'a non-string derived label',
      () => profileWithMeasurement({ markerKey: 'x:unknown', label: 7 }),
      /label/,
    ],
    [
      'too many reports',
      () =>
        profile({
          reports: Array.from({ length: 10_001 }, (_, id) => report({ id: String(id) })),
        }),
      /exceeds 10000/,
    ],
    [
      'too many measurements',
      () =>
        profile({
          reports: [
            report({
              measurements: Array.from({ length: 1_001 }, (_, id) =>
                measurement({ markerKey: String(id) }),
              ),
            }),
          ],
        }),
      /exceeds 1000/,
    ],
  ];

  it.each(invalidCases)('rejects %s', (_name, value, expected) => {
    expect(() => validateProfile(value())).toThrow(expected);
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

  it.each(['Κάποιος άγνωστος δείκτης', 'α'.repeat(120), 'Δείκτης 1234567890'])(
    'accepts the safe label %s',
    (label) => {
      expect(() => {
        assertProfileSafe(withLabel(label));
      }).not.toThrow();
    },
  );

  const unsafeLabels: [string, string, RegExp][] = [
    ['an overlong label', 'α'.repeat(121), /exceeds 120/],
    ['control characters', 'Δείκτης\nΌνομα Ασθενούς', /control/],
    ['an AMKA', 'Δείκτης 12345678901', /AMKA/],
    ['an email', 'contact patient@example.com', /email/],
    ['a mobile number', 'Δείκτης 6971234567', /phone/],
    ['a prefixed landline', '+30 2101234567', /phone/],
  ];

  it.each(unsafeLabels)('rejects %s', (_name, label, expected) => {
    expect(() => {
      assertProfileSafe(withLabel(label));
    }).toThrow(expected);
  });
});
