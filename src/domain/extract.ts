import type { AhfyDocument } from './ahfyDocument';
import { validateAhfyDocument } from './ahfyDocument';
import { findAnchors } from './anchors';
import { findIdentifierCandidates } from './identifiers';
import { markerKey } from './markerKey';
import { parseNumber } from './numbers';
import { parseRange } from './ranges';
import { readAnchor } from './readout';
import { MARKERS, REGISTRY_VERSION } from './registry';
import { clusterRows } from './rows';
import { tokenise } from './text';
import { isKnownUnit, normaliseUnit } from './units';
import type {
  Anchor,
  Column,
  Confidence,
  ExtractionResult,
  MarkerDef,
  ParseFlag,
  ParsedNumber,
  ParsedRow,
  Rect,
  ReferenceRange,
  Row,
  SourceRef,
  TextItem,
} from './types';

/**
 * The one entry point from an adapter's observations to a review draft.
 *
 * It owns no parsing grammar of its own. Pass V validates and binds the
 * template, `rows.ts` clusters, `anchors.ts` resolves marker identity and
 * `readout.ts` reads the cells around an anchor; this module runs them in
 * order and adds the three things that need the whole document rather than one
 * row — whether a value is plausible for its marker, whether two anchors
 * competed for the same cells, and what to do with a table row the registry
 * does not recognise.
 *
 * Pure domain code: zero DOM, zero I/O, and no browser or vendor runtime
 * objects (D4). The adapter hands over `TextItem[][]` and nothing else.
 */

export interface TextExtractionInput {
  sourceId: string;
  adapterId: string;
  tier: 'E0';
  pages: TextItem[][];
}

/** A printed unit may span whitespace: `x10^3`, `/`, `μL` is one unit. */
const MAX_UNIT_TOKENS = 3;

const PLAUSIBLE = new Map<string, [number, number]>(
  MARKERS.filter(
    (marker): marker is MarkerDef & { plausibleRange: [number, number] } =>
      marker.plausibleRange !== undefined,
  ).map((marker) => [marker.id, marker.plausibleRange]),
);

const RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

function demote(from: Confidence, to: Confidence): Confidence {
  return RANK[to] < RANK[from] ? to : from;
}

/**
 * Validate, cluster, anchor and read one source.
 *
 * Throws when Pass V rejects the document. The gate is the caller's to run —
 * `fileRouter` turns a rejection into a source-scoped `RouteFailure` naming
 * the accepted class — and `ExtractionResult` has no shape for a document
 * without a collection date, so there is nothing honest to return.
 */
export function extract(input: TextExtractionInput): ExtractionResult {
  const validation = validateAhfyDocument(input.pages);
  if (!validation.ok) {
    throw new Error(`not-ahfy-document: ${validation.reason}`);
  }

  const { document } = validation;
  const rows = clusterRows(input.sourceId, input.pages);
  const anchors = findAnchors(rows, document.sectionTitles);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const known = anchors.flatMap((anchor) => {
    const row = byId.get(rowIdOf(anchor.id));
    return row === undefined ? [] : [readAnchor(anchor, row, rows, anchors)];
  });
  const unknown = unknownRows(rows, new Set(anchors.map((anchor) => rowIdOf(anchor.id))), document);

  const competed = competing(anchors);
  const order = new Map(rows.map((row, index) => [row.id, index]));
  const at = (row: ParsedRow): number => order.get(rowIdOf(row.id)) ?? 0;

  const parsed = [...known, ...unknown]
    .sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id))
    .map((row, index) => graded({ ...row, sourceOrder: index }, competed));

  return {
    sourceId: input.sourceId,
    adapterId: input.adapterId,
    tier: input.tier,
    registryVersion: REGISTRY_VERSION,
    rows: parsed,
    collectionDate: document.collectionDate,
    resultDate: document.resultDate,
    identifierCandidates: findIdentifierCandidates(input.sourceId, input.pages),
    // Only a row that stayed unknown is a registry gap. Reading the label
    // column top to bottom reassembles a wrapped label that Pass A could not
    // anchor, and some of those resolve to a canonical marker after all —
    // `alt` and `vitamin-d` both do on the seed document. Reporting those as
    // gaps would send Task 2.5r hunting for aliases the registry already has.
    unrecognised: unknown.filter((row) => row.markerKey.startsWith('x:')).map((row) => row.label),
    evidenceAvailable: true,
    evidencePages: input.pages,
  };
}

/**
 * The row a ParsedRow or Anchor id opens with.
 *
 * Both are derived from their row's id — `…:anchor:<n>` for a marker Pass A
 * anchored, `…:unknown` for one read by column — so document order is
 * recoverable from the id alone, whichever pass produced the row.
 */
function rowIdOf(id: string): string {
  const at = Math.min(
    ...[':anchor:', ':unknown'].map((suffix) => id.indexOf(suffix)).filter((index) => index >= 0),
  );

  return Number.isFinite(at) ? id.slice(0, at) : id;
}

