import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionResult, Profile, ReviewSession } from '../domain/types';
import type { RouteFailure, RouteProgress } from '../io/fileRouter';
import { appReducer, initialState, inspectSource, releaseEvidence } from './appState';
import type { AppAction, AppPhase, AppState, EvidenceResource } from './appState';

const PROGRESS: RouteProgress = { sourceIndex: 0, sourceCount: 1, page: 1, pageCount: 3 };
const FAILURE: RouteFailure = {
  scope: 'source',
  sourceIndex: 0,
  fileName: 'scan.pdf',
  code: 'not-ahfy-document',
};

function profile(id = 'profile-1'): Profile {
  return { schemaVersion: 1, id, reports: [] };
}

function review(draftCount = 1): ReviewSession {
  return {
    id: 'review-1',
    results: [],
    reportDrafts: Array.from({ length: draftCount }, (_unused, index) => ({
      id: `draft-${String(index)}`,
      sourceIds: [`s${String(index)}`],
      targetReportId: null,
      collectedAt: null,
      dateConfirmed: false,
      rows: [],
      conflicts: [],
    })),
    identifierResolutions: {},
    approvedUnknownRowIds: [],
    existingReportDateUpdates: {},
    samePersonConfirmed: null,
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return { ...initialState, ...overrides };
}

/** Drive the reducer through a sequence, as the island does. */
function run(from: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(appReducer, from);
}

describe('appReducer', () => {
  describe('the transaction', () => {
    it('walks idle to viewing through one batch', () => {
      const phases: AppPhase[] = [];
      const actions: AppAction[] = [
        { type: 'extract-started' },
        { type: 'extract-progressed', progress: PROGRESS },
        { type: 'review-ready', review: review(), routeFailures: [] },
        { type: 'review-updated', review: review() },
        { type: 'commit-started' },
        { type: 'commit-succeeded', profile: profile() },
      ];

      actions.reduce((current, action) => {
        const next = appReducer(current, action);
        phases.push(next.phase);
        return next;
      }, initialState);

      expect(phases).toEqual([
        'extracting',
        'extracting',
        'reviewing',
        'reviewing',
        'committing',
        'viewing',
      ]);
    });

    it('charts nothing that was not confirmed', () => {
      // `viewing` is reachable only from a commit that succeeded.
      const reviewing = run(
        initialState,
        { type: 'extract-started' },
        {
          type: 'review-ready',
          review: review(),
          routeFailures: [],
        },
      );

      expect(reviewing.phase).toBe('reviewing');
      expect(reviewing.profile).toBeNull();
      expect(appReducer(reviewing, { type: 'commit-succeeded', profile: profile() }).phase).toBe(
        'reviewing',
      );
    });

    it('drops the previous batch’s failures when a new one starts', () => {
      const carrying = state({ routeFailures: [FAILURE], error: 'decode-failed' });
      const next = appReducer(carrying, { type: 'extract-started' });

      expect(next).toMatchObject({ phase: 'extracting', routeFailures: [], error: null });
    });

    it('opens no review for a batch that extracted nothing, and says why', () => {
      const next = run(
        initialState,
        { type: 'extract-started' },
        {
          type: 'review-ready',
          review: review(0),
          routeFailures: [FAILURE],
        },
      );

      expect(next).toMatchObject({ phase: 'idle', review: null, routeFailures: [FAILURE] });
    });
  });

  describe('the Profile a previous transaction already committed', () => {
    it('shows what storage held when the app was idle', () => {
      const stored = profile();
      const next = appReducer(initialState, { type: 'profile-loaded', profile: stored });

      expect(next).toMatchObject({ phase: 'viewing', profile: stored });
    });

    it('replaces the Profile on screen when an import lands', () => {
      const viewing = state({ phase: 'viewing', profile: profile('old') });
      const imported = profile('imported');
      const next = appReducer(viewing, { type: 'profile-loaded', profile: imported });

      expect(next).toMatchObject({ phase: 'viewing', profile: imported });
    });

    it('clears the error an earlier refused import left', () => {
      const refused = state({ phase: 'viewing', profile: profile(), error: 'unsupported-version' });

      expect(appReducer(refused, { type: 'profile-loaded', profile: profile() }).error).toBeNull();
    });

    it.each(['extracting', 'reviewing', 'committing'] as const)(
      'lands while %s without interrupting the batch',
      (phase) => {
        // The read that finished late is still the baseline Confirm builds on.
        // Dropping it here is how a stored Profile gets overwritten.
        const open = state({ phase, review: review() });
        const stored = profile();
        const next = appReducer(open, { type: 'profile-loaded', profile: stored });

        expect(next).toMatchObject({ phase, profile: stored, review: open.review });
      },
    );

    it('gives a cancelled batch the late-loaded Profile to return to', () => {
      const reviewing = state({ phase: 'reviewing', review: review() });
      const loaded = appReducer(reviewing, { type: 'profile-loaded', profile: profile() });

      expect(appReducer(loaded, { type: 'cancelled' }).phase).toBe('viewing');
    });
  });

  describe('what an ended transaction leaves behind', () => {
    const committing = state({
      phase: 'committing',
      profile: profile(),
      review: review(),
      routeFailures: [FAILURE],
    });

    it.each([
      ['cancelled', { type: 'cancelled' } as const, null],
      ['a failed commit', { type: 'failed', error: 'commit-failed' } as const, 'commit-failed'],
    ])('%s keeps the committed Profile and ends the review', (_name, action, error) => {
      const next = appReducer(committing, action);

      expect(next.profile).toBe(committing.profile);
      expect(next).toMatchObject({ phase: 'viewing', review: null, progress: null, error });
    });

    it('returns to idle when there was no Profile to return to', () => {
      const reviewing = state({ phase: 'reviewing', review: review() });

      expect(appReducer(reviewing, { type: 'cancelled' }).phase).toBe('idle');
    });

    it('keeps the failures of a batch that failed while extracting', () => {
      // They are the explanation for the empty screen the user is looking at.
      const extracting = state({ phase: 'extracting', routeFailures: [FAILURE] });
      const next = appReducer(extracting, { type: 'failed', error: 'decode-failed' });

      expect(next).toMatchObject({ routeFailures: [FAILURE], error: 'decode-failed' });
    });

    it('clears the failures of one that failed after review opened', () => {
      const next = appReducer(committing, { type: 'failed', error: 'commit-failed' });

      expect(next.routeFailures).toEqual([]);
    });
  });

  describe('actions that do not belong to the phase they arrive in', () => {
    it.each([
      ['progress', { type: 'extract-progressed', progress: PROGRESS } as const, 'reviewing'],
      ['a review update', { type: 'review-updated', review: review() } as const, 'viewing'],
      ['a commit', { type: 'commit-started' } as const, 'idle'],
      ['a commit result', { type: 'commit-succeeded', profile: profile() } as const, 'extracting'],
      ['a review', { type: 'review-ready', review: review(), routeFailures: [] } as const, 'idle'],
    ])('ignores %s', (_name, action, phase) => {
      // A screen races against its own state; a stale event is not an error.
      const current = state({ phase: phase as AppPhase, profile: profile() });

      expect(appReducer(current, action as AppAction)).toBe(current);
    });
  });
});

describe('the evidence the reducer never holds', () => {
  /** Every `close` a fake bitmap was built with, so disposal is countable. */
  const closes: (() => void)[] = [];

  function resource(urls: string[], bitmaps: number): EvidenceResource {
    return {
      file: { name: 'scan.pdf' } as File,
      objectUrls: new Set(urls),
      bitmaps: new Set(
        Array.from({ length: bitmaps }, () => {
          const close = vi.fn();
          closes.push(close);
          return { close } as unknown as ImageBitmap;
        }),
      ),
    };
  }

  beforeEach(() => {
    closes.length = 0;
  });

  function extracted(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
    return {
      sourceId: 's1',
      adapterId: 'pdf-text',
      tier: 'E0',
      registryVersion: 2,
      rows: [],
      collectionDate: '2025-05-14',
      resultDate: null,
      identifierCandidates: [],
      unrecognised: [],
      evidenceAvailable: true,
      evidencePages: [[], []],
      ...overrides,
    };
  }

  describe('releaseEvidence', () => {
    it('revokes every URL once, closes every bitmap once, and empties the map', () => {
      const store = new Map([
        ['s1', resource(['blob:a', 'blob:b'], 1)],
        ['s2', resource(['blob:c'], 2)],
      ]);
      const revoke = vi.fn();

      releaseEvidence(store, revoke);

      expect(revoke.mock.calls.flat().sort()).toEqual(['blob:a', 'blob:b', 'blob:c']);
      for (const close of closes) {
        expect(close).toHaveBeenCalledTimes(1);
      }
      expect(store.size).toBe(0);
    });

    it('is safe to call again, and releases nothing twice', () => {
      const store = new Map([['s1', resource(['blob:a'], 1)]]);
      const revoke = vi.fn();

      releaseEvidence(store, revoke);
      releaseEvidence(store, revoke);

      expect(revoke).toHaveBeenCalledTimes(1);
      expect(closes[0]).toHaveBeenCalledTimes(1);
    });

    it('releases nothing when there was nothing to release', () => {
      const revoke = vi.fn();

      releaseEvidence(new Map(), revoke);

      expect(revoke).not.toHaveBeenCalled();
    });
  });

  describe('inspectSource', () => {
    const store = new Map([['s1', resource(['blob:a'], 0)]]);

    it('resolves a page the document has', () => {
      const found = inspectSource(store, [extracted()], { sourceId: 's1', page: 2 });

      expect(found).toMatchObject({ kind: 'evidence', page: 2 });
    });

    it.each([
      ['a source nothing extracted', { sourceId: 'other', page: 1 }, 'unknown-source'],
      ['a page past the end', { sourceId: 's1', page: 3 }, 'unknown-page'],
      ['page zero', { sourceId: 's1', page: 0 }, 'unknown-page'],
    ])('refuses %s', (_name, ref, kind) => {
      // A crop drawn on the wrong page is worse than no crop: the user would
      // believe it.
      expect(inspectSource(store, [extracted()], ref).kind).toBe(kind);
    });

    it('reports an adapter that never had evidence as unavailable', () => {
      // A direct adapter never had pages: `evidenceAvailable` is its own
      // answer, not the absence of a map entry.
      const full = extracted();
      const direct: ExtractionResult = { ...full, evidenceAvailable: false };
      delete direct.evidencePages;

      expect(inspectSource(store, [direct], { sourceId: 's1', page: 1 }).kind).toBe('unavailable');
    });

    it('refuses a source whose evidence has already been released', () => {
      expect(inspectSource(new Map(), [extracted()], { sourceId: 's1', page: 1 }).kind).toBe(
        'unknown-source',
      );
    });
  });
});
