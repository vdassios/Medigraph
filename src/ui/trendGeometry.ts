import type { CollectedAt, ReferenceRange, Series, SeriesPoint } from '../domain/types';
import type { RangeStatus } from './panelMeter';
import { rangeStatus } from './panelMeter';

/**
 * Where every mark in a Trend view goes, computed without a DOM in sight.
 *
 * The view is one marker over time and nothing else (D12): one series, one
 * y-axis, no second marker and no second scale. What this module produces is
 * positions — fractions of the plot, `0..1`, x rightward and y upward — so the
 * component's only remaining arithmetic is multiplying by a size.
 *
 * **It describes; it never characterises** (D13). There is no slope here, no
 * regression, no direction, no delta and no projection. A point knows where it
 * sits and whether the range printed *on its own report* contains it; nothing
 * compares one point to another.
 */

/** What can be drawn for one point. */
export type PointKind = 'value' | 'censored' | 'missing';

export interface TrendPoint {
  index: number;
  /** Position across the plot, `0..1`, proportional to elapsed time. */
  x: number;
  /** Position up the plot, `0..1`, or null when there is no value to place. */
  y: number | null;
  kind: PointKind;
  status: RangeStatus;
  /** Whether this point carries a direct value label. */
  labelled: boolean;
}

/**
 * One step of the reference band: the range one report printed, held until the
 * next report says otherwise.
 */
export interface TrendBand {
  from: number;
  to: number;
  /** Bottom of the shaded region, or null when the range is unbounded below. */
  low: number | null;
  /** Top of the shaded region, or null when the range is unbounded above. */
  high: number | null;
}

export interface TrendGeometry {
  /** The y value-space window, `[low, high]`. */
  domain: [number, number];
  points: TrendPoint[];
  bands: TrendBand[];
  /** Runs of consecutive exact points, as indices into `points`, to be joined. */
  lines: number[][];
  /** True when no point carries a value that can be placed at all. */
  empty: boolean;
}

/**
 * Two labels closer than this share space, so the first is dropped.
 *
 * A display heuristic and nothing more: the exact rule the plan states is "when
 * the two labels would overlap", and text metrics are not available to a pure
 * module. A fifth of the plot is wide enough for the longest value string this
 * product prints at the sizes it draws.
 */
const LABEL_CLEARANCE = 0.2;

/**
 * The local civil moment a report was collected.
 *
 * No timezone is applied — these are the values printed on the document — and
 * a day-precision report is placed at local noon, so a point never slides onto
 * the previous or next day the way a midnight UTC reading would.
 */
export function civilMillis(collectedAt: CollectedAt): number {
  return new Date(`${collectedAt.date}T${collectedAt.time ?? '12:00'}:00`).getTime();
}

function kindOf(point: SeriesPoint): PointKind {
  if (point.status !== 'value' || point.value === null) {
    return 'missing';
  }

  return point.comparator === null ? 'value' : 'censored';
}

/** Every finite bound a range names, for the y-domain. */
function boundsOf(range: ReferenceRange | null): number[] {
  if (range === null) {
    return [];
  }
  if (range.kind === 'closed') {
    return [range.min, range.max];
  }

  return range.kind === 'minOnly' ? [range.min] : [range.max];
}

/**
 * The y window: every value, every printed bound, and a tenth of room around.
 *
 * Bounds are included because a band nobody can see is not context — a result
 * far under a minimum-only range must still show the bound it is under. The
 * padding keeps a point off the frame; a flat series gets a window of its own
 * magnitude rather than a degenerate one.
 */
function domainOf(points: readonly SeriesPoint[]): [number, number] {
  const numbers = points.flatMap((point) => [
    ...(point.value === null ? [] : [point.value]),
    ...boundsOf(point.referenceRange),
  ]);

  if (numbers.length === 0) {
    return [0, 1];
  }

  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const pad = Math.max((high - low) * 0.1, Math.abs(high) * 0.1, 1) * 0.5;

  return [low - pad, high + pad];
}

