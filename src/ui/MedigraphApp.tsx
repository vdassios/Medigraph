import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'preact/hooks';
import {
  canConfirm,
  beginReview,
  approveUnknownMarker,
  resolveConflict,
  resolveIdentifier,
} from '../domain/review';
import { applyProfileChange, buildProfileChange, setReportDate } from '../domain/profile';
import { buildSeries } from '../domain/series';
import type { ParsedRow, Profile, ReviewSession, Series, SourceRef } from '../domain/types';
import { parseMedigraph, serialiseMedigraph } from '../io/fileFormat';
import { routeFiles } from '../io/fileRouter';
import { loadProfile, replaceProfile, saveProfile } from '../io/storage';
import { appReducer, initialState, inspectSource, releaseEvidence } from './appState';
import { FileDrop } from './FileDrop';
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
 * The regions below are Task 3.8's minimal shell, less the one Task 4.1 has
 * replaced: attach is now `FileDrop`, and review, charts and data management
 * are still placeholders for Tasks 4.2–4.5. What survives each replacement is
 * the order the calls happen in, and the fact that no child makes any of them.
 */

export function MedigraphApp(): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const { phase, profile, review, progress, routeFailures, error } = state;
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
        <Review
          review={review}
          profile={profile}
          onChange={(next) => {
            dispatch({ type: 'review-updated', review: next });
          }}
          onInspectSource={inspect}
          onConfirm={() => void confirm()}
          onCancel={cancel}
        />
      )}

      {phase === 'viewing' && profile !== null && (
        <Charts profile={profile} series={series} onImport={(file) => void importProfile(file)} />
      )}
    </div>
  );
}

/**
 * Every gate D6 and D7 name, one control each.
 *
 * Deliberately unstyled and ungrouped: this is the list of answers the user
 * owes before Confirm may run, and Task 4.2 turns it into a table. What the
 * slice proves is that no gate can be skipped, so each renders even when there
 * is nothing to answer.
 */
function Review({
  review,
  profile,
  onChange,
  onInspectSource,
  onConfirm,
  onCancel,
}: {
  review: ReviewSession;
  profile: Profile | null;
  onChange: (session: ReviewSession) => void;
  onInspectSource: (ref: SourceRef) => EvidenceLookup;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const unknownRows = review.reportDrafts.flatMap((draft) =>
    draft.rows.filter(
      (row) => row.markerKey.startsWith('x:') && !review.approvedUnknownRowIds.includes(row.id),
    ),
  );

  return (
    <section
      data-testid="review"
      // Surfaced so the walking slice can assert it from outside the app: a
      // result carrying a different vocabulary is a different result, and
      // nothing else in the DOM would show it.
      data-registry-version={review.results.map((result) => result.registryVersion).join(',')}
    >
      {review.reportDrafts.map((draft) => (
        <article key={draft.id} data-testid={`draft-${draft.sourceIds.join('+')}`}>
          <p data-testid="draft-rows">{draft.rows.length}</p>
          <Evidence rows={draft.rows} onInspectSource={onInspectSource} />
          <p>
            <span data-testid="draft-date">{draft.collectedAt?.date ?? ''}</span>{' '}
            <button
              type="button"
              data-testid="confirm-date"
              disabled={draft.dateConfirmed || draft.collectedAt === null}
              onClick={() => {
                if (draft.collectedAt !== null) {
                  onChange(setReportDate(review, draft.id, draft.collectedAt));
                }
              }}
            >
              Επιβεβαίωση ημερομηνίας
            </button>
          </p>

          {draft.conflicts
            .filter((conflict) => conflict.resolution === null)
            .map((conflict) => (
              <button
                key={conflict.id}
                type="button"
                data-testid={`resolve-conflict-${conflict.markerKey}`}
                onClick={() => {
                  const [rowId] = conflict.candidateRowIds;
                  if (rowId !== undefined) {
                    onChange(resolveConflict(review, conflict.id, { kind: 'choose', rowId }));
                  }
                }}
              >
                {conflict.markerKey}
              </button>
            ))}
        </article>
      ))}

      {review.results.flatMap((result) =>
        result.identifierCandidates
          .filter((candidate) => review.identifierResolutions[candidate.id] === undefined)
          .map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              data-testid="redact-identifier"
              onClick={() => {
                onChange(resolveIdentifier(review, candidate.id, 'redacted'));
              }}
            >
              {candidate.kind}
            </button>
          )),
      )}

      {unknownRows.map((row) => (
        <button
          key={row.id}
          type="button"
          data-testid="approve-unknown"
          onClick={() => {
            onChange(approveUnknownMarker(review, row.id));
          }}
        >
          {row.label}
        </button>
      ))}

      <p>
        <button
          type="button"
          data-testid="confirm"
          disabled={!canConfirm(review, profile)}
          onClick={onConfirm}
        >
          Οριστικοποίηση
        </button>{' '}
        <button type="button" data-testid="cancel" onClick={onCancel}>
          Ακύρωση
        </button>
      </p>
    </section>
  );
}

/**
 * What the review can show of the document a row came from.
 *
 * Every refusal is rendered rather than swallowed, because each says something
 * different to the person reading: a source whose evidence has been released is
 * not the same as an adapter that never had any, and a page outside the
 * document is a bug worth seeing rather than a crop worth guessing at. Task 4.2
 * turns this into the crop beside the row; what it must keep is asking the
 * island rather than holding the map.
 */
function Evidence({
  rows,
  onInspectSource,
}: {
  rows: readonly ParsedRow[];
  onInspectSource: (ref: SourceRef) => EvidenceLookup;
}): JSX.Element | null {
  const ref = rows.find((row) => row.sourceRef !== undefined)?.sourceRef;
  if (ref === undefined) {
    return null;
  }

  const found = onInspectSource(ref);

  return (
    <p data-testid="evidence" data-kind={found.kind}>
      {found.kind === 'evidence'
        ? `${found.resource.file.name} p${String(found.page)}`
        : found.kind}
    </p>
  );
}

/**
 * The panel and trend primitives, and nothing beyond them (D13).
 *
 * Every series prints its marker key, its normalised unit and the values the
 * laboratory reported, in collection order. No range is drawn, no point is
 * coloured, and nothing is described as high, low or improving: this shows
 * what was measured and says nothing about it.
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
