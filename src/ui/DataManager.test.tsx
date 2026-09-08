// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { CollectedAt, Profile, ProfileMergePlan, Report } from '../domain/types';
import { previewImport } from '../io/fileFormat';
import type { ImportPreview, MedigraphReadError } from '../io/fileFormat';
import { DataManager } from './DataManager';

/**
 * The data screen, which is the only place a user can lose anything.
 *
 * Every test here is about the order of events: that nothing is written before
 * a decision, that no destructive action is the default, and that what a
 * destructive action costs is stated in the number of Reports it removes.
 */

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function report(id: string, date: string, time: string | null = null): Report {
  const collectedAt: CollectedAt =
    time === null ? { date, time: null, precision: 'day' } : { date, time, precision: 'minute' };

  return { id, collectedAt, measurements: [] };
}

function profileOf(reports: Report[]): Profile {
  return { schemaVersion: 1, id: 'profile-1', reports };
}

/** The committed golden file, read the way the app reads it. */
function golden(existing: Profile | null): ImportPreview {
  const bytes = new Uint8Array(readFileSync('fixtures/file-format/v1.medigraph'));
  const result = previewImport(bytes, existing);
  if (!result.ok) {
    throw new Error(`golden fixture unreadable: ${result.error}`);
  }

  return result.value;
}

interface Calls {
  exported: number;
  imported: File[];
  cancelled: number;
  replaced: number;
  merged: ProfileMergePlan[];
  deleted: string[];
  cleared: number;
}

let calls: Calls;

interface Options {
  profile?: Profile | null;
  persistenceGranted?: boolean | null;
  preview?: ImportPreview | null;
  importError?: MedigraphReadError | null;
}

function mount(options: Options = {}): void {
  calls = {
    exported: 0,
    imported: [],
    cancelled: 0,
    replaced: 0,
    merged: [],
    deleted: [],
    cleared: 0,
  };
  void act(() => {
    render(
      <DataManager
        profile={
          options.profile === undefined
            ? profileOf([report('rep-1', '2025-01-02')])
            : options.profile
        }
        persistenceGranted={options.persistenceGranted ?? null}
        preview={options.preview ?? null}
        importError={options.importError ?? null}
        onExport={() => {
          calls.exported += 1;
        }}
        onImport={(file) => calls.imported.push(file)}
        onCancelImport={() => {
          calls.cancelled += 1;
        }}
        onReplace={() => {
          calls.replaced += 1;
        }}
        onMerge={(plan) => calls.merged.push(plan)}
        onDeleteReport={(id) => calls.deleted.push(id)}
        onClearAll={() => {
          calls.cleared += 1;
        }}
      />,
      host,
    );
  });
}