// ---------------------------------------------------------------------------
// Rows the registry does not know
// ---------------------------------------------------------------------------

/**
 * Every table row Pass A could not anchor, read by column (D5).
 *
 * Pass B is gone: the column roles come from the validated header, so a
 * measurement whose label the registry does not know is not a discovery
 * problem — its cells are already bound, and reading them positionally is what
 * keeps eGFR, PDW and the white-cell morphology sub-rows from vanishing before
 * Task 2.5r adds them.
 *
 * Three kinds of row are printed in the same five x-bands and are not
 * measurements, so each is excluded by what Pass V already knows: the title
 * block and the twelve metadata fields, which sit above the first table
 * header; the repeated header rows themselves; and the panel headings Pass V
 * recorded by position. What survives must still read as a measurement — see
 * `reads` — because a letter-spaced banner heading fills the value column
 * without putting anything in it.
 */
function unknownRows(
  rows: readonly Row[],
  anchored: ReadonlySet<string>,
  document: AhfyDocument,
): ParsedRow[] {
  const headers = positions(document.tableHeaders);
  const headings = positions(document.sectionTitles);
  const first = rows.findIndex((row) => headers.has(place(row)));
  if (first < 0) {
    return [];
  }

  return rows.slice(first + 1).flatMap((row) => {
    if (anchored.has(row.id) || headers.has(place(row)) || headings.has(place(row))) {
      return [];
    }

    const read = readByColumn(row, document);
    return read === undefined ? [] : [read];
  });
}

function place(row: { page: number; y: number }): string {
  return `${String(row.page)}:${String(row.y)}`;
}

function positions(rows: readonly { page: number; y: number }[]): Set<string> {
  return new Set(rows.map(place));
}

/** The items whose centre falls in one bound column. */
function cell(row: Row, column: Column): TextItem[] {
  return row.items.filter((item) => {
    const centre = item.x + item.w / 2;
    return centre >= column.xMin && centre < column.xMax;
  });
}

/**
 * Read one row across the five bound columns.
 *
 * The label is read **top to bottom** rather than left to right: a wrapped
 * label's two printed lines start at the same x, so the row's own x-ordering
 * interleaves them with the cells between (`rows.ts` says so and invents no
 * column model). Selecting the label column is what makes reassembly possible,
 * and it is the reason this read lives here rather than in `readout.ts`.
 *
 * Returns nothing when the row does not read as a measurement.
 */
function readByColumn(row: Row, document: AhfyDocument): ParsedRow | undefined {
  const { columns } = document;
  const label = [...cell(row, columns.label)].sort((a, b) => a.y - b.y || a.x - b.x);
  const values = cell(row, columns.value);
  const units = cell(row, columns.unit);
  const ranges = cell(row, columns.range);

  const printed = label.map((item) => item.text).join(' ');
  if (label.length === 0 || printed.trim() === '') {
    return undefined;
  }

  const value = readValue(values);
  const unit = readUnit(units);
  const range = readRange(ranges);

  if (!reads(value, unit, range)) {
    return undefined;
  }

  // A row the registry does not recognise is `low` and stays there: every
  // flag below is a further reason to doubt it, and none can promote it.
  const flags: ParseFlag[] = [];

  if (value?.ambiguousThousands === true) {
    flags.push('ambiguous-thousands');
  }
  if (range?.parsed === null) {
    flags.push('unparsed-range');
  }
  if (unit !== undefined && !unit.recognised) {
    flags.push('unrecognised-unit');
  }

  const categorical = value === null && values.length > 0 ? text(values) : null;

  return {
    id: `${row.id}:unknown`,
    label: printed,
    markerKey: markerKey(printed),
    status: value !== null ? 'value' : categorical !== null ? 'categorical' : 'missing',
    value: value?.value ?? null,
    comparator: value?.comparator ?? null,
    textValue: value === null ? categorical : null,
    unit: value === null && categorical !== null ? null : (unit?.text ?? null),
    referenceRange: value === null && categorical !== null ? null : (range?.parsed ?? null),
    categoricalReference:
      value === null && categorical !== null && ranges.length > 0 ? text(ranges) : null,
    confidence: 'low',
    source: 'anchor',
    section: null,
    flags,
    sourceOrder: 0,
    sourceRef: refOf(row, [...label, ...values, ...units, ...ranges]),
  };
}

/**
 * Whether the row's non-label cells hold a measurement at all.
 *
 * A letter-spaced banner heading — `Γ Ε Ν Ι Κ Η   Ε Ξ Ε Τ Α Σ Η` — spans the
 * whole width and so fills the value column, which is exactly why § V5 says it
 * is not a marker. The repeated table header does the same with the five
 * heading words. Neither prints a number, an interval or a unit anyone knows,
 * and requiring one of those three is the difference between reading a row
 * whose label the registry lacks and reading the page's own furniture.
 */
