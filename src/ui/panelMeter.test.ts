import type { Comparator, ReferenceRange } from '../domain/types';
import type { Measured } from './panelMeter';
import { meterOf, rangeStatus } from './panelMeter';

/**
 * The Panel view's arithmetic, as tables.
 *
 * The domains below are written out rather than recomputed from the formula:
 * a test that repeated the implementation would agree with it however wrong
 * both were.
 */

function measured(overrides: Partial<Measured> = {}): Measured {
  return {
    status: 'value',
    value: 5,
    comparator: null,
    referenceRange: null,
    ...overrides,
  };
}

function closed(min: number, max: number): ReferenceRange {
  return { kind: 'closed', min, max };
}

function minOnly(min: number, comparator: '>' | '>='): ReferenceRange {
  return { kind: 'minOnly', min, comparator };
}

function maxOnly(max: number, comparator: '<' | '<='): ReferenceRange {
  return { kind: 'maxOnly', max, comparator };
}

describe('rangeStatus', () => {
  it.each([
    [4, 'below'],
    [5, 'within'],
    [10, 'within'],
    [15, 'within'],
    [16, 'above'],
  ] as const)('places %s against a closed 5–15 range as %s', (value, expected) => {
    expect(rangeStatus(measured({ value, referenceRange: closed(5, 15) }))).toBe(expected);
  });

  it.each([
    [minOnly(5, '>'), 5, 'below'],
    [minOnly(5, '>='), 5, 'within'],
    [minOnly(5, '>'), 5.1, 'within'],
    [maxOnly(5, '<'), 5, 'above'],
    [maxOnly(5, '<='), 5, 'within'],
    [maxOnly(5, '<'), 4.9, 'within'],
  ] as const)('reads the printed comparator: %o at %s is %s', (range, value, expected) => {
    // The document said `<5` or `<=5`, and those are different statements
    // about the value 5. Neither is rounded into the other.
    expect(rangeStatus(measured({ value, referenceRange: range }))).toBe(expected);
  });

  it('has nothing to say about a censored value, whatever the range', () => {
    for (const comparator of ['<', '<=', '>', '>='] as const satisfies readonly Comparator[]) {
      expect(rangeStatus(measured({ value: 0.1, comparator, referenceRange: closed(5, 15) }))).toBe(
        'unavailable',
      );
    }
  });

  it('has nothing to say without a printed range', () => {
    expect(rangeStatus(measured({ referenceRange: null }))).toBe('unavailable');
  });

  it('has nothing to say about a missing or categorical result', () => {
    expect(
      rangeStatus(measured({ status: 'missing', value: null, referenceRange: closed(5, 15) })),
    ).toBe('unavailable');
    expect(
      rangeStatus(measured({ status: 'categorical', value: null, referenceRange: closed(5, 15) })),
    ).toBe('unavailable');
  });
});

describe('meterOf, closed ranges', () => {
  it('pads a 5–15 range by a quarter of its own width', () => {
    // span = max(10, 1.5, 1) = 10 -> domain [2.5, 17.5]
    const meter = meterOf(measured({ value: 10, referenceRange: closed(5, 15) }));

    expect(meter?.domain).toEqual([2.5, 17.5]);
    expect(meter?.band).toEqual([1 / 6, 5 / 6]);
    expect(meter?.dot).toBeCloseTo(0.5, 10);
    expect(meter?.clamped).toBeNull();
  });

  it('gives a zero-width range a span of one, not of nothing', () => {
    // span = max(0, 0.4, 1) = 1 -> domain [3.75, 4.25]
    const meter = meterOf(measured({ value: 4, referenceRange: closed(4, 4) }));

    expect(meter?.domain).toEqual([3.75, 4.25]);
    expect(meter?.dot).toBeCloseTo(0.5, 10);
  });

  it('uses the tenth-of-magnitude floor when a narrow range sits far from zero', () => {
    // max-min = 2, |402|*0.1 = 40.2 -> span 40.2, padding 10.05 each side
    const meter = meterOf(measured({ value: 400, referenceRange: closed(400, 402) }));

    expect(meter?.domain).toEqual([389.95, 412.05]);
  });

  it('clamps a value past the top of the domain to an end arrow', () => {
    const meter = meterOf(measured({ value: 90, referenceRange: closed(5, 15) }));

    expect(meter?.dot).toBe(1);
    expect(meter?.clamped).toBe('high');
  });

  it('clamps a value past the bottom of the domain to an end arrow', () => {
    const meter = meterOf(measured({ value: -40, referenceRange: closed(5, 15) }));

    expect(meter?.dot).toBe(0);
    expect(meter?.clamped).toBe('low');
  });

  it('holds a value just inside the domain without clamping it', () => {
    const meter = meterOf(measured({ value: 17, referenceRange: closed(5, 15) }));

    expect(meter?.clamped).toBeNull();
    expect(meter?.dot).toBeCloseTo(14.5 / 15, 10);
  });

  it('works below zero, where the padding is still a quarter of the span', () => {
    // span = max(10, 2, 1) = 10 -> domain [-22.5, -7.5]
    const meter = meterOf(measured({ value: -15, referenceRange: closed(-20, -10) }));

    expect(meter?.domain).toEqual([-22.5, -7.5]);
    expect(meter?.dot).toBeCloseTo(0.5, 10);
  });
});

