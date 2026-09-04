import type { SectionTitle } from './ahfyDocument';
import { damerauLevenshtein } from './fuzzy';
import { MARKERS } from './registry';
import { normaliseAbbreviation, normaliseLabel, tokenise } from './text';
import type {
  Anchor,
  Confidence,
  LexicalToken,
  MatchTier,
  Rect,
  Row,
  SourceRef,
  TextItem,
} from './types';

/**
 * PASS A — marker anchoring.
 *
 * Marker-anchored parsing is the only pass (D5), so this module answers the one
 * hard question left: which registry marker, if any, a printed row is about.
 * It reads no value and touches no cell to the right of the label.
 *
 * The search is deterministic and tier-wide. Every candidate is tried at T1
 * before any is tried at T2, and so on down, so a short alias can never win by
 * being visited first. Within the first tier that hits, the longest matched
 * spans are kept, ties going to the leftmost.
 */

const CONFIDENCE: Record<MatchTier, Confidence> = {
  T1: 'high',
  T2: 'high',
  T3: 'high',
  T4: 'medium',
};

/** The longest token run a marker phrase is looked for in. */
const MAX_RUN = 5;

/** Bounded fuzzy distance by candidate length: 0 under 5, 1 to 7, then 2. */
function fuzzyBound(length: number): number {
  if (length < 5) {
    return 0;
  }
  return length <= 7 ? 1 : 2;
}

/**
 * The registry, indexed the two ways matching needs it.
 *
 * Abbreviations go through `normaliseAbbreviation` and aliases through
 * `normaliseLabel`: only the abbreviation path folds Greek/Latin confusables,
 * because a whole marker phrase must never be partially transliterated. It is
 * what lets a laboratory's `Lp (α)` reach `Lp(a)`, and `(ΗDL-C)` with a Greek
 * eta reach the Latin spelling.
 */
const BY_ABBREVIATION = new Map<string, string>();
const BY_ALIAS = new Map<string, string>();
const ALIASES: { markerKey: string; text: string }[] = [];
const SECTION_HINTS = new Map<string, string>();

for (const marker of MARKERS) {
  for (const abbreviation of marker.abbreviations) {
    BY_ABBREVIATION.set(normaliseAbbreviation(abbreviation), marker.id);
  }
  for (const alias of marker.aliases) {
    const text = normaliseLabel(alias);
    BY_ALIAS.set(text, marker.id);
    ALIASES.push({ markerKey: marker.id, text });
  }
  if (marker.sectionHint !== undefined) {
    SECTION_HINTS.set(marker.id, normaliseLabel(marker.sectionHint));
  }
}

interface PlacedToken {
  token: LexicalToken;
  item: TextItem;
}

interface Candidate {
  start: number;
  end: number; // exclusive
  text: string; // as printed
  label: string; // normaliseLabel
  abbreviation: string; // normaliseAbbreviation
}

interface Hit {
  candidate: Candidate;
  markerKey: string;
  /** The candidate is `(ABBR)` — the laboratory's own code, not prose. */
  parenthesised: boolean;
}

/**
 * One row's tokens, left to right.
 *
 * A row's items are x-ordered, so this is reading order for the label cell.
 * A wrapped label interleaves its two printed lines here, which is the row's
 * order and not the label's — it costs the wrapped phrase a T2 match, and T1
 * still reaches the marker through the abbreviation beside it.
 */
function placedTokens(row: Row): PlacedToken[] {
  return row.items.flatMap((item) => tokenise(item).map((token) => ({ token, item })));
}

function candidatesOf(tokens: readonly PlacedToken[]): Candidate[] {
  const candidates: Candidate[] = [];

  for (let start = 0; start < tokens.length; start += 1) {
    for (let length = Math.min(MAX_RUN, tokens.length - start); length >= 1; length -= 1) {
      const end = start + length;
      const text = tokens
        .slice(start, end)
        .map((placed) => placed.token.text)
        .join(' ');

      candidates.push({
        start,
        end,
        text,
        label: normaliseLabel(text),
        abbreviation: normaliseAbbreviation(text),
      });
    }
  }

  return candidates;
}

/**
 * T1 — the candidate is a registry abbreviation, standalone or parenthesised.
 *
 * Abbreviations come first because they are lab-invariant *and*
 * language-invariant, the single most reliable signal on a Greek report:
 * `Αριθμός ερυθρών (RBC)`, `Ερυθρά αιμοσφαίρια (RBC)` and `RBC` all resolve
 * alike.
 */
