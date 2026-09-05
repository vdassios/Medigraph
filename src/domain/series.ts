import { MARKERS } from './registry';
import { convert, normaliseUnit } from './units';
import type {
  CollectedAt,
  MarkerDef,
  Measurement,
  Profile,
  ReferenceRange,
  Report,
  Series,
  SeriesPoint,
} from './types';

/**
 * A Profile's Reports, realigned into one series per marker.
 *
 * Two rules decide everything here, and both exist to stop a chart from
 * asserting something the laboratory did not.
 *
 * **Never plot mismatched units on one axis (D12).** A canonical marker's
 * series is stated in the registry's `canonicalUnit`, and a measurement printed
 * in a unit that converts to it is converted — value and reference bounds by
 * the same positive factor, so the value never moves relative to its own range.
 * A unit that neither matches nor converts is not coerced: it becomes a
 * separate series the UI links to the first, because a number whose unit
 * nobody can reconcile is not the same quantity.
 *
 * **Never synthesise a measurement.** A Report that did not report a marker
 * contributes no point. Only a `status: 'missing'` Measurement — a result cell
 * the laboratory printed empty — becomes a point, and it keeps whatever range
 * was printed beside it. The gap in the chart is a fact about the document.
 */

const BY_ID = new Map<string, MarkerDef>(MARKERS.map((marker) => [marker.id, marker]));

/** `none` names the group of measurements printed without a unit. */
const NONE = 'none';

interface Grouped {
  markerKey: string;
  unit: string | null;
  label: string | null;
  points: { point: SeriesPoint; at: number }[];
}

/**
 * Which series a measurement belongs to, and in what unit it is stated.
 *
 * A canonical marker has one series unless a measurement forces a second: the
 * unit has to be present, differ from the canonical one, and have no
 * conversion. A valueless measurement — `missing`, or a categorical result —
 * carries no unit to reconcile and so never splits its marker; splitting on
 * absence would strand an empty result in a series of its own and lose the very
 * gap it records.
 */
function target(measurement: Measurement, marker: MarkerDef | undefined): string | null {
  const native = measurement.unit === null ? null : normaliseUnit(measurement.unit);

  if (marker === undefined) {
    return native;
  }
  if (native === null || native === marker.canonicalUnit) {
    return marker.canonicalUnit;
  }
  if (
    marker.canonicalUnit !== null &&
    convert(1, native, marker.canonicalUnit, marker.id) !== null
  ) {
    return marker.canonicalUnit;
  }

  return native;
}

/** Restate one bound in the series' unit, keeping the interval's shape. */
function converted(
  range: ReferenceRange | null,
  factor: (value: number) => number,
): ReferenceRange | null {
  if (range === null) {
    return null;
  }
  if (range.kind === 'closed') {
    return { kind: 'closed', min: factor(range.min), max: factor(range.max) };
  }
  if (range.kind === 'minOnly') {
    return { kind: 'minOnly', comparator: range.comparator, min: factor(range.min) };
  }

  return { kind: 'maxOnly', comparator: range.comparator, max: factor(range.max) };
}

/**
 * One Measurement, restated in its series' unit.
 *
 * The native fields are always the document's own numbers, converted or not, so
 * review and the evidence crop can show what was printed rather than what was
 * computed from it. A comparator survives conversion unchanged: the factor is
 * positive, so `< 100 mg/dL` is still a `<` in mmol/L.
 */
function pointOf(report: Report, measurement: Measurement, unit: string | null): SeriesPoint {
  const native = measurement.unit === null ? null : normaliseUnit(measurement.unit);
  const factor =
    native !== null && unit !== null && native !== unit
      ? (value: number): number => convert(value, native, unit, measurement.markerKey) ?? value
      : null;

  return {
    reportId: report.id,
    collectedAt: report.collectedAt,
    status: measurement.status,
    value:
      measurement.value === null || factor === null ? measurement.value : factor(measurement.value),
    comparator: measurement.comparator,
    textValue: measurement.textValue,
    referenceRange:
      factor === null ? measurement.referenceRange : converted(measurement.referenceRange, factor),
    categoricalReference: measurement.categoricalReference,
    nativeValue: measurement.value,
    nativeUnit: measurement.unit,
    nativeReferenceRange: measurement.referenceRange,
  };
}

/** Local civil order. No timezone is applied; these are the printed values. */
function moment(collectedAt: CollectedAt): string {
  return `${collectedAt.date}T${collectedAt.time ?? ''}`;
}

/**
 * Every marker's history, in the order the Profile tells it.
 *
 * Series come out in first-appearance order — the order the documents printed
 * their markers in — and points in local civil date order. Both sorts are
 * stable, so two things the ordering cannot separate keep the order the
 * Profile stored them in, and the same Profile always yields the same arrays.
 */
export function buildSeries(profile: Profile): Series[] {
  const groups = new Map<string, Grouped>();
  let seen = 0;

  for (const report of profile.reports) {
    for (const measurement of report.measurements) {
      const marker = BY_ID.get(measurement.markerKey);
      const unit = target(measurement, marker);
      const id = `${measurement.markerKey}@${unit ?? NONE}`;

      const group = groups.get(id) ?? {
        markerKey: measurement.markerKey,
        unit,
        label: marker?.en ?? measurement.label ?? null,
        points: [],
      };

      group.points.push({ point: pointOf(report, measurement, unit), at: seen });
      groups.set(id, group);
      seen += 1;
    }
  }

  return [...groups].map(([id, group]) => ({
    id,
    markerKey: group.markerKey,
    label: group.label ?? group.markerKey,
    unit: group.unit,
    points: [...group.points]
      .sort(
        (a, b) =>
          moment(a.point.collectedAt).localeCompare(moment(b.point.collectedAt)) || a.at - b.at,
      )
      .map((each) => each.point),
  }));
}
