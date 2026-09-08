import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { MARKERS } from '../domain/registry';
import { buildSeries } from '../domain/series';
import type { Measurement, Profile, ReferenceRange, Report, Series } from '../domain/types';
import type { Meter, RangeStatus } from './panelMeter';
import { meterOf, rangeStatus } from './panelMeter';
import '../styles/viz.css';

/**
 * One Report, one row per marker, and not one word about what any of it means.
 *
 * Twenty-five markers is a list rather than a chart, so this is a list. Each
 * row states the value the laboratory reported, the unit it reported it in,
 * the range it printed beside it, and where the one sits against the other —
 * `within`, `below`, `above`, or that the comparison cannot be made. There is
 * no severity, no good or bad, no distance-outside heuristic and no direction
 * over time; every status here is traceable to a bound printed on the user's
 * own document (D13, ADR-0010).
 *
 * The arithmetic is `panelMeter.ts`. What this module adds is the reading
 * order — the rows the laboratory's own range puts outside come first — and
 * the fact that status is stated three ways at once: in words, in an icon and
 * in colour, so nothing is carried by hue alone.
 *
 * The copy is Greek and inline until Task 4.6's `el`/`en` toggle; every string
 * a person reads is a whole sentence in `TEXT` or in the JSX below.
 */

export interface PanelViewProps {
  profile: Profile;
  reportId: string;
  onSelectReport(reportId: string): void;
  onSelectSeries(seriesId: string): void;
}

const TEXT = {
  heading: 'Αποτελέσματα εξέτασης',
  reports: 'Επιλογή εξέτασης',
  empty: 'Δεν υπάρχει καμία αποθηκευμένη εξέταση.',
  emptyReport: 'Η εξέταση αυτή δεν περιέχει κανένα αποτέλεσμα.',
  missing: '—',
  noRange: 'Το εργαστήριο δεν τύπωσε τιμές αναφοράς.',
  splitUnit: 'Ο δείκτης αυτός έχει καταγραφεί και σε άλλη μονάδα· οι δύο σειρές δεν συγχωνεύονται.',
  disclaimer:
    'Το Medigraph εμφανίζει όσα ανέφερε το εργαστήριό σας, μαζί με τις τιμές αναφοράς που τύπωσε το ίδιο. Δεν τα ερμηνεύει και δεν αποτελεί ιατρική συμβουλή.',
} as const;

const STATUS_TEXT: Record<RangeStatus, string> = {
  within: 'εντός των τιμών αναφοράς που ανέφερε το εργαστήριο',
  below: 'κάτω από τις τιμές αναφοράς που ανέφερε το εργαστήριο',
  above: 'πάνω από τις τιμές αναφοράς που ανέφερε το εργαστήριο',
  unavailable: 'χωρίς σύγκριση με τιμές αναφοράς',
};

/** Direction, not judgement: an arrow says which side of a printed bound. */
const STATUS_ICON: Record<RangeStatus, string> = {
  within: '•',
  below: '↓',
  above: '↑',
  unavailable: '?',
};

function markerName(measurement: Measurement): string {
  const marker = MARKERS.find((each) => each.id === measurement.markerKey);

  return marker?.el ?? measurement.label ?? measurement.markerKey;
}

/** The value as the laboratory reported it, in its own unit. */
function printedValue(measurement: Measurement): string {
  if (measurement.status === 'categorical') {
    return measurement.textValue ?? TEXT.missing;
  }
  if (measurement.status === 'missing' || measurement.value === null) {
    return TEXT.missing;
  }

  return `${measurement.comparator ?? ''}${String(measurement.value)}`;
}

function printedRange(range: ReferenceRange | null): string {
  if (range === null) {
    return '';
  }
  if (range.kind === 'closed') {
    return `${String(range.min)}–${String(range.max)}`;
  }

  return range.kind === 'minOnly'
    ? `${range.comparator}${String(range.min)}`
    : `${range.comparator}${String(range.max)}`;
}

/**
 * The reference the laboratory printed, whichever kind it printed.
 *
 * A categorical result's expected string is a reference too — `Αρνητικό`
 * beside `Αρνητικό` — and a row with neither says so, rather than leaving a
 * blank a reader would have to interpret.
 */
function printedReference(measurement: Measurement): string {
  const range = printedRange(measurement.referenceRange);
  if (range !== '') {
    return range;
  }

  return measurement.categoricalReference ?? TEXT.noRange;
}

interface PanelRow {
  measurement: Measurement;
  status: RangeStatus;
  meter: Meter | null;
  series: Series | null;
  splitUnit: boolean;
}

/**
 * What the laboratory's own range put outside, first.
 *
 * This is a reading order and not a ranking: nothing here says one row matters
 * more than another, only that a row whose printed range the value falls
 * outside of is the one a reader is looking for. Everything else keeps
 * `sourceOrder` — the order the document itself printed — and a result the
 * laboratory did not report sits last, still visible and still tappable.
 */
function panelOrder(a: PanelRow, b: PanelRow): number {
  const rank = (row: PanelRow): number => {
    if (row.status === 'below' || row.status === 'above') {
      return 0;
    }

    return row.measurement.status === 'missing' ? 2 : 1;
  };

  return rank(a) - rank(b) || a.measurement.sourceOrder - b.measurement.sourceOrder;
}