function reads(
  value: ParsedNumber | null,
  unit: Unit | undefined,
  range: Interval | undefined,
): boolean {
  return value !== null || unit?.recognised === true || range?.parsed != null;
}

function text(items: readonly TextItem[]): string {
  return items
    .map((item) => item.text)
    .join(' ')
    .trim();
}

/**
 * The value cell's number.
 *
 * `parseNumber` already joins a standalone comparator to the number after it,
 * so the cell is offered whole and then by its leading tokens: a cell holding
 * both a number and a word — `6.0 Όξινη` — is the number, with the
 * laboratory's gloss discarded (D15).
 */
function readValue(items: readonly TextItem[]): ParsedNumber | null {
  const tokens = items.flatMap((item) => tokenise(item).map((token) => token.text));

  for (let length = Math.min(2, tokens.length); length >= 1; length -= 1) {
    const parsed = parseNumber(tokens.slice(0, length));
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

interface Unit {
  text: string;
  recognised: boolean;
}

/** The unit cell, folded; the allowlist decides only how many tokens it spans. */
function readUnit(items: readonly TextItem[]): Unit | undefined {
  const tokens = items.flatMap((item) => tokenise(item).map((token) => token.text));

  for (let length = Math.min(MAX_UNIT_TOKENS, tokens.length); length >= 1; length -= 1) {
    const run = tokens.slice(0, length).join(' ');
    if (isKnownUnit(run)) {
      return { text: normaliseUnit(run), recognised: true };
    }
  }

  const printed = tokens.join(' ');
  return printed === '' ? undefined : { text: normaliseUnit(printed), recognised: false };
}

interface Interval {
  parsed: ReferenceRange | null;
}

/**
 * The range cell, with a repeated unit stripped.
 *
 * `parseRange` rejects a trailing token rather than skipping it, so a
 * recognised unit is dropped first — the corpus prints `4,0 - 10,0 k/μl` — and
 * anything else it cannot account for fails loudly as `unparsed-range`.
 */
function readRange(items: readonly TextItem[]): Interval | undefined {
  const tokens = items.flatMap((item) => tokenise(item).map((token) => token.text));
  if (tokens.length === 0) {
    return undefined;
  }

  const last = tokens.at(-1) ?? '';
  const bounded = isKnownUnit(last) ? tokens.slice(0, -1) : tokens;

  return { parsed: bounded.length === 0 ? null : parseRange(bounded) };
}

function refOf(row: Row, items: readonly TextItem[]): SourceRef {
  const ref: SourceRef = {
    sourceId: row.sourceId,
    page: row.page,
    itemIds: items.map((item) => item.id),
  };

  const box = union(items);
  if (box !== undefined) {
    ref.box = box;
  }

  return ref;
}

function union(items: readonly TextItem[]): Rect | undefined {
  const [first] = items;
  if (first === undefined) {
    return undefined;
  }
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

// ---------------------------------------------------------------------------
// Document-wide confidence
// ---------------------------------------------------------------------------

/**
 * The anchors whose read-out neighbourhoods could not have been disjoint.
 *
 * Two anchors on one printed row read outward from boxes that overlap in y,
 * and the stop conditions divide the cells between them by position alone. The
 * division is deterministic, but it is still a judgement about which marker
 * the shared cells belong to, so both rows say so and neither is trusted at
 * full tier.
 */
function competing(anchors: readonly Anchor[]): Set<string> {
  const perRow = new Map<string, Anchor[]>();

  for (const anchor of anchors) {
    const id = rowIdOf(anchor.id);
    perRow.set(id, [...(perRow.get(id) ?? []), anchor]);
  }

  return new Set(
    [...perRow.values()]
      .filter((group) => group.length > 1)
      .flatMap((group) => group.map((anchor) => anchor.id)),
  );
}

/**
 * The two demotions that need more than the printed row.
 *
 * `readout.ts` grades what it read; these compare a row against the registry
 * and against the document's other anchors, which only this module can see.
 * Demotion takes the worse of current and target, and nothing here promotes.
 */
function graded(row: ParsedRow, competed: ReadonlySet<string>): ParsedRow {
  const flags: ParseFlag[] = [...row.flags];
  let confidence = row.confidence;

  const bound = PLAUSIBLE.get(row.markerKey);
  if (row.value !== null && bound !== undefined && (row.value < bound[0] || row.value > bound[1])) {
    // Retained, never clamped and never dropped: review sorts it to the top
    // and the user decides whether the laboratory or the parser is wrong.
    flags.push('implausible-value');
    confidence = demote(confidence, 'low');
  }

  if (competed.has(row.id)) {
    flags.push('competing-anchor');
    confidence = demote(confidence, 'medium');
  }

  return { ...row, confidence, flags };
}