function fraction(value: number, [low, high]: [number, number]): number {
  return (value - low) / (high - low);
}

/** Clamp into the plot: a band bound outside the window still shades to the edge. */
function clamped(value: number, domain: [number, number]): number {
  return Math.min(1, Math.max(0, fraction(value, domain)));
}

/**
 * The stepped reference band.
 *
 * The range a laboratory printed belongs to the report it was printed on, so
 * it is drawn as a step that holds until the next report and no further: one
 * flat rectangle across the whole chart would assert that every laboratory
 * agreed with the most recent one, which is exactly the thing that is not
 * true. A report with no printed range opens a gap; the next one that has a
 * range restarts the band at its own x. The first report's range fills the
 * plot's left padding, and the last one's runs to the right edge, because
 * those margins belong to the reports beside them.
 */
function bandsOf(
  points: readonly SeriesPoint[],
  xs: readonly number[],
  domain: [number, number],
): TrendBand[] {
  const bands: TrendBand[] = [];

  for (const [index, point] of points.entries()) {
    const range = point.referenceRange;
    if (range === null) {
      continue;
    }

    bands.push({
      from: index === 0 ? 0 : (xs[index] ?? 0),
      to: index === points.length - 1 ? 1 : (xs[index + 1] ?? 1),
      low: range.kind === 'maxOnly' ? 0 : clamped(range.min, domain),
      high: range.kind === 'minOnly' ? 1 : clamped(range.max, domain),
    });
  }

  return bands;
}

/**
 * Runs of consecutive exact points, which are the only thing a line may join.
 *
 * A censored point is a bound, not a measurement, and an explicit `missing` is
 * a report that did not carry the marker: joining across either would draw a
 * value nobody reported. Interpolation is the failure this rule exists to
 * prevent, so a run of one point yields no line at all — the dot stands alone.
 */
function linesOf(points: readonly TrendPoint[]): number[][] {
  const lines: number[][] = [];
  let run: number[] = [];

  for (const point of points) {
    if (point.kind === 'value') {
      run.push(point.index);
      continue;
    }
    if (run.length > 1) {
      lines.push(run);
    }
    run = [];
  }

  if (run.length > 1) {
    lines.push(run);
  }

  return lines;
}

/**
 * Place one Series in the plot.
 *
 * x is proportional to elapsed civil time rather than to position in the
 * array: two results a week apart and two a year apart are not the same
 * picture, and a categorical index would draw them identically. A series whose
 * points share one moment — or holds a single point — is centred, since there
 * is no elapsed time to be proportional to.
 */
export function trendGeometry(series: Series): TrendGeometry {
  const moments = series.points.map((point) => civilMillis(point.collectedAt));
  const first = Math.min(...moments);
  const last = Math.max(...moments);
  const span = last - first;
  const xs = moments.map((moment) => (span === 0 ? 0.5 : (moment - first) / span));
  const domain = domainOf(series.points);

  const points = series.points.map((point, index): TrendPoint => {
    const kind = kindOf(point);

    return {
      index,
      x: xs[index] ?? 0.5,
      y: point.value === null || kind === 'missing' ? null : clamped(point.value, domain),
      kind,
      status: rangeStatus(point),
      labelled: false,
    };
  });

  // Direct-label the first and last quantifiable points only. Labelling every
  // point turns a chart into a table with extra steps, and the first label is
  // dropped when it would collide with the last — including when they are the
  // same point.
  const quantifiable = points.filter((point) => point.kind === 'value');
  const start = quantifiable.at(0);
  const end = quantifiable.at(-1);

  if (end !== undefined) {
    points[end.index] = { ...end, labelled: true };
  }
  if (start !== undefined && end !== undefined && end.index !== start.index) {
    points[start.index] = { ...start, labelled: Math.abs(end.x - start.x) >= LABEL_CLEARANCE };
  }

  return {
    domain,
    points,
    bands: bandsOf(series.points, xs, domain),
    lines: linesOf(points),
    empty: quantifiable.length === 0,
  };
}
