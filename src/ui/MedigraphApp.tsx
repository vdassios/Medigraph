import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { canConfirm, beginReview } from '../domain/review';
import { applyProfileChange, buildProfileChange } from '../domain/profile';
import { buildSeries } from '../domain/series';
import type { Profile, Series, SourceRef } from '../domain/types';
import { parseMedigraph, serialiseMedigraph } from '../io/fileFormat';
import { routeFiles } from '../io/fileRouter';
import { loadProfile, replaceProfile, saveProfile } from '../io/storage';
import { appReducer, initialState, inspectSource, releaseEvidence } from './appState';
import { FileDrop } from './FileDrop';
import { PanelView } from './PanelView';
import { ReviewTable } from './ReviewTable';
import type { EvidenceLookup, EvidenceResource } from './appState';

/**
 * The single Preact application island (D2), and the owner of everything the
 * reducer may not hold.
 *
 * `appState.ts` owns the transaction's shape; this module owns its I/O and its
 * resources. Every `routeFiles`, `saveProfile`, `parseMedigraph` and
 * `createObjectURL` in the app happens here, and the `Map<sourceId,
 * EvidenceResource>` below is deliberately a ref rather than state: it holds
 * File handles, object URLs and open bitmaps, none of which belong in a
 * serialisable value the app copies on every keystroke.
 *
 * **The map is emptied on all four ways a transaction can end** — Confirm,
 * Cancel, any failure and unmount — so a page crop can never outlive the review
 * that opened it.
 *
 * The regions below are Task 3.8's minimal shell, less the two that have been
 * replaced: attach is `FileDrop` (4.1) and review is `ReviewTable` (4.2);
 * the panel is `PanelView` (4.3); the trend view and data management are
 * still placeholders for Tasks 4.4 and 4.5. What
 * survives each replacement is the order the calls happen in, and the fact
 * that no child makes any of them.
 */