function abbreviationHit(candidate: Candidate): string | undefined {
  const { abbreviation } = candidate;
  const bare =
    abbreviation.startsWith('(') && abbreviation.endsWith(')')
      ? abbreviation.slice(1, -1)
      : abbreviation;

  return BY_ABBREVIATION.get(bare);
}

/** T3 — a registry alias sits whole-word inside the candidate. */
function containmentHit(candidate: Candidate): string | undefined {
  const padded = ` ${candidate.label} `;
  return ALIASES.find((alias) => padded.includes(` ${alias.text} `))?.markerKey;
}

/**
 * T4 — the nearest registry alias within a length-scaled edit distance.
 *
 * A tie between markers is resolved only by a `sectionHint` that exactly one of
 * them declares and the row's nearest heading matches. Every other tie is
 * rejected: a fuzzy match that cannot tell two markers apart is worth less than
 * the review prompt an unknown marker raises.
 *
 * A candidate shorter than five characters is skipped, since its bound is 0 and
 * an exact match would already have hit T2.
 */
function fuzzyHit(candidate: Candidate, section: string | null): string | undefined {
  const bound = fuzzyBound(candidate.label.length);
  if (bound === 0) {
    return undefined;
  }

  let best = bound + 1;
  let nearest = new Set<string>();

  for (const alias of ALIASES) {
    const distance = damerauLevenshtein(candidate.label, alias.text, bound);
    if (distance > bound || distance > best) {
      continue;
    }
    if (distance < best) {
      best = distance;
      nearest = new Set<string>();
    }
    nearest.add(alias.markerKey);
  }

  if (nearest.size === 1) {
    return [...nearest][0];
  }
  if (nearest.size === 0 || section === null) {
    return undefined;
  }

  const hinted = [...nearest].filter((markerKey) => SECTION_HINTS.get(markerKey) === section);
  return hinted.length === 1 ? hinted[0] : undefined;
}

/**
 * The hits of the first tier that has any.
 *
 * Tier-wide, not candidate-wide: every candidate is evaluated at T1 before any
 * is evaluated at T2. Evaluating tier by candidate would let a one-token alias
 * beat the abbreviation two tokens to its right.
 */
function firstTierHits(
  candidates: readonly Candidate[],
  section: string | null,
): { tier: MatchTier; hits: Hit[] } | undefined {
  const tiers: [MatchTier, (candidate: Candidate) => string | undefined][] = [
    ['T1', abbreviationHit],
    ['T2', (candidate) => BY_ALIAS.get(candidate.label)],
    ['T3', containmentHit],
    ['T4', (candidate) => fuzzyHit(candidate, section)],
  ];

  for (const [tier, match] of tiers) {
    const hits = candidates.flatMap((candidate) => {
      const markerKey = match(candidate);
      if (markerKey === undefined) {
        return [];
      }
      const { abbreviation } = candidate;
      return [
        {
          candidate,
          markerKey,
          parenthesised: abbreviation.startsWith('(') && abbreviation.endsWith(')'),
        },
      ];
    });

    if (hits.length > 0) {
      return { tier, hits };
    }
  }

  return undefined;
}

/**
 * A parenthesised abbreviation outranks a bare one in the same row.
 *
 * The ΑΗΦΥ `Περιγραφή` cell prints `<name> (<laboratory code>)`, so a
 * parenthesised abbreviation names the row's marker while a bare one may be
 * part of the prose naming it: `Μέση Περιεκτικότης HGB (MCH) (MCH)` is mean
 * corpuscular haemoglobin, and reading its `HGB` as haemoglobin would chart a
 * measurement the laboratory never reported. Applied at T1 only, where the
 * distinction means something.
 */
function preferParenthesised(tier: MatchTier, hits: readonly Hit[]): Hit[] {
  if (tier !== 'T1') {
    return [...hits];
  }

  const parenthesised = hits.filter((hit) => hit.parenthesised);
  return parenthesised.length > 0 ? parenthesised : [...hits];
}

/**
 * Keep the longest matched spans that neither overlap nor repeat a marker.
 *
 * Overlap is forbidden outright: two anchors over the same source characters
 * would read one printed marker twice. Repetition has to go too, and the ΑΗΦΥ
 * label cell is why — it prints its abbreviation twice, as in
 * `Ερυθρά Αιμοσφαίρια (RBC) (RBC)` and `WBC (WBC)`. Both occurrences hit, they
 * do not overlap, and emitting both would turn one measurement into a duplicate
 * conflict for review to resolve.
 */