function find(testId: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

function text(testId: string): string {
  return find(testId)?.textContent.replace(/\s+/gu, ' ').trim() ?? '';
}

function click(testId: string): void {
  void act(() => {
    find(testId)?.click();
  });
}

describe('export', () => {
  it('says the file is plaintext medical history before offering it', () => {
    mount();
    const warning = text('export-warning');

    expect(warning).toContain('απλό κείμενο');
    expect(warning).toContain('χωρίς κρυπτογράφηση');
    expect(warning).toContain('ιατρικό σας ιστορικό');
  });

  it('asks the island to write the file, and writes nothing itself', () => {
    mount();

    click('export');

    expect(calls.exported).toBe(1);
  });

  it('has nothing to offer when there is no Profile', () => {
    mount({ profile: null });

    expect((find('export') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('storage persistence', () => {
  it.each([
    [true, 'μόνιμα'],
    [false, 'μπορεί να τα διαγράψει'],
    [null, 'δεν απάντησε'],
  ] as const)('explains a %s answer and still nudges an export', (granted, expected) => {
    mount({ persistenceGranted: granted });

    expect(text('persistence')).toContain(expected);
    expect(text('persistence')).toContain('αντίγραφο');
  });
});

describe('import', () => {
  it('hands the chosen file to the island rather than reading it', () => {
    mount();
    const input = find('import') as HTMLInputElement;
    const file = new File(['{}'], 'history.medigraph');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    void act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(calls.imported).toEqual([file]);
  });

  it.each([
    ['not-medigraph' as const, 'Δεν είναι αρχείο'],
    ['unsupported-version' as const, 'νεότερη έκδοση'],
    ['invalid-profile' as const, 'έγκυρο ιστορικό'],
    ['malformed-json' as const, 'έγκυρο JSON'],
    ['file-too-large' as const, 'πολύ μεγάλο'],
  ])('names the reason a file could not be read: %s', (error, expected) => {
    mount({ importError: error });

    expect(text('import-error')).toContain(expected);
  });
});

describe('the import decision', () => {
  it('offers Cancel or Import into an empty Profile, and nothing destructive', () => {
    mount({ profile: null, preview: golden(null) });

    expect(find('accept-import')).not.toBeNull();
    expect(find('replace-import')).toBeNull();
    expect(find('merge-import')).toBeNull();

    click('accept-import');

    expect(calls.replaced).toBe(1);
  });

  it('offers Cancel, Merge and Replace against an existing Profile, none preselected', () => {
    const existing = profileOf([report('rep-1', '2025-01-02')]);
    mount({ profile: existing, preview: golden(existing) });

    // Both writing actions wait on the same-person answer, and neither is a
    // default: nothing is focused, checked or pre-armed.
    expect((find('merge-import') as HTMLButtonElement).disabled).toBe(true);
    expect((find('replace-import') as HTMLButtonElement).disabled).toBe(true);
    expect((find('import-same-person') as HTMLInputElement).checked).toBe(false);
    expect(find('replace-confirm')).toBeNull();
  });

  it('takes two deliberate steps to replace, and says what is lost', () => {
    const existing = profileOf([report('rep-1', '2025-01-02'), report('rep-2', '2025-02-02')]);
    mount({ profile: existing, preview: golden(existing) });

    click('import-same-person');
    click('replace-import');

    expect(calls.replaced).toBe(0);
    expect(text('replace-confirm')).toContain('2');
    expect(text('replace-confirm')).toContain('Δεν υπάρχει αντίγραφο');

    click('replace-confirmed');

    expect(calls.replaced).toBe(1);
  });

  it('merges only once the same-person question is answered', () => {
    const existing = profileOf([report('rep-1', '2025-01-02')]);
    const preview = golden(existing);
    mount({ profile: existing, preview });

    click('import-same-person');
    click('merge-import');

    expect(calls.merged).toEqual([preview.plan]);
  });

  it('cancels without writing anything', () => {
    const existing = profileOf([report('rep-1', '2025-01-02')]);
    mount({ profile: existing, preview: golden(existing) });

    click('cancel-import');

    expect(calls).toMatchObject({ cancelled: 1, replaced: 0, merged: [] });
  });

  it('refuses a merge whose Report ids collide, and says why', () => {
    const existing = profileOf([report('rep-1', '2025-01-02')]);
    const preview = golden(existing);
    const collided: ImportPreview = {
      profile: preview.profile,
      plan: {
        duplicateReportIds: [],
        updates: [],
        additions: [],
        conflicts: [
          {
            kind: 'report-id',
            existing: report('rep-1', '2025-01-02'),
            incoming: report('rep-1', '2025-03-03'),
          },
        ],
      },
    };
    mount({ profile: existing, preview: collided });

    click('import-same-person');

    expect(text('merge-blocked')).toContain('ίδιο αναγνωριστικό');
    expect((find('merge-import') as HTMLButtonElement).disabled).toBe(true);
  });

  it('resolves two exams on one day by giving each a minute', () => {
    const existing = profileOf([report('rep-1', '2025-01-02')]);
    const preview = golden(existing);
    const clash: ImportPreview = {
      profile: preview.profile,
      plan: {
        duplicateReportIds: [],
        updates: [],
        additions: [report('rep-9', '2025-01-02')],
        conflicts: [
          {
            kind: 'same-day-precision',
            existing: report('rep-1', '2025-01-02'),
            incoming: report('rep-9', '2025-01-02'),
          },
        ],
      },
    };
    mount({ profile: existing, preview: clash });

    click('import-same-person');
    expect((find('merge-import') as HTMLButtonElement).disabled).toBe(true);

    const stored = find('same-day-stored-rep-1') as HTMLInputElement;
    const incoming = find('same-day-incoming-rep-9') as HTMLInputElement;
    void act(() => {
      stored.value = '08:00';
      stored.dispatchEvent(new Event('input', { bubbles: true }));
    });
    void act(() => {
      incoming.value = '17:30';
      incoming.dispatchEvent(new Event('input', { bubbles: true }));
    });

    click('merge-import');

    expect(calls.merged[0]?.conflicts).toEqual([]);
    expect(calls.merged[0]?.additions[0]?.collectedAt).toEqual({
      date: '2025-01-02',
      time: '17:30',
      precision: 'minute',
    });
  });
});

describe('deleting', () => {
  it('takes two taps to remove one Report', () => {
    mount({ profile: profileOf([report('rep-1', '2025-01-02')]) });

    click('delete-report-rep-1');
    expect(calls.deleted).toEqual([]);

    click('delete-report-confirmed-rep-1');

    expect(calls.deleted).toEqual(['rep-1']);
  });

  it('takes two taps to remove everything, and says what everything means', () => {
    mount();

    click('clear-all');
    expect(calls.cleared).toBe(0);
    expect(text('clear-all-confirm')).toContain('προσωρινή μνήμη');

    click('clear-all-confirmed');

    expect(calls.cleared).toBe(1);
  });
});

describe('empty storage', () => {
  it('points at both ways in: attaching a document, or importing a file', () => {
    mount({ profile: null });

    expect(text('data-empty')).toContain('Επισυνάψτε');
    expect(text('data-empty')).toContain('.medigraph');
    expect(find('import')).not.toBeNull();
  });
});
