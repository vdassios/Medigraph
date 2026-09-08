import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { canConfirm, beginReview } from '../domain/review';
import {
  applyProfileChange,
  applyProfileMerge,
  buildProfileChange,
  removeReport,
} from '../domain/profile';
import { buildSeries } from '../domain/series';
import type { ProfileMergePlan, SourceRef } from '../domain/types';
import { previewImport, serialiseMedigraph } from '../io/fileFormat';
import type { ImportPreview, MedigraphReadError } from '../io/fileFormat';
import { routeFiles } from '../io/fileRouter';
import {
  clearAll,
  loadProfile,
  replaceProfile,
  requestStoragePersistence,
  saveProfile,
} from '../io/storage';
import { appReducer, initialState, inspectSource, releaseEvidence } from './appState';
import { FileDrop } from './FileDrop';
import { DataManager } from './DataManager';
import type { Language } from './i18n';
import { COPY, LanguageContext, detectLanguage, loadLanguage, saveLanguage } from './i18n';
import { PanelView } from './PanelView';
import { TrendView } from './TrendView';
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
 * the panel is `PanelView` (4.3), the trend is `TrendView` (4.4) and the data
 * screen is `DataManager` (4.5). What
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
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<MedigraphReadError | null>(null);
  const [persistenceGranted, setPersistenceGranted] = useState<boolean | null>(null);
  // Greek until the browser is asked, which happens on mount: a stored choice
  // if the reader has made one, otherwise whatever their browser asks for.
  const [language, setLanguage] = useState<Language>('el');
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

    // Asked once, at the only moment the answer is actionable: a user the
    // browser refuses to persist for is one who needs the export nudge.
    void requestStoragePersistence().then(setPersistenceGranted);

    setLanguage(loadLanguage() ?? detectLanguage(navigator.languages));

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

  /**
   * Read a `.medigraph` file into a preview, and write nothing.
   *
   * The decision belongs to the user and the screen that asks for it; this
   * only turns bytes into something they can be asked about.
   */
  const readImport = useCallback(
    async (file: File) => {
      const result = previewImport(new Uint8Array(await file.arrayBuffer()), profile);
      setImportError(result.ok ? null : result.error);
      setPreview(result.ok ? result.value : null);
    },
    [profile],
  );

  /** Take the imported Profile whole, which is what Replace means. */
  const acceptImport = useCallback(async () => {
    if (preview === null) {
      return;
    }

    await replaceProfile(preview.profile);
    setPreview(null);
    setImportError(null);
    dispatch({ type: 'profile-loaded', profile: preview.profile });
  }, [preview]);

  /** Apply a merge plan the user has resolved, or report why it cannot apply. */
  const mergeImport = useCallback(
    async (plan: ProfileMergePlan) => {
      if (profile === null) {
        return;
      }

      const merged = applyProfileMerge(profile, plan);
      if (!merged.ok) {
        dispatch({ type: 'failed', error: merged.error });
        return;
      }

      await replaceProfile(merged.profile);
      setPreview(null);
      setImportError(null);
      dispatch({ type: 'profile-loaded', profile: merged.profile });
    },
    [profile],
  );

  /**
   * Write the Profile to a file the user keeps, and let go of the URL at once.
   *
   * The blob holds the whole history in plaintext; a URL left alive is a
   * readable handle to it for as long as the document lives, so it is revoked
   * on the same tick the download starts.
   */
  const exportProfile = useCallback(() => {
    if (profile === null) {
      return;
    }

    const url = URL.createObjectURL(
      new Blob([serialiseMedigraph(profile)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'medigraph.medigraph';
    link.click();
    URL.revokeObjectURL(url);
  }, [profile]);

  const deleteReport = useCallback(
    async (id: string) => {
      const next = profile === null ? null : removeReport(profile, id);
      if (next === null) {
        return;
      }

      await replaceProfile(next);
      dispatch({ type: 'profile-loaded', profile: next });
    },
    [profile],
  );

  /**
   * Delete everything this device holds, including the code that serves it.
   *
   * The service worker goes with the data: one left registered would keep
   * serving the app — and its cached assets — to a device whose owner has just
   * asked for all of it to be gone.
   */
  const clearEverything = useCallback(async () => {
    await clearAll();
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
    }

    release();
    setPreview(null);
    setImportError(null);
    setReportId(null);
    setSeriesId(null);
    dispatch({ type: 'cleared' });
  }, [release]);

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
  const selectedSeries = series.find((each) => each.id === seriesId) ?? null;

  const copy = COPY[language];

  return (
    <LanguageContext.Provider value={language}>
      <div class="medigraph-app" data-testid="app" data-phase={phase} lang={language}>
        <p>
          <button
            type="button"
            data-testid="switch-language"
            lang={language === 'el' ? 'en' : 'el'}
            onClick={() => {
              const next: Language = language === 'el' ? 'en' : 'el';
              setLanguage(next);
              saveLanguage(next);
            }}
          >
            {copy.switchTo}
          </button>
        </p>

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

        {/*
          The data screen is offered at rest as well as after a commit: empty
          storage still has to offer the two ways in, attaching a document and
          importing a file (Task 4.5). The panel and the trend need a Profile;
          this does not.
        */}
        {(phase === 'idle' || phase === 'viewing') && (
          <>
            {phase === 'viewing' && profile !== null && selectedSeries === null && (
              <PanelView
                profile={profile}
                reportId={reportId ?? profile.reports.at(-1)?.id ?? ''}
                onSelectReport={setReportId}
                onSelectSeries={setSeriesId}
              />
            )}

            {phase === 'viewing' && selectedSeries !== null && (
              <TrendView
                series={selectedSeries}
                onBack={() => {
                  setSeriesId(null);
                }}
              />
            )}
            <DataManager
              profile={profile}
              persistenceGranted={persistenceGranted}
              preview={preview}
              importError={importError}
              onExport={exportProfile}
              onImport={(file) => void readImport(file)}
              onCancelImport={() => {
                setPreview(null);
                setImportError(null);
              }}
              onReplace={() => void acceptImport()}
              onMerge={(plan) => void mergeImport(plan)}
              onDeleteReport={(id) => void deleteReport(id)}
              onClearAll={() => void clearEverything()}
            />
          </>
        )}

        {/*
          The standing D1/D13 notice, inside the island so it follows the
          language toggle. It is always visible and never dismissible: it is
          what keeps the product a display of the user's own record rather
          than an opinion about it.
        */}
        <footer class="app-disclaimer" data-testid="app-disclaimer">
          <p>{copy.disclaimer.dataStays}</p>
          <p>{copy.disclaimer.plaintext}</p>
          <p>{copy.disclaimer.displayOnly}</p>
        </footer>
      </div>
    </LanguageContext.Provider>
  );
}