function selected(hits: readonly Hit[]): Hit[] {
  const ordered = [...hits].sort(
    (a, b) =>
      b.candidate.end - b.candidate.start - (a.candidate.end - a.candidate.start) ||
      a.candidate.start - b.candidate.start,
  );

  const kept: Hit[] = [];

  for (const hit of ordered) {
    const overlaps = kept.some(
      (other) =>
        hit.candidate.start < other.candidate.end && other.candidate.start < hit.candidate.end,
    );
    const repeats = kept.some((other) => other.markerKey === hit.markerKey);

    if (!overlaps && !repeats) {
      kept.push(hit);
    }
  }

  return kept.sort((a, b) => a.candidate.start - b.candidate.start);
}

function boundingBox(items: readonly TextItem[]): Rect | undefined {
  const [first] = items;
  if (first === undefined) {
    return undefined;
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

  return items.length === 1
    ? { x, y, w: first.w, h: first.h }
    : { x, y, w: right - x, h: bottom - y };
}

/**
 * Point at the matched span alone, never at the run used to find it.
 *
 * Choosing a longer context to search with must not let an anchor swallow the
 * neighbouring value or the marker beside it, so the geometry is the span's own
 * parent boxes — and a `textRange` when one item holds all of it.
 */
function sourceRefFor(row: Row, tokens: readonly PlacedToken[], candidate: Candidate): SourceRef {
  const placed = tokens.slice(candidate.start, candidate.end);
  const items = [...new Set(placed.map((each) => each.item))];

  const ref: SourceRef = {
    sourceId: row.sourceId,
    page: row.page,
    itemIds: items.map((item) => item.id),
  };

  const box = boundingBox(items);
  if (box !== undefined) {
    ref.box = box;
  }

  const only = items.length === 1 ? items[0] : undefined;
  const first = placed[0];
  const last = placed.at(-1);
  if (only !== undefined && first !== undefined && last !== undefined) {
    ref.textRange = { itemId: only.id, start: first.token.start, end: last.token.end };
  }

  return ref;
}

/**
 * Where a heading is printed, keyed for exact lookup.
 *
 * The titles come from Pass V's clustering of the same pages, so a marker row's
 * own `page` and `y` match a title's exactly when that row *is* the heading.
 */
function positionsOf(sectionTitles: readonly SectionTitle[]): Set<string> {
  return new Set(sectionTitles.map((section) => `${String(section.page)}:${String(section.y)}`));
}

/** The nearest heading at or above a row, carrying across pages. */
function sectionAbove(sectionTitles: readonly SectionTitle[], row: Row): string | null {
  let nearest: string | null = null;

  for (const section of sectionTitles) {
    if (section.page < row.page || (section.page === row.page && section.y <= row.y)) {
      nearest = section.title;
    }
  }

  return nearest;
}

/**
 * Every marker one document's rows anchor, in reading order.
 *
 * `sectionTitles` are Pass V's, and are what A3's nearest-heading tracking and
 * the T4 tie-break read. Pass a document's own list; an empty one simply leaves
 * every `section` null and rejects every T4 tie.
 */
export function findAnchors(
  rows: readonly Row[],
  sectionTitles: readonly SectionTitle[],
): Anchor[] {
  const anchors: Anchor[] = [];

  const headings = positionsOf(sectionTitles);

  for (const row of rows) {
    // A section marker emits no ParsedRow (V4), so it anchors no marker
    // either: a panel heading printing `Γλυκόζη (GLU)` names the table below
    // it, and reading it as a glucose measurement would invent one.
    if (headings.has(`${String(row.page)}:${String(row.y)}`)) {
      continue;
    }

    const section = sectionAbove(sectionTitles, row);
    const tokens = placedTokens(row);
    const found = firstTierHits(
      candidatesOf(tokens),
      section === null ? null : normaliseLabel(section),
    );

    if (found === undefined) {
      continue;
    }

    const hits = selected(preferParenthesised(found.tier, found.hits));

    for (const [index, hit] of hits.entries()) {
      anchors.push({
        id: `${row.id}:anchor:${String(index + 1)}`,
        markerKey: hit.markerKey,
        label: hit.candidate.text,
        tier: found.tier,
        confidence: CONFIDENCE[found.tier],
        section,
        sourceRef: sourceRefFor(row, tokens, hit.candidate),
      });
    }
  }

  return anchors;
}