export function PanelView(props: PanelViewProps): JSX.Element {
  const { profile, reportId } = props;
  const series = useMemo(() => buildSeries(profile), [profile]);
  const report: Report | undefined = profile.reports.find((each) => each.id === reportId);

  const rows = useMemo(() => {
    const built = (report?.measurements ?? []).map((measurement): PanelRow => {
      const forMarker = series.filter((each) => each.markerKey === measurement.markerKey);

      return {
        measurement,
        status: rangeStatus(measurement),
        meter: meterOf(measurement),
        series:
          forMarker.find((each) => each.points.some((point) => point.reportId === reportId)) ??
          null,
        splitUnit: forMarker.length > 1,
      };
    });

    return built.sort(panelOrder);
  }, [report, series, reportId]);

  return (
    <section class="viz-root panel" data-testid="panel" aria-labelledby="panel-heading">
      <h2 id="panel-heading">{TEXT.heading}</h2>

      {profile.reports.length === 0 ? (
        <p data-testid="panel-empty">{TEXT.empty}</p>
      ) : (
        <div
          class="panel-reports"
          role="group"
          aria-label={TEXT.reports}
          data-testid="panel-reports"
        >
          {profile.reports.map((each) => (
            <button
              key={each.id}
              type="button"
              data-testid={`select-report-${each.id}`}
              aria-current={each.id === reportId ? 'true' : undefined}
              onClick={() => {
                props.onSelectReport(each.id);
              }}
            >
              {each.collectedAt.date}
              {each.collectedAt.time === null ? '' : ` ${each.collectedAt.time}`}
            </button>
          ))}
        </div>
      )}

      {report !== undefined && rows.length === 0 && (
        <p data-testid="panel-empty-report">{TEXT.emptyReport}</p>
      )}

      <ul class="panel-rows" data-testid="panel-rows">
        {rows.map((row) => (
          <PanelRowView key={row.measurement.markerKey} row={row} {...props} />
        ))}
      </ul>

      {/*
        Always visible, never dismissible: this is what keeps the product a
        display of the user's own record rather than an opinion about it (D13).
      */}
      <p class="panel-disclaimer" data-testid="panel-disclaimer">
        {TEXT.disclaimer}
      </p>
    </section>
  );
}

/**
 * One row, and one 44 px target.
 *
 * The button's accessible name is its own text — marker, value, unit and the
 * status in words — rather than an `aria-label` restating them, because a
 * label and a body that can drift apart eventually do. The meter is decorative
 * beside that text and is hidden from assistive technology for the same
 * reason: it says nothing the sentence does not.
 */
function PanelRowView(props: PanelViewProps & { row: PanelRow }): JSX.Element {
  const { measurement, status, meter, series, splitUnit } = props.row;
  const unit = measurement.unit ?? '';

  return (
    <li>
      <button
        type="button"
        class="panel-row"
        data-testid={`panel-row-${measurement.markerKey}`}
        data-status={status}
        disabled={series === null}
        onClick={() => {
          if (series !== null) {
            props.onSelectSeries(series.id);
          }
        }}
      >
        <span class="panel-row-name">
          <span data-testid="row-name">
            {markerName(measurement)}
            {splitUnit && unit !== '' ? ` (${unit})` : ''}
          </span>
          {splitUnit && <span data-testid="row-split-unit"> {TEXT.splitUnit}</span>}
        </span>

        <span class="panel-row-result">
          <span class="panel-value" data-testid="row-value">
            {printedValue(measurement)} {unit}
          </span>
          <span class="panel-range" data-testid="row-range">
            {printedReference(measurement)}
          </span>
          {meter !== null && <MeterBar meter={meter} status={status} />}
          <span class="panel-status" data-testid="row-status" data-status={status}>
            <span aria-hidden="true">{STATUS_ICON[status]}</span> {STATUS_TEXT[status]}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The rail, the band the laboratory printed, and where the value sits on it.
 *
 * Geometry arrives as fractions from `panelMeter.ts` and is written as SVG
 * presentation attributes — `x`, `width`, `cx` — which are markup, not CSS, so
 * no `style-src` directive applies to any of it. Colour comes from a class.
 */
function MeterBar({ meter, status }: { meter: Meter; status: RangeStatus }): JSX.Element {
  const [from, to] = meter.band;

  return (
    <svg
      class="panel-meter"
      data-testid="row-meter"
      data-kind={meter.kind}
      data-clamped={meter.clamped ?? 'none'}
      viewBox="0 0 100 12"
      width="100"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <rect class="panel-meter-rail" x="0" y="4" width="100" height="4" rx="2" />
      <rect
        class="panel-meter-band"
        x={from * 100}
        y="4"
        width={(to - from) * 100}
        height="4"
        rx="2"
      />
      {meter.kind !== 'closed' && (
        <rect
          class="panel-meter-bound"
          x={(meter.kind === 'minOnly' ? from : to) * 100 - 0.5}
          y="2"
          width="1"
          height="8"
        />
      )}
      {meter.clamped === null ? (
        <circle class="panel-meter-dot" data-status={status} cx={meter.dot * 100} cy="6" r="4" />
      ) : (
        <polygon
          class="panel-meter-dot"
          data-status={status}
          points={meter.clamped === 'high' ? '94,2 100,6 94,10' : '6,2 0,6 6,10'}
        />
      )}
    </svg>
  );
}
