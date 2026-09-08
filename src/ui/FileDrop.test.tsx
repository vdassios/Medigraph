// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { RouteFailure, RouteProgress } from '../io/fileRouter';
import { ROUTE_LIMITS } from '../io/fileRouter';
import { FileDrop } from './FileDrop';

/**
 * The attach surface, driven the way a browser drives it.
 *
 * Every assertion here is about what leaves the component or what the person
 * in front of it can read: the files handed upward are the same objects the
 * picker produced, and each typed `RouteFailure` renders as its own line. What
 * the component must never do is decide anything — the batch caps are printed,
 * not applied, so there is no test asserting a rejection here.
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

interface Props {
  disabled?: boolean;
  progress?: RouteProgress | null;
  failures?: RouteFailure[];
  onFiles?: (files: File[]) => void;
  onCancel?: () => void;
}

function mount(props: Props = {}): void {
  void act(() => {
    render(
      <FileDrop
        disabled={props.disabled ?? false}
        progress={props.progress ?? null}
        failures={props.failures ?? []}
        onFiles={props.onFiles ?? (() => undefined)}
        onCancel={props.onCancel ?? (() => undefined)}
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

function pdf(name: string): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
}

/** The picker hands over a `FileList`; jsdom has no way to build a real one. */
function choose(files: File[]): void {
  const input = find('attach') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  void act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function drag(type: 'dragenter' | 'dragleave', relatedTarget: Node | null = null): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget, configurable: true });
  void act(() => {
    find('file-drop')?.dispatchEvent(event);
  });
}

function dragging(): string | null {
  return find('file-drop')?.getAttribute('data-dragging') ?? null;
}

function dropOn(testId: string, files: File[]): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files }, configurable: true });
  void act(() => {
    find(testId)?.dispatchEvent(event);
  });

  return event;
}

