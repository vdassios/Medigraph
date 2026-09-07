import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  canConfirm,
  beginReview,
  approveUnknownMarker,
  resolveConflict,
  resolveIdentifier,
} from '../domain/review';
import { applyProfileChange, buildProfileChange, setReportDate } from '../domain/profile';
import { buildSeries } from '../domain/series';
import type { Profile, ReviewSession, Series } from '../domain/types';
import { parseMedigraph, serialiseMedigraph } from '../io/fileFormat';
import { routeFiles } from '../io/fileRouter';
import type { RouteFailure } from '../io/fileRouter';
import { loadProfile, replaceProfile, saveProfile } from '../io/storage';

/**
 * The single Preact application island (D2), as the E0 walking slice needs it.
 *
 * This is Task 3.8's minimal shell, not the product's review screen: it owns
 * every I/O call and every state transition the slice has to cross — attach,
 * review, the one atomic Confirm, persistence, the chart primitive and
 * plaintext export/import — with the smallest surface that can cross them.
 * Task 4.0 replaces the state below with `appState.ts`'s reducer, and Tasks
 * 4.1–4.5 replace each region with a real component. Nothing here should
 * survive that; what has to survive is the order the calls happen in.
 *
 * Two rules it exists to hold, because the tests assert them from outside:
 * **nothing is persisted or charted before Confirm** (D6), and the review
 * session — which holds every page of evidence — is dropped the moment the
 * transaction ends, whether it was confirmed or cancelled.
 */

type Phase = 'idle' | 'extracting' | 'reviewing' | 'viewing';

export function MedigraphApp(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [review, setReview] = useState<ReviewSession | null>(null);
  const [failures, setFailures] = useState<RouteFailure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const aborterRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadProfile().then((stored) => {
      if (stored !== null) {
        setProfile(stored);
        setPhase('viewing');
      }
    });
  }, []);

  const attach = useCallback(
    async (files: File[]) => {
      setError(null);
      setFailures([]);
      setPhase('extracting');
      aborterRef.current = new AbortController();

      const batch = await routeFiles(files, aborterRef.current.signal, () => undefined);
      setFailures(batch.failures);

      if (batch.results.length === 0) {
        setPhase(profile === null ? 'idle' : 'viewing');
        return;
      }

      setReview(beginReview(batch.results));
      setPhase('reviewing');
    },
    [profile],
  );

  // Confirm is the only path to persistence, and it releases the evidence it
  // was reading on the way out.
  const confirm = useCallback(async () => {
    if (review === null || !canConfirm(review, profile)) {
      return;
    }

    const change = buildProfileChange(review, profile);
    const next = applyProfileChange(profile, change, review.samePersonConfirmed ?? true);

    try {
      await saveProfile(next);
    } catch {
      setError('commit-failed');
      return;
    }

    setReview(null);
    setProfile(next);
    setPhase('viewing');
  }, [review, profile]);

  const cancel = useCallback(() => {
    setReview(null);
    setFailures([]);
    setPhase(profile === null ? 'idle' : 'viewing');
  }, [profile]);

  const importProfile = useCallback(async (file: File) => {
    const parsed = parseMedigraph(new Uint8Array(await file.arrayBuffer()));
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    await replaceProfile(parsed.value);
    setProfile(parsed.value);
    setError(null);
    setPhase('viewing');
  }, []);

  const series = useMemo(
    () => (phase === 'viewing' && profile !== null ? buildSeries(profile) : []),
    [phase, profile],
  );

  return (
    <div class="medigraph-app" data-testid="app" data-phase={phase}>
      <Attach onFiles={attach} disabled={phase === 'extracting' || phase === 'reviewing'} />

      {failures.length > 0 && (
        <ul data-testid="failures">
          {failures.map((failure) => (
            <li key={`${failure.scope}:${failure.code}`} data-testid={`failure-${failure.code}`}>
              {failure.scope === 'source' ? failure.fileName : 'batch'}: {failure.code}
            </li>
          ))}
        </ul>
      )}

      {error !== null && <p data-testid="error">{error}</p>}

      {review !== null && (
        <Review
          review={review}
          profile={profile}
          onChange={setReview}
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

function Attach({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => Promise<void>;
  disabled: boolean;
}): JSX.Element {
  return (
    <p>
      <label>
        Επισύναψη εγγράφου{' '}
        <input
          data-testid="attach"
          type="file"
          accept="application/pdf"
          multiple
          disabled={disabled}
          onChange={(event) => {
            const chosen = [...(event.currentTarget.files ?? [])];
            if (chosen.length > 0) {
              void onFiles(chosen);
            }
          }}
        />
      </label>
    </p>
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
  onConfirm,
  onCancel,
}: {
  review: ReviewSession;
  profile: Profile | null;
  onChange: (session: ReviewSession) => void;
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
