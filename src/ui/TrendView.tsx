import type { JSX, TargetedPointerEvent } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { MARKERS } from '../domain/registry';
import type { Series, SeriesPoint } from '../domain/types';
import type { TrendPoint } from './trendGeometry';
import { trendGeometry } from './trendGeometry';
import type { Copy } from './i18n';
import { useCopy } from './i18n';
import '../styles/viz.css';

/**
 * One marker over time, and no opinion about the shape it makes.
 *
 * The chart is hand-written SVG over `trendGeometry`'s fractions: no chart
 * library, one series, one y-axis, never a second marker on a second scale
 * (D12). Every mark is traceable to something a laboratory printed — a value,
 * the range beside it, or the bound it reported instead of a value.
 *
 * **Nothing here names a direction** (D13). No slope, no trend line, no
 * "rising" or "improving", no delta since last and no projection: the chart
 * shows what was reported and when, and the reader draws the conclusion. That
 * rule binds the title, the summary, the tooltip and the table alike.
 *
 * The table is not a fallback. It carries the same five columns the plot draws
 * from and is the primary path for assistive technology, which is why the SVG
 * is a labelled `<figure>` and never the only place a value appears.
 *
 * Every string it shows comes from `i18n.ts`, in the reader's language.
 */

export interface TrendViewProps {
  series: Series;
  onBack(): void;
}

/** The plot box, in user units. The SVG scales; these numbers never do. */
const PLOT = { width: 320, height: 160, padLeft: 8, padRight: 8, padTop: 8, padBottom: 8 } as const;

function seriesName(series: Series): string {
  const marker = MARKERS.find((each) => each.id === series.markerKey);

  return marker?.el ?? series.label;
}

function printedValue(point: SeriesPoint): string {
  if (point.status === 'categorical') {
    return point.textValue ?? '—';
  }
  if (point.status === 'missing' || point.value === null) {
    return '—';
  }

  return `${point.comparator ?? ''}${String(point.value)}`;
}

function printedRange(point: SeriesPoint): string {
  const range = point.referenceRange;
  if (range === null) {
    return point.categoricalReference ?? '';
  }
  if (range.kind === 'closed') {
    return `${String(range.min)}–${String(range.max)}`;
  }

  return range.kind === 'minOnly'
    ? `${range.comparator}${String(range.min)}`
    : `${range.comparator}${String(range.max)}`;
}

function printedDate(point: SeriesPoint): string {
  const { date, time } = point.collectedAt;

  return time === null ? date : `${date} ${time}`;
}

/** Fractions to user units. y is flipped: a fraction of 1 is the top of the plot. */
function toX(fraction: number): number {
  return PLOT.padLeft + fraction * (PLOT.width - PLOT.padLeft - PLOT.padRight);
}

function toY(fraction: number): number {
  return PLOT.padTop + (1 - fraction) * (PLOT.height - PLOT.padTop - PLOT.padBottom);
}

