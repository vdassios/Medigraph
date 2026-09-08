import type { Comparator, ReferenceRange } from '../domain/types';

/**
 * The Panel view's arithmetic, kept away from the DOM.
 *
 * Two questions, both answered from one Measurement and the range the
 * laboratory printed beside it: where a value sits against that range, and
 * what geometry draws it. Neither answer is clinical. `within`, `below` and
 * `above` are statements about a printed interval, and every one of them is
 * traceable to a bound that appeared on the user's own document (D13).
 *
 * **A censored value has no position.** `< 0.10` says the quantity is under a
 * bound and says nothing else; drawing it at 0.10 would put a dot where no
 * measurement was made, and calling it `below` would answer a question the
 * laboratory declined to answer. Censored and missing results are always
 * `unavailable` and always draw no dot and no band.
 */

/** What is known about a value's position against its own printed range. */
export type RangeStatus = 'within' | 'below' | 'above' | 'unavailable';

export type MeterKind = 'closed' | 'minOnly' | 'maxOnly';

/**
 * A meter, in fractions of its own domain.
 *
 * Geometry leaves here as `0..1` because the only thing the component adds is
 * a width in pixels: an SVG that received raw values would have to redo this
 * arithmetic to place anything, and the two copies would eventually disagree.
 */
export interface Meter {
  kind: MeterKind;
  /** The value-space window the meter draws, `[low, high]`. */
  domain: [number, number];
  /** The shaded reference region, as fractions of the domain. */
  band: [number, number];
  /** Where the dot sits, as a fraction of the domain, clamped into it. */
  dot: number;
  /** Set when the value fell outside the domain and the dot became an arrow. */
  clamped: 'low' | 'high' | null;
}

/** The fields of a Measurement — or a ParsedRow — this module reads. */
export interface Measured {
  status: 'value' | 'categorical' | 'missing';
  value: number | null;
  comparator: Comparator | null;
  referenceRange: ReferenceRange | null;
}

/** An exact number: a `value` result carrying no comparator. */
function exactValue(measured: Measured): number | null {
  return measured.status === 'value' && measured.comparator === null ? measured.value : null;
}

/**
 * Where a value sits against the range printed beside it.
 *
 * Closed ranges include both endpoints. A one-sided range uses the comparator
 * the laboratory printed and nothing else, so equality is outside a strict
 * bound and within an inclusive one — the document said `<5` or `<=5`, and
 * those are different statements about the value 5.
 */
export function rangeStatus(measured: Measured): RangeStatus {
  const value = exactValue(measured);
  const range = measured.referenceRange;
  if (value === null || range === null) {
    return 'unavailable';
  }

  if (range.kind === 'closed') {
    if (value < range.min) {
      return 'below';
    }

    return value > range.max ? 'above' : 'within';
  }

  if (range.kind === 'minOnly') {
    const within = range.comparator === '>' ? value > range.min : value >= range.min;
    return within ? 'within' : 'below';
  }

  const within = range.comparator === '<' ? value < range.max : value <= range.max;
  return within ? 'within' : 'above';
}

/** Where `value` falls in `[low, high]`, clamped, with the direction it left by. */
function place(value: number, [low, high]: [number, number]): Pick<Meter, 'dot' | 'clamped'> {
  const fraction = (value - low) / (high - low);
  if (fraction < 0) {
    return { dot: 0, clamped: 'low' };
  }

  return fraction > 1 ? { dot: 1, clamped: 'high' } : { dot: fraction, clamped: null };
}

function fractionOf(value: number, [low, high]: [number, number]): number {
  return (value - low) / (high - low);
}

/**
 * The geometry for one row, or `null` where there is nothing honest to draw.
 *
 * Each domain is derived from the range alone, never from the value, so two
 * Reports of the same marker under the same printed range draw the same rail
 * and the dots on them can be compared by eye. A value outside that window
 * clamps to an end arrow rather than stretching the domain to reach it, which
 * would silently rescale the rail whenever a result was extreme.
 */
export function meterOf(measured: Measured): Meter | null {
  const value = exactValue(measured);
  const range = measured.referenceRange;
  if (value === null || range === null) {
    return null;
  }

  if (range.kind === 'closed') {
    const { min, max } = range;
    const span = Math.max(max - min, Math.max(Math.abs(min), Math.abs(max)) * 0.1, 1);
    const domain: [number, number] = [min - 0.25 * span, max + 0.25 * span];

    return {
      kind: 'closed',
      domain,
      band: [fractionOf(min, domain), fractionOf(max, domain)],
      ...place(value, domain),
    };
  }

  if (range.kind === 'minOnly') {
    const span = Math.max(Math.abs(range.min) * 0.25, 1);
    const domain: [number, number] = [range.min - span, range.min + 3 * span];

    return {
      kind: 'minOnly',
      domain,
      band: [fractionOf(range.min, domain), 1],
      ...place(value, domain),
    };
  }

  const span = Math.max(Math.abs(range.max) * 0.25, 1);
  const domain: [number, number] = [range.max - 3 * span, range.max + span];

  return {
    kind: 'maxOnly',
    domain,
    band: [0, fractionOf(range.max, domain)],
    ...place(value, domain),
  };
}
