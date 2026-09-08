import type { ExtractionResult, Profile, ReviewSession, SourceRef } from '../domain/types';
import type { MedigraphReadError } from '../io/fileFormat';
import type { FileRouteErrorCode, RouteFailure, RouteProgress } from '../io/fileRouter';

/**
 * The one island's state machine, and the evidence it owns outside it.
 *
 * `MedigraphApp` is the only hydrated island (D2): child components receive
 * state and callbacks, and none of them keeps a store or writes IndexedDB.
 * Everything the reducer holds is serialisable, which is what makes the whole
 * transaction inspectable in a test without a browser — and is why the File
 * references, object URLs and bitmaps live in a separate map the reducer never
 * sees. A `File` in `AppState` would be a handle to a document sitting inside a
 * value the app copies on every keystroke.
 *
 * Two rules the reducer exists to hold, both from D6:
 *
 * - **Nothing is charted before Confirm.** `viewing` is reachable only from
 *   `commit-succeeded` or from `profile-loaded` — a commit, or what a previous
 *   one already persisted; no path from `reviewing` shows a chart of
 *   unconfirmed rows.
 * - **Cancelling or failing costs the user nothing they had.** Both return to
 *   the Profile that was already committed, unchanged, and end the transaction
 *   rather than leaving a half-open one behind.
 */

export type AppPhase = 'idle' | 'extracting' | 'reviewing' | 'committing' | 'viewing';

export type AppErrorCode =
  | FileRouteErrorCode
  | MedigraphReadError
  | 'report-id-conflict'
  | 'same-day-precision-conflict'
  | 'commit-failed';

export interface AppState {
  phase: AppPhase;
  profile: Profile | null;
  review: ReviewSession | null;
  progress: RouteProgress | null;
  routeFailures: RouteFailure[];
  error: AppErrorCode | null;
}

export type AppAction =
  | { type: 'profile-loaded'; profile: Profile }
  | { type: 'extract-started' }
  | { type: 'extract-progressed'; progress: RouteProgress }
  | { type: 'review-ready'; review: ReviewSession; routeFailures: RouteFailure[] }
  | { type: 'review-updated'; review: ReviewSession }
  | { type: 'commit-started' }
  | { type: 'commit-succeeded'; profile: Profile }
  | { type: 'cancelled' }
  | { type: 'cleared' }
  | { type: 'failed'; error: AppErrorCode };

export const initialState: AppState = {
  phase: 'idle',
  profile: null,
  review: null,
  progress: null,
  routeFailures: [],
  error: null,
};

/** Where a transaction lands when it ends without writing: back where it began. */
function resting(state: AppState): AppPhase {
  return state.profile === null ? 'idle' : 'viewing';
}

/** End the transaction, keeping the committed Profile and whatever it reported. */
function ended(state: AppState, error: AppErrorCode | null, keepFailures: boolean): AppState {
  return {
    ...state,
    phase: resting(state),
    review: null,
    progress: null,
    routeFailures: keepFailures ? state.routeFailures : [],
    error,
  };
}