export function TrendView(props: TrendViewProps): JSX.Element {
  const { series } = props;
  const copy = useCopy().trend;
  const disclaimer = useCopy().disclaimer.displayOnly;
  const statusText = useCopy().panel.status;
  const geometry = useMemo(() => trendGeometry(series), [series]);
  const [tabular, setTabular] = useState(false);
  const [focused, setFocused] = useState<number | null>(null);

  const name = seriesName(series);
  // The unit is part of the title because a split-unit marker is two separate
  // series (D12 forbids overlaying them), and the title is what tells them
  // apart wherever one of them is opened from.
  const title = series.unit === null ? name : `${name} (${series.unit})`;
  const first = series.points.at(0);
  const last = series.points.at(-1);
  const summary =
    first === undefined || last === undefined
      ? copy.noRecords
      : copy.summary(series.points.length, printedDate(first), printedDate(last));

  return (
    <section class="viz-root trend" data-testid="trend" aria-labelledby="trend-title">
      <p>
        <button
          type="button"
          data-testid="trend-back"
          onClick={() => {
            props.onBack();
          }}
        >
          {copy.back}
        </button>{' '}
        <button
          type="button"
          data-testid="trend-table-toggle"
          aria-pressed={tabular}
          onClick={() => {
            setTabular(!tabular);
          }}
        >
          {tabular ? copy.hideTable : copy.showTable}
        </button>
      </p>

      <h2 id="trend-title" data-testid="trend-title">
        {title}
      </h2>
      <p data-testid="trend-summary">{summary}</p>

      {geometry.empty && <p data-testid="trend-no-values">{copy.noValues}</p>}

      {!tabular && (
        <figure data-testid="trend-figure" aria-labelledby="trend-title trend-summary">
          <svg
            class="trend-plot"
            data-testid="trend-plot"
            viewBox={`0 0 ${String(PLOT.width)} ${String(PLOT.height)}`}
            role="img"
            aria-label={`${title}. ${summary}`}
            onPointerMove={(event) => {
              setFocused(nearest(event, geometry.points));
            }}
            onPointerLeave={() => {
              setFocused(null);
            }}
          >
            {geometry.bands.map((band) => (
              <rect
                key={`${String(band.from)}:${String(band.low ?? 0)}:${String(band.high ?? 1)}`}
                class="trend-band"
                x={toX(band.from)}
                y={toY(band.high ?? 1)}
                width={toX(band.to) - toX(band.from)}
                height={toY(band.low ?? 0) - toY(band.high ?? 1)}
              />
            ))}

            {geometry.lines.map((line) => (
              <polyline
                key={line.join(',')}
                class="trend-line"
                fill="none"
                points={line
                  .map((index) => {
                    const point = geometry.points[index];

                    return `${String(toX(point?.x ?? 0))},${String(toY(point?.y ?? 0))}`;
                  })
                  .join(' ')}
              />
            ))}

            {geometry.points.map((point) => (
              <Mark
                key={point.index}
                point={point}
                reported={series.points[point.index]}
                focused={focused === point.index}
              />
            ))}
          </svg>

          <figcaption data-testid="trend-caption">
            {focused === null
              ? disclaimer
              : describe(series.points[focused], geometry.points[focused], copy, statusText)}
          </figcaption>
        </figure>
      )}

      {/*
        The same five columns the plot is drawn from. Not a fallback: this is
        the path assistive technology takes, and no value in this view exists
        only as a shape.
      */}
      {tabular && (
        <table class="trend-table" data-testid="trend-table">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{copy.columns.date}</th>
              <th scope="col">{copy.columns.value}</th>
              <th scope="col">{copy.columns.unit}</th>
              <th scope="col">{copy.columns.range}</th>
              <th scope="col">{copy.columns.status}</th>
            </tr>
          </thead>
          <tbody>
            {series.points.map((point, index) => (
              <tr key={`${point.reportId}:${point.collectedAt.date}`} data-testid="trend-row">
                <th scope="row">{printedDate(point)}</th>
                <td>{printedValue(point)}</td>
                <td>{point.nativeUnit ?? series.unit ?? ''}</td>
                <td>{printedRange(point)}</td>
                <td>{statusText[geometry.points[index]?.status ?? 'unavailable']}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p class="panel-disclaimer" data-testid="trend-disclaimer">
        {disclaimer}
      </p>
    </section>
  );
}

/**
 * One point: a filled dot for a measurement, a hollow caret for a bound.
 *
 * A censored point is drawn at the bound the laboratory reported, hollow and
 * carrying the caret it printed, because it is a statement about where the
 * value is not rather than a reading of where it is. It is never joined to its
 * neighbours; `trendGeometry` leaves it out of the line for the same reason.
 */
function Mark({
  point,
  reported,
  focused,
}: {
  point: TrendPoint;
  reported: SeriesPoint | undefined;
  focused: boolean;
}): JSX.Element | null {
  const copy = useCopy().trend;

  if (point.y === null || reported === undefined) {
    return null;
  }

  const x = toX(point.x);
  const y = toY(point.y);

  return (
    <g data-testid={`trend-point-${String(point.index)}`} data-kind={point.kind}>
      {point.kind === 'censored' ? (
        <>
          <circle class="trend-mark-hollow" data-status={point.status} cx={x} cy={y} r="5" />
          <text class="trend-caret" x={x} y={y + 3} text-anchor="middle">
            {reported.comparator ?? ''}
          </text>
          <title>{copy.censored}</title>
        </>
      ) : (
        <circle class="trend-mark" data-status={point.status} cx={x} cy={y} r="5" />
      )}

      {(point.labelled || focused) && (
        <text
          class="trend-label"
          data-testid={`trend-label-${String(point.index)}`}
          x={x}
          y={y - 10}
          text-anchor="middle"
        >
          {printedValue(reported)}
        </text>
      )}

      {focused && (
        <line
          class="trend-crosshair"
          x1={x}
          y1={PLOT.padTop}
          x2={x}
          y2={PLOT.height - PLOT.padBottom}
        />
      )}
    </g>
  );
}

/** The nearest point to the pointer, in x only: one series, one row of marks. */
function nearest(
  event: TargetedPointerEvent<SVGSVGElement>,
  points: readonly TrendPoint[],
): number | null {
  const box = event.currentTarget.getBoundingClientRect();
  if (box.width === 0) {
    return null;
  }

  const x = ((event.clientX - box.left) / box.width) * PLOT.width;
  let best: TrendPoint | null = null;

  for (const point of points) {
    if (point.y === null) {
      continue;
    }
    if (best === null || Math.abs(toX(point.x) - x) < Math.abs(toX(best.x) - x)) {
      best = point;
    }
  }

  return best?.index ?? null;
}

/** What the focused point says, in the same words the table uses. */
function describe(
  reported: SeriesPoint | undefined,
  placed: TrendPoint | undefined,
  copy: Copy['trend'],
  statusText: Copy['panel']['status'],
): string {
  if (reported === undefined || placed === undefined) {
    return '';
  }

  const censored = placed.kind === 'censored' ? ` ${copy.censored}` : '';

  return `${printedDate(reported)}: ${printedValue(reported)} ${reported.nativeUnit ?? ''} — ${statusText[placed.status]}.${censored}`;
}
