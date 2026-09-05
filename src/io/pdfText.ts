import type { TextItem } from '../domain/types';
import type { AdapterOutput, ExtractionAdapter } from './adapter';
import { loadRuntimeAsset } from './adapter';

/**
 * The E0 adapter: an ΑΗΦΥ PDF's own text layer, as positioned observations.
 *
 * There is no recognition step here and no probabilistic component anywhere
 * behind it (D3). pdf.js reads an exact character stream, so every parse
 * failure downstream is a rule that did not match rather than a character that
 * was misread — which is the failure shape the whole plan is built around.
 *
 * This module is the only one allowed to know `pdfjs-dist` exists. What it
 * returns is `TextItem[][]`: plain data with real boxes, carrying no vendor
 * object across the seam (D4, D1a).
 */

/** The self-hosted worker, copied from the pinned package by `pnpm sync:pdf-worker`. */
const WORKER_PATH = '/pdf/pdf.worker.min.mjs';

/** pdf.js emits `height: 0` for a positioning-only item; those are not text. */
const EMPTY = 0;

/**
 * Two fragments belong to one printed word when they sit on one baseline and
 * the second starts where the first ended.
 *
 * pdf.js splits a run wherever the font changes, and this document changes font
 * mid-word constantly: `Κωδικός` and `:` are two fonts, so are `k/`, `μ` and
 * `l`, and so is the issuing laboratory `ΑΙΜΑΤΟΛΟΓΙΚO` — eleven Greek letters
 * and a Latin `O`, which the plan names as a case the parser must handle whole.
 * Rejoining them is not inventing geometry: the union of two measured boxes is
 * measured, and the forbidden direction is the other one — splitting a fragment
 * and interpolating x by character count, which a proportional font makes
 * unsafe.
 *
 * The gap bound is in unscaled PDF units. A printed space in this document is
 * around 2.5 units wide at body size, so half a unit separates "the font
 * changed" from "the laboratory typed a space" with a wide margin on both
 * sides, and `ΓΕΝΙΚΗ ΑΙΜΑΤΟΣ` stays two items as it is printed.
 */
const JOIN_GAP = 0.5;
const JOIN_BASELINE = 0.01;

interface Fragment {
  text: string;
  x: number;
  baseline: number;
  w: number;
  ascent: number;
  descent: number;
}

interface RawItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
  fontName: string;
}

interface RawStyle {
  ascent: number;
  descent: number;
}

/**
 * A printed line's height, from the font rather than from the glyph.
 *
 * `TextItem.height` is the font size — the em — and the box a reader sees is
 * taller: ascender to descender. Every vertical threshold downstream is
 * measured in printed lines, and `rows.ts`'s in particular has about 25%
 * clearance on each side of a measured line height of 0.0141. Reporting the em
 * instead, 22% shorter, moves that threshold onto the very gap it has to
 * straddle and a wrapped label stops clustering with its own value.
 *
 * pdf.js reports both metrics per font in `getTextContent().styles`, as
 * fractions of the em with a negative descent. A font that declares neither
 * falls back to the em, which is the only number left.
 */
const FALLBACK_ASCENT = 1;
const FALLBACK_DESCENT = 0;

/**
 * pdf.js, imported once and lazily.
 *
 * Lazy because the library is the largest thing the app loads and a user who
 * only opens their charts must not pay for it, and once because a second
 * instance would mean a second worker.
 */
let pdfjs: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

function library(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

let worker: Promise<void> | null = null;

/**
 * Point pdf.js at the worker this app serves itself.
 *
 * The bytes are fetched from our own origin and handed to the browser as a
 * blob, which is why the CSP reads `worker-src 'self' blob:` — the one place
 * that combination is needed, and the one place it is allowed.
 *
 * Where the platform has no `Worker` — Node, under test — pdf.js parses in
 * process instead. That is its own documented fallback, not a bypass: the
 * browser path always has both, so the self-hosting guarantee cannot be
 * silently lost, and the fallback is what lets the real library run against the
 * real seed PDFs in a unit test.
 */
async function useSelfHostedWorker(
  api: typeof import('pdfjs-dist/legacy/build/pdf.mjs'),
  signal: AbortSignal,
): Promise<void> {
  if (typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return;
  }

  worker ??= loadRuntimeAsset(WORKER_PATH, signal).then((bytes) => {
    api.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
      new Blob([bytes], { type: 'text/javascript' }),
    );
  });

  return worker;
}