describe('meterOf, one-sided ranges', () => {
  it('gives a minimum-only range three spans of room above its bound', () => {
    // span = max(|40|*0.25, 1) = 10 -> domain [30, 70], bound at 0.25
    const meter = meterOf(measured({ value: 50, referenceRange: minOnly(40, '>=') }));

    expect(meter?.kind).toBe('minOnly');
    expect(meter?.domain).toEqual([30, 70]);
    expect(meter?.band).toEqual([0.25, 1]);
    expect(meter?.dot).toBeCloseTo(0.5, 10);
  });

  it('gives a maximum-only range three spans of room below its bound', () => {
    // span = max(|5|*0.25, 1) = 1.25 -> domain [1.25, 6.25], bound at 0.75
    const meter = meterOf(measured({ value: 2.5, referenceRange: maxOnly(5, '<') }));

    expect(meter?.kind).toBe('maxOnly');
    expect(meter?.domain).toEqual([1.25, 6.25]);
    expect(meter?.band).toEqual([0, 0.75]);
    expect(meter?.dot).toBeCloseTo(0.25, 10);
  });

  it('applies the one-span floor to a bound near zero', () => {
    // span = max(0.05, 1) = 1 -> domain [-0.8, 3.2]
    const meter = meterOf(measured({ value: 1, referenceRange: minOnly(0.2, '>') }));

    expect(meter?.domain).toEqual([-0.8, 3.2]);
  });

  it('clamps past either end of a one-sided domain', () => {
    expect(meterOf(measured({ value: 900, referenceRange: minOnly(40, '>=') }))).toMatchObject({
      dot: 1,
      clamped: 'high',
    });
    expect(meterOf(measured({ value: 0, referenceRange: maxOnly(5, '<') }))).toMatchObject({
      dot: 0,
      clamped: 'low',
    });
  });
});

describe('meterOf draws nothing rather than something invented', () => {
  it('has no rail for a censored value, even with a two-sided range', () => {
    expect(
      meterOf(measured({ value: 0.1, comparator: '<', referenceRange: closed(5, 15) })),
    ).toBeNull();
  });

  it('has no rail without a printed range', () => {
    expect(meterOf(measured({ value: 5, referenceRange: null }))).toBeNull();
  });

  it('has no rail for a missing or categorical result', () => {
    expect(
      meterOf(measured({ status: 'missing', value: null, referenceRange: closed(5, 15) })),
    ).toBeNull();
    expect(
      meterOf(measured({ status: 'categorical', value: null, referenceRange: closed(5, 15) })),
    ).toBeNull();
  });

  it('agrees with rangeStatus about what is unknown', () => {
    // Anything the status calls unavailable draws no dot, and anything that
    // draws a dot has a status that named a side. One rule, two consumers.
    const cases: Measured[] = [
      measured({ value: 0.1, comparator: '<', referenceRange: closed(5, 15) }),
      measured({ referenceRange: null }),
      measured({ status: 'missing', value: null }),
      measured({ value: 10, referenceRange: closed(5, 15) }),
      measured({ value: 50, referenceRange: minOnly(40, '>=') }),
    ];

    for (const each of cases) {
      expect(meterOf(each) === null).toBe(rangeStatus(each) === 'unavailable');
    }
  });
});