describe('handing files upward', () => {
  it('passes what the picker chose, unchanged and in order', () => {
    const handed: File[][] = [];
    mount({ onFiles: (files) => handed.push(files) });

    const first = pdf('α.pdf');
    const second = pdf('β.pdf');
    choose([first, second]);

    expect(handed).toHaveLength(1);
    expect(handed[0]?.[0]).toBe(first);
    expect(handed[0]?.[1]).toBe(second);
  });

  it('passes a dropped file and keeps the browser from opening it', () => {
    const handed: File[][] = [];
    mount({ onFiles: (files) => handed.push(files) });

    const dropped = pdf('γ.pdf');
    const event = dropOn('file-drop', [dropped]);

    expect(handed[0]).toEqual([dropped]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('says nothing when a picker dialog is dismissed', () => {
    let called = 0;
    mount({
      onFiles: () => {
        called += 1;
      },
    });

    choose([]);

    expect(called).toBe(0);
  });

  it('offers the picker without asking for a camera', () => {
    mount();
    const input = find('attach') as HTMLInputElement;

    expect(input.getAttribute('accept')).toBe('application/pdf');
    expect(input.multiple).toBe(true);
    expect(input.hasAttribute('capture')).toBe(false);
  });
});

describe('while the parent is busy', () => {
  it('blocks the picker', () => {
    mount({ disabled: true });

    expect((find('attach') as HTMLInputElement).disabled).toBe(true);
  });

  it('swallows a drop rather than letting the browser navigate to it', () => {
    const handed: File[][] = [];
    mount({ disabled: true, onFiles: (files) => handed.push(files) });

    const event = dropOn('file-drop', [pdf('δ.pdf')]);

    expect(handed).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('the drop target', () => {
  it('marks itself while a file is over it, and stops when the file leaves', () => {
    mount();
    expect(dragging()).toBe('false');

    drag('dragenter');
    expect(dragging()).toBe('true');

    drag('dragleave', document.body);
    expect(dragging()).toBe('false');
  });

  it('stays marked while the pointer crosses its own children', () => {
    mount();
    drag('dragenter');

    drag('dragleave', find('attach-limits'));

    expect(dragging()).toBe('true');
  });

  it('stops marking itself once the file is dropped', () => {
    mount();
    drag('dragenter');

    dropOn('file-drop', [pdf('ε.pdf')]);

    expect(dragging()).toBe('false');
  });
});

describe('progress', () => {
  it('is a live region from the first render, empty and without a cancel', () => {
    mount();

    expect(find('attach-progress')?.getAttribute('role')).toBe('status');
    expect(text('attach-progress')).toBe('');
    expect(find('attach-cancel')).toBeNull();
  });

  it('names the document being read before its page count is known', () => {
    mount({ progress: { sourceIndex: 0, sourceCount: 3, page: 0, pageCount: 0 } });

    expect(text('attach-progress')).toBe('Ανάγνωση εγγράφου 1 από 3…');
  });

  it('counts pages once decode has returned them', () => {
    mount({ progress: { sourceIndex: 2, sourceCount: 3, page: 4, pageCount: 4 } });

    expect(text('attach-progress')).toBe('Έγγραφο 3 από 3: 4 από 4 σελίδες');
  });

  it('offers a cancel that aborts the parent’s route', () => {
    let cancelled = 0;
    mount({
      progress: { sourceIndex: 0, sourceCount: 1, page: 0, pageCount: 0 },
      onCancel: () => {
        cancelled += 1;
      },
    });

    void act(() => {
      find('attach-cancel')?.click();
    });

    expect(cancelled).toBe(1);
  });
});

describe('failures', () => {
  it('prints every batch cap the router will apply', () => {
    mount();
    const limits = text('attach-limits');

    expect(limits).toContain(String(ROUTE_LIMITS.maxFiles));
    expect(limits).toContain(String(ROUTE_LIMITS.maxPages));
    expect(limits).toContain(String(ROUTE_LIMITS.maxBytes / (1024 * 1024)));
  });

  it('renders nothing when there are none', () => {
    mount();

    expect(find('failures')).toBeNull();
  });

  it.each([
    ['too-many-files' as const, String(ROUTE_LIMITS.maxFiles)],
    ['too-many-pages' as const, String(ROUTE_LIMITS.maxPages)],
    ['cancelled' as const, 'διακόπηκε'],
  ])('explains the batch failure %s', (code, expected) => {
    mount({ failures: [{ scope: 'batch', code }] });

    expect(text(`failure-${code}`)).toContain(expected);
    expect(find('failure-file')).toBeNull();
  });

  it.each([
    ['unsupported-type' as const, 'myhealth.gov.gr'],
    ['file-too-large' as const, '50 MB'],
    ['decode-failed' as const, 'myhealth.gov.gr'],
    ['not-ahfy-document' as const, 'myhealth.gov.gr'],
  ])('names the file that failed with %s', (code, expected) => {
    mount({
      failures: [{ scope: 'source', sourceIndex: 1, fileName: 'διακοπές.pdf', code }],
    });

    expect(text('failure-file')).toBe('διακοπές.pdf');
    expect(text(`failure-${code}`)).toContain(expected);
  });

  it('tells a rejected source what is accepted, without calling its file broken', () => {
    mount({
      failures: [
        { scope: 'source', sourceIndex: 0, fileName: 'φωτογραφία.pdf', code: 'not-ahfy-document' },
      ],
    });
    const message = text('failure-not-ahfy-document');

    expect(message).toContain('myhealth.gov.gr');
    expect(message).not.toMatch(/κατεστραμμέν|άκυρ|σφάλμα/u);
  });

  it('keeps every refusal in a batch, including two of the same kind', () => {
    mount({
      failures: [
        { scope: 'source', sourceIndex: 0, fileName: 'ένα.pdf', code: 'unsupported-type' },
        { scope: 'source', sourceIndex: 2, fileName: 'δύο.pdf', code: 'unsupported-type' },
        { scope: 'batch', code: 'too-many-pages' },
      ],
    });

    expect(host.querySelectorAll('[data-testid="failures"] > li')).toHaveLength(3);
    expect(
      [...host.querySelectorAll('[data-testid="failure-file"]')].map((el) => el.textContent),
    ).toEqual(['ένα.pdf', 'δύο.pdf']);
  });
});