export function MedigraphApp(): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const { phase, profile, review, progress, routeFailures, error } = state;
  // Which Report and which Series are on screen. View state, not transaction
  // state: it survives no reload, decides nothing, and is deliberately outside
  // the reducer that owns what may be written.
  const [reportId, setReportId] = useState<string | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const aborterRef = useRef<AbortController | null>(null);
  const evidenceRef = useRef<Map<string, EvidenceResource>>(new Map());

  /** The four ways a transaction ends all run through here. */
  const release = useCallback(() => {
    releaseEvidence(evidenceRef.current, (url) => {
      URL.revokeObjectURL(url);
    });
  }, []);

  useEffect(() => {
    void loadProfile().then((stored) => {
      if (stored !== null) {
        dispatch({ type: 'profile-loaded', profile: stored });
      }
    });

    return release;
  }, [release]);

  const attach = useCallback(
    async (files: File[]) => {
      release();
      dispatch({ type: 'extract-started' });
      aborterRef.current = new AbortController();

      const batch = await routeFiles(files, aborterRef.current.signal, (progress) => {
        dispatch({ type: 'extract-progressed', progress });
      });

      // The batch's own documents are what a review would be asked to show, so
      // they are held from here until the transaction ends.
      for (const [index, result] of batch.results.entries()) {
        const file = files[index];
        if (file !== undefined) {
          evidenceRef.current.set(result.sourceId, {
            file,
            objectUrls: new Set(),
            bitmaps: new Set(),
          });
        }
      }

      dispatch({
        type: 'review-ready',
        review: beginReview(batch.results),
        routeFailures: batch.failures,
      });

      if (batch.results.length === 0) {
        release();
      }
    },
    [release],
  );

  // Confirm is the only path to persistence, and it releases the evidence it
  // was reading on the way out.
  const confirm = useCallback(async () => {
    if (review === null || !canConfirm(review, profile)) {
      return;
    }

    dispatch({ type: 'commit-started' });
    const change = buildProfileChange(review, profile);
    const next = applyProfileChange(profile, change, review.samePersonConfirmed ?? true);

    try {
      await saveProfile(next);
    } catch {
      release();
      dispatch({ type: 'failed', error: 'commit-failed' });
      return;
    }

    release();
    dispatch({ type: 'commit-succeeded', profile: next });
  }, [review, profile, release]);

  const cancel = useCallback(() => {
    aborterRef.current?.abort();
    release();
    dispatch({ type: 'cancelled' });
  }, [release]);

  const importProfile = useCallback(async (file: File) => {
    const parsed = parseMedigraph(new Uint8Array(await file.arrayBuffer()));
    if (!parsed.ok) {
      dispatch({ type: 'failed', error: parsed.error });
      return;
    }

    await replaceProfile(parsed.value);
    dispatch({ type: 'profile-loaded', profile: parsed.value });
  }, []);

  /**
   * Resolve a row's `SourceRef` to the page it came from.
   *
   * The review region is given this callback rather than the map: a child that
   * could read the map could also keep a reference into it past release, which
   * is the one thing this ownership exists to prevent.
   */
  const inspect = useCallback(
    (ref: SourceRef): EvidenceLookup =>
      inspectSource(evidenceRef.current, review?.results ?? [], ref),
    [review],
  );

  const series = useMemo(
    () => (phase === 'viewing' && profile !== null ? buildSeries(profile) : []),
    [phase, profile],
  );

  return (
    <div class="medigraph-app" data-testid="app" data-phase={phase}>
      <FileDrop
        disabled={phase === 'extracting' || phase === 'reviewing' || phase === 'committing'}
        progress={progress}
        failures={routeFailures}
        onFiles={(files) => void attach(files)}
        onCancel={cancel}
      />

      {error !== null && <p data-testid="error">{error}</p>}

      {review !== null && (
        <ReviewTable
          session={review}
          existingProfile={profile}
          onChange={(next) => {
            dispatch({ type: 'review-updated', review: next });
          }}
          onInspectSource={inspect}
          onConfirm={() => void confirm()}
          onCancel={cancel}
        />
      )}

      {phase === 'viewing' && profile !== null && (
        <>
          <PanelView
            profile={profile}
            reportId={reportId ?? profile.reports.at(-1)?.id ?? ''}
            onSelectReport={setReportId}
            onSelectSeries={setSeriesId}
          />
          <Charts
            profile={profile}
            series={series.filter((each) => seriesId === null || each.id === seriesId)}
            onImport={(file) => void importProfile(file)}
          />
        </>
      )}
    </div>
  );
}

/**
 * What is left of Task 3.8's chart primitive: the trend a panel row opens, and
 * the export/import controls Task 4.5 replaces.
 *
 * Every series prints its marker key, its normalised unit and the values the
 * laboratory reported, in collection order. No range is drawn, no point is
 * coloured, and nothing is described as high, low or improving (D13). Task 4.4
 * replaces this list with `TrendView`, which is why the panel already hands it
 * one series rather than all of them.
 */
function Charts({
  profile,
  series,
  onImport,
}: {
  profile: Profile;
  series: readonly Series[];
  onImport: (file: File) => void;
}): JSX.Element {
  const exported = useMemo(() => serialiseMedigraph(profile), [profile]);
  const href = useMemo(
    () => URL.createObjectURL(new Blob([exported], { type: 'application/json' })),
    [exported],
  );

  return (
    <section data-testid="charts">
      <p data-testid="report-count">{profile.reports.length}</p>

      <ul data-testid="series">
        {series.map((each) => (
          <li key={each.id} data-testid={`series-${each.markerKey}`}>
            <span data-testid="series-unit">{each.unit ?? ''}</span>
            <ol>
              {each.points.map((point) => (
                <li key={`${point.reportId}:${point.collectedAt.date}`} data-testid="point">
                  {point.collectedAt.date} {point.value ?? point.textValue ?? ''}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>

      <p>
        <a href={href} download="medigraph.medigraph" data-testid="export">
          Εξαγωγή
        </a>
      </p>
      <p>
        <label>
          Εισαγωγή αρχείου{' '}
          <input
            data-testid="import"
            type="file"
            onChange={(event) => {
              const [file] = [...(event.currentTarget.files ?? [])];
              if (file !== undefined) {
                onImport(file);
              }
            }}
          />
        </label>
      </p>
    </section>
  );
}