/** Rejoin the fragments of one printed word, keeping every other split. */
function fragmentsOf(
  items: readonly RawItem[],
  styles: Readonly<Record<string, RawStyle>>,
): Fragment[] {
  const fragments: Fragment[] = [];

  for (const item of items) {
    if (item.str === '' || item.height === EMPTY) {
      continue;
    }

    const style = styles[item.fontName];
    const ascent = (style?.ascent ?? FALLBACK_ASCENT) * item.height;
    const descent = (style?.descent ?? FALLBACK_DESCENT) * item.height;
    const [, , , , x = 0, baseline = 0] = item.transform;
    const previous = fragments.at(-1);

    if (
      previous !== undefined &&
      Math.abs(previous.baseline - baseline) < JOIN_BASELINE &&
      x >= previous.x &&
      x - (previous.x + previous.w) < JOIN_GAP
    ) {
      previous.text += item.str;
      previous.w = x + item.width - previous.x;
      previous.ascent = Math.max(previous.ascent, ascent);
      previous.descent = Math.min(previous.descent, descent);
      continue;
    }

    fragments.push({ text: item.str, x, baseline, w: item.width, ascent, descent });
  }

  return fragments;
}

/**
 * One page's fragments as `TextItem`s: top-left origin, y down, page-normalised.
 *
 * PDF coordinates run from the bottom-left with y up, and every box downstream
 * — a row band, an anchor's span, a review crop — assumes the other convention.
 * The flip happens here, once, against the page's own height, so no consumer
 * has to know which way a PDF counts.
 *
 * Boxes are clamped into the page. Validation requires `0 ≤ x,y,w,h ≤ 1` with
 * `x+w ≤ 1` and `y+h ≤ 1`, and a glyph whose declared box overhangs the media
 * box by a rounding error would otherwise fail a gate it has no business
 * failing.
 */
function itemsOf(
  page: number,
  fragments: readonly Fragment[],
  width: number,
  height: number,
): TextItem[] {
  return fragments.map((fragment, index) => {
    const x = clamp(fragment.x / width);
    const y = clamp((height - (fragment.baseline + fragment.ascent)) / height);

    return {
      id: `p${String(page)}-f${String(index)}`,
      text: fragment.text,
      x,
      y,
      w: clamp(fragment.w / width, 1 - x),
      h: clamp((fragment.ascent - fragment.descent) / height, 1 - y),
    };
  });
}

function clamp(value: number, upper = 1): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), upper);
}

function assertLive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('extraction cancelled', 'AbortError');
  }
}

/**
 * Read one PDF's text layer, one array of observations per page.
 *
 * The items are what pdf.js measured. Nothing is reordered, dropped for being
 * unlikely, or given a confidence: a text layer has no recognition confidence
 * to report, and `TextItem.confidence` is left absent rather than filled with a
 * comfortable 1 that would later read as evidence.
 *
 * Cancellation is honoured between pages and by destroying the loading task, so
 * an abandoned attach stops paying for itself immediately.
 */
export async function extractPdfText(file: File, signal: AbortSignal): Promise<TextItem[][]> {
  assertLive(signal);

  const api = await library();
  await useSelfHostedWorker(api, signal);
  assertLive(signal);

  const task = api.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // D1: nothing is fetched while reading. `useSystemFonts` would reach for
    // the host's font stack, `useWorkerFetch` would let the worker open its
    // own requests, and `disableAutoFetch` stops pdf.js speculatively pulling
    // ranges of a file it was handed whole. The CSP carries no
    // `'unsafe-eval'`, so the library's evaluated paths are already closed to
    // it by the browser.
    useSystemFonts: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    stopAtErrors: false,
  });

  const cancel = (): void => void task.destroy();
  signal.addEventListener('abort', cancel, { once: true });

  try {
    const document = await task.promise;
    const pages: TextItem[][] = [];

    for (let page = 1; page <= document.numPages; page += 1) {
      assertLive(signal);

      const rendered = await document.getPage(page);
      const viewport = rendered.getViewport({ scale: 1 });
      const content = await rendered.getTextContent();

      pages.push(
        itemsOf(
          page,
          fragmentsOf(content.items as unknown as RawItem[], content.styles),
          viewport.width,
          viewport.height,
        ),
      );
    }

    return pages;
  } finally {
    signal.removeEventListener('abort', cancel);
    await task.destroy().catch(() => undefined);
  }
}

/** The only adapter this product ships (D3, ADR-0013). */
export const pdfTextAdapter: ExtractionAdapter = {
  id: 'pdf-text',
  tier: 'E0',
  supports(file: File): boolean {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  },
  async extract(file: File, _sourceId: string, signal: AbortSignal): Promise<AdapterOutput> {
    return { kind: 'textItems', pages: await extractPdfText(file, signal) };
  },
};
