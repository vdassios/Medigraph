import { normaliseLabel } from './text';
import type { IdentifierCandidate, Rect, SourceRef, TextItem } from './types';

/**
 * D7 identifier detection: what the scrub panel must ask about.
 *
 * A candidate is a question, not a verdict. Every one must be redacted, have
 * its row deleted, or be dismissed as a false positive before Confirm enables,
 * so raising one costs a review tap and missing one costs the promise. That
 * asymmetry decides every judgement here: detect what is labelled or
 * unmistakably shaped, and never guess from shape alone at anything a
 * laboratory prints in bulk.
 *
 * This module detects; it resolves nothing. Pass V (`ahfyDocument.ts`)
 * pre-resolves the six known ΑΗΦΥ positions as `redacted`, and those
 * resolutions remain the user's to reverse.
 */

type IdentifierKind = IdentifierCandidate['kind'];

/**
 * The three high-confidence shapes, shared with `assertProfileSafe`.
 *
 * They are declared here, in the D7 module, and imported by the final safety
 * gate rather than restated there: a detector and a gate that disagree about
 * what an AMKA looks like would leave exactly the hole D7 exists to close.
 */
const AMKA_SOURCE = String.raw`\b\d{11}\b`;
const EMAIL_SOURCE = String.raw`[^\s@]+@[^\s@]+\.[A-Za-z]{2,}`;
const PHONE_SOURCE = String.raw`(?:\+30[\s-]?)?\b(?:2\d|69)\d(?:[\s-]?\d){7}\b`;

/** Greek AMKA: eleven consecutive digits. */
export const AMKA_PATTERN = new RegExp(AMKA_SOURCE, 'u');
export const EMAIL_PATTERN = new RegExp(EMAIL_SOURCE, 'u');
/** Greek mobile and landline shapes, with or without +30, spaced or dashed. */
export const PHONE_PATTERN = new RegExp(PHONE_SOURCE, 'u');

/**
 * The word-boundary anchors are what keep these off medical numbers. A
 * reference range, a specific gravity and a sediment count are all short, so
 * the eleven-digit rule cannot fire on `1031`; and it cannot fire *inside* the
 * twenty-six-digit repository code either, because a boundary is required at
 * both ends. That code is caught by its label instead.
 */
const SCANNED_PATTERNS: readonly (readonly [IdentifierKind, RegExp])[] = [
  ['national-id', new RegExp(AMKA_SOURCE, 'gu')],
  ['email', new RegExp(EMAIL_SOURCE, 'gu')],
  ['phone', new RegExp(PHONE_SOURCE, 'gu')],
];

/**
 * The ΑΗΦΥ metadata fields whose *value* is identifying, keyed by their
 * label-normalised label.
 *
 * The first six are the plan's identifier positions — a Greek surname is
 * unreachable by any pattern, and only its label says what it is. The last
 * three are the document's opaque ids: the seed fixtures' own identity
 * denylist redacts all three, because each is a handle the issuing repository
 * can resolve back to a person.
 *
 * Four labelled fields are deliberately absent. Both dates are data the user
 * confirms rather than scrubs, `Ειδικότητα Ιατρού` is a medical specialty and
 * names nobody, and `Επωνυμία Εργαστηρίου` is retained as the Report's
 * laboratory label — the plan states outright that it is not an identifier.
 */
const IDENTIFYING_LABELS = new Map<string, IdentifierKind>();

for (const [label, kind] of [
  ['ΑΜΚΑ', 'national-id'],
  ['ΑΜΚΑ Ιατρού', 'national-id'],
  ['Επώνυμο', 'name'],
  ['Όνομα', 'name'],
  ['Επώνυμο Ιατρού', 'name'],
  ['Όνομα Ιατρού', 'name'],
  ['Αρ. Υπόθεσης', 'patient-id'],
  ['Αριθμός Παραγγελίας', 'patient-id'],
  ['Κωδικός', 'patient-id'],
] as const satisfies readonly (readonly [string, IdentifierKind])[]) {
  IDENTIFYING_LABELS.set(normaliseLabel(label), kind);
}

/**
 * One printed line: the items that share it, each paired with where its text
 * starts in the line's joined text.
 *
 * Joining is what lets one pass read both shapes of the same page — the
 * fragmented items pdf.js emits (`ΑΜΚΑ:` beside `01018099901`, or a label
 * split across `Αρ.` and `Υπόθεσης:`) and a whole-line reconstruction. The
 * separator is a space rather than nothing on purpose: two adjacent fragments
 * of digits must never be read as one longer number.
 */
interface Placed {
  item: TextItem;
  start: number;
}

interface Line {
  page: number;
  placed: Placed[];
  text: string;
}

/** Two items share a line when their vertical extents overlap at all. */
function sharesLine(a: TextItem, b: TextItem): boolean {
  return a.y < b.y + b.h && b.y < a.y + a.h;
}