/**
 * One batch is one transaction, and the reducer is the whole of its shape.
 *
 * An action that does not belong to the phase it arrives in is ignored rather
 * than throwing: a review screen races against its own state, and a stale
 * progress event from a batch the user has already cancelled is not an
 * exception. The same reading `review.ts` gives a stale click.
 *
 * `profile-loaded` is the one action outside that rule, because it is the one
 * action that is not part of the transaction. See its case below.
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'profile-loaded':
      // Not a transaction event, and the one action with no phase guard: this
      // is what was already committed becoming known — read from IndexedDB on
      // mount, or replaced wholesale by an import. It is the baseline a
      // Confirm builds on, so it has to land even if the read finishes after
      // the user has already attached a batch; a Profile dropped there would
      // be a Profile the next Confirm overwrites.
      //
      // Landing is not interrupting. An open transaction keeps its phase and
      // its review, and only an app sitting at `idle` has its screen changed
      // by learning there was something to show all along.
      return {
        ...state,
        phase: state.phase === 'idle' ? 'viewing' : state.phase,
        profile: action.profile,
        error: null,
      };

    case 'extract-started':
      // A new batch replaces whatever the last one reported, including its
      // failures: they described files that are no longer being attached.
      return {
        ...state,
        phase: 'extracting',
        review: null,
        progress: null,
        routeFailures: [],
        error: null,
      };

    case 'extract-progressed':
      return state.phase === 'extracting' ? { ...state, progress: action.progress } : state;

    case 'review-ready': {
      if (state.phase !== 'extracting') {
        return state;
      }

      // A batch that extracted nothing opens no review. Its failures are why
      // there is nothing to review, so they survive the return to rest.
      const routeFailures = [...action.routeFailures];
      if (action.review.reportDrafts.length === 0) {
        return { ...ended(state, null, false), routeFailures };
      }

      return { ...state, phase: 'reviewing', review: action.review, progress: null, routeFailures };
    }

    case 'review-updated':
      return state.phase === 'reviewing' ? { ...state, review: action.review } : state;

    case 'commit-started':
      return state.phase === 'reviewing' ? { ...state, phase: 'committing', error: null } : state;

    case 'commit-succeeded':
      // The only path to a chart, and the only path that drops the review while
      // the Profile changes underneath it.
      return state.phase === 'committing'
        ? {
            ...state,
            phase: 'viewing',
            profile: action.profile,
            review: null,
            progress: null,
            routeFailures: [],
            error: null,
          }
        : state;

    case 'cancelled':
      return ended(state, null, false);

    // Everything stored on this device is gone, so the app is what it was
    // before anything was ever attached. Returning `initialState` rather than
    // clearing fields one at a time is the point: a field forgotten here would
    // be a fragment of a record its owner has just deleted.
    case 'cleared':
      return initialState;

    case 'failed':
      // The committed Profile is untouched. The review goes with the evidence
      // it was reading: `MedigraphApp` releases every URL and bitmap on the
      // same event, so a session left open here could only show crops of
      // pages that no longer exist.
      return ended(state, action.error, state.phase === 'extracting');
  }
}

// ---------------------------------------------------------------------------
// Evidence, which the reducer never holds
// ---------------------------------------------------------------------------

/**
 * Everything one attached source is keeping alive.
 *
 * Held by `MedigraphApp` in a `Map` keyed by `sourceId`, outside `AppState`,
 * and released as a unit. Sets rather than arrays because release must be
 * one-for-one: a URL revoked twice is a bug hidden, not a bug fixed.
 */
export interface EvidenceResource {
  file: File;
  objectUrls: Set<string>;
  bitmaps: Set<ImageBitmap>;
}

/** What `onInspectSource` can answer, and the reasons it can refuse. */
export type EvidenceLookup =
  | { kind: 'evidence'; resource: EvidenceResource; page: number }
  | { kind: 'unavailable' }
  | { kind: 'unknown-source' }
  | { kind: 'unknown-page' };

/**
 * Resolve a `SourceRef` to the document it points into.
 *
 * Refusal is a result, not an error, and each refusal is distinct because the
 * review screen says something different for each. `unavailable` is the
 * adapter's own answer — a source with `evidenceAvailable: false` was never
 * going to have a page to show, and saying "unknown source" about it would
 * describe a bug the app does not have.
 *
 * A page outside the document is refused rather than clamped: a crop drawn on
 * the wrong page is worse than no crop, because the user would believe it.
 */
export function inspectSource(
  store: ReadonlyMap<string, EvidenceResource>,
  results: readonly ExtractionResult[],
  ref: SourceRef,
): EvidenceLookup {
  const result = results.find((each) => each.sourceId === ref.sourceId);
  if (result === undefined) {
    return { kind: 'unknown-source' };
  }
  if (!result.evidenceAvailable) {
    return { kind: 'unavailable' };
  }

  const resource = store.get(ref.sourceId);
  if (resource === undefined) {
    return { kind: 'unknown-source' };
  }

  const pageCount = result.evidencePages?.length ?? 0;
  if (!Number.isInteger(ref.page) || ref.page < 1 || ref.page > pageCount) {
    return { kind: 'unknown-page' };
  }

  return { kind: 'evidence', resource, page: ref.page };
}

/**
 * Release every resource the batch was holding, and empty the map.
 *
 * Called on Confirm, on Cancel, on any failure and on unmount — the four ways
 * a transaction can end. `revoke` is passed in rather than reached for so the
 * disposal is countable in a test: what matters here is that every URL is
 * revoked exactly once and every bitmap closed exactly once, and a module that
 * called a global could only be tested by replacing one.
 *
 * The `File` needs no release; dropping the map drops the last reference to it,
 * which is what lets the browser reclaim the document.
 */
export function releaseEvidence(
  store: Map<string, EvidenceResource>,
  revoke: (url: string) => void,
): void {
  for (const resource of store.values()) {
    for (const url of resource.objectUrls) {
      revoke(url);
    }
    for (const bitmap of resource.bitmaps) {
      bitmap.close();
    }
    resource.objectUrls.clear();
    resource.bitmaps.clear();
  }

  store.clear();
}