function linesOf(items: readonly TextItem[], page: number): Line[] {
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];

  for (const item of ordered) {
    const line = lines.at(-1);
    const first = line?.placed[0];

    if (line === undefined || first === undefined || !sharesLine(first.item, item)) {
      lines.push({ page, placed: [{ item, start: 0 }], text: item.text });
      continue;
    }

    line.placed.push({ item, start: line.text.length + 1 });
    line.text = `${line.text} ${item.text}`;
  }

  return lines;
}

function union(items: readonly TextItem[]): Rect | undefined {
  const first = items[0];
  if (first === undefined) {
    return undefined;
  }

  // One item is its own union. Recomputing `w` as `right - x` would return a
  // box a floating-point hair different from the box the adapter measured.
  if (items.length === 1) {
    return { x: first.x, y: first.y, w: first.w, h: first.h };
  }

  let x = first.x;
  let y = first.y;
  let right = first.x + first.w;
  let bottom = first.y + first.h;

  for (const item of items) {
    x = Math.min(x, item.x);
    y = Math.min(y, item.y);
    right = Math.max(right, item.x + item.w);
    bottom = Math.max(bottom, item.y + item.h);
  }

  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Point review at the span `[start, end)` of a line's joined text.
 *
 * `textRange` is set only when one item holds the whole span, because it
 * addresses offsets *within that item's own text* — a range spanning a joined
 * separator would index text no item contains.
 */
function sourceRefFor(line: Line, sourceId: string, start: number, end: number): SourceRef {
  const crossed = line.placed.filter(
    (placed) => placed.start < end && start < placed.start + placed.item.text.length,
  );

  const ref: SourceRef = { sourceId, page: line.page };

  const box = union(crossed.map((placed) => placed.item));
  if (box !== undefined) {
    ref.box = box;
  }
  if (crossed.length > 0) {
    ref.itemIds = crossed.map((placed) => placed.item.id);
  }

  const only = crossed.length === 1 ? crossed[0] : undefined;
  if (only !== undefined) {
    ref.textRange = {
      itemId: only.item.id,
      start: start - only.start,
      end: end - only.start,
    };
  }

  return ref;
}

interface Found {
  kind: IdentifierKind;
  text: string;
  sourceRef: SourceRef;
}

/**
 * `<label>: <value>` on one line, where the label is one this document class
 * fixes and the value is what it identifies.
 *
 * The label is matched whole, against everything before the line's first
 * colon, so `ΑΜΚΑ Ιατρού` can never be read as `ΑΜΚΑ`, and a printed
 * `Φυσιολογική Τιμή: <150` matches nothing at all.
 */
function labelledValue(line: Line, sourceId: string): Found | undefined {
  const colon = line.text.indexOf(':');
  if (colon <= 0) {
    return undefined;
  }

  const kind = IDENTIFYING_LABELS.get(normaliseLabel(line.text.slice(0, colon)));
  if (kind === undefined) {
    return undefined;
  }

  const after = line.text.slice(colon + 1);
  const text = after.trim();
  if (text === '') {
    return undefined;
  }

  const start = colon + 1 + after.indexOf(text);
  return { kind, text, sourceRef: sourceRefFor(line, sourceId, start, start + text.length) };
}

function scannedValues(line: Line, sourceId: string): Found[] {
  const found: Found[] = [];

  for (const [kind, pattern] of SCANNED_PATTERNS) {
    for (const match of line.text.matchAll(pattern)) {
      const text = match[0];
      const start = match.index;
      found.push({
        kind,
        text,
        sourceRef: sourceRefFor(line, sourceId, start, start + text.length),
      });
    }
  }

  return found;
}

/**
 * Every identifier candidate one source's text layer offers, in reading order.
 *
 * One candidate per distinct kind and text: review's Redact masks the evidence
 * and removes the substring from every derived field, so a second prompt for
 * the same string resolves nothing and only lengthens the gate. The retained
 * `sourceRef` is the first occurrence — the page the user is shown when they
 * ask what a candidate is.
 *
 * Nothing here is persisted. `IdentifierCandidate.text` lives as long as the
 * review session and no longer.
 */
export function findIdentifierCandidates(
  sourceId: string,
  pages: readonly (readonly TextItem[])[],
): IdentifierCandidate[] {
  const candidates: IdentifierCandidate[] = [];
  const seen = new Set<string>();

  for (const [index, page] of pages.entries()) {
    for (const line of linesOf(page, index + 1)) {
      const labelled = labelledValue(line, sourceId);
      const found = labelled === undefined ? [] : [labelled];
      found.push(...scannedValues(line, sourceId));

      for (const { kind, text, sourceRef } of found) {
        const key = `${kind} ${text}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        candidates.push({
          id: `${sourceId}:identifier:${String(candidates.length + 1)}`,
          kind,
          text,
          sourceRef,
        });
      }
    }
  }

  return candidates;
}
