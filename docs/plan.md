# Medigraph — master plan

> **This document is the source of truth for this repository.**
>
> It defines the architecture, the 15 binding decisions (`D1`–`D13`, including `D1a` and `D5a`), the extraction
> pipeline, the chart specifications, the file format, the frontend toolchain, and the
> delegated task breakdown. Everything built here must conform to it.
>
> - **Decisions are binding.** The "Decisions already made" table is not a menu.
>   Do not re-litigate an entry; if one is genuinely wrong, change it here first,
>   record the change as an ADR under `docs/adr/`, and only then change code.
> - **Task issues derive from this file.** Each task in the breakdown becomes one
>   GitHub issue labelled `ready-for-agent`, linking back to its section here.
> - **Ambiguity is a bug in this document.** Builder models must not resolve it by
>   choosing — they stop and comment on the issue, and the resolution lands here.
> - **Keep it current.** When implementation diverges from the plan, update the
>   plan in the same change. A stale master plan is worse than none.
>
> Last revised: 2026-08-29.

---

## Context

**The problem.** People accumulate lab results as loose PDFs and phone photos, one
per year, from different labs, in different languages. Any single report tells you
whether a marker is in range *today*. What nobody can see is all of it at once:
every ferritin result they have ever been given, side by side, with the reference
range each lab printed at the time. That data is already in the user's possession —
it is just trapped in unstructured documents.

**What we're building.** A web app where the user attaches several lab-result files
(PDF or image), and gets back a per-marker time series: every recorded value for each
biological marker across every test they've supplied, each shown against the reference
range its own lab printed. Default view is a panel of every
marker in the most recent report; tapping a marker opens its history over time
against its reference range. The user can switch the panel to any other report.

**Input shape.** The user attaches PDFs (and photos/scans, which route through E1).
One source file holds **at most one visit's results** — a file is never split across
Reports, which is why `regroupSources` takes a partition of source ids rather than a
finer-grained mapping. The converse is **not** true and is common in practice: one
visit is frequently emailed as several files, typically one per department
(haematology, biochemistry, hormones). Merging several sources into one Report is
therefore a first-class flow, not an edge case, and the grouping proposal must be good
at it. Reports usually fall roughly one per year because that is how often people test,
but nothing in the model assumes that: dates are read from the documents and a Profile
may hold any number of Reports in a year.

**The hard constraint.** The Medigraph operator never receives or stores medical
data, and **no medical data leaves the user's device.** That is the invariant. The
browser does store the confirmed `Profile` locally in plaintext IndexedDB, and an
exported `.medigraph` file is also plaintext. Those copies belong to the user, not to
the operator, but they remain sensitive on a shared, lost or compromised device.
Source documents, raw OCR text and review evidence are transient and are never
persisted. All runtime code, models, workers and WASM are self-hosted static assets —
a cost and compliance choice rather than a mandate — and there is no telemetry and no
error reporting. Third-party *inbound* asset fetches are permitted but must be declared
in D1's `connect-src` allowlist, which is empty in v1.

**Why this shape.** Keeping content on-device sharply reduces what the operator can
access, but it is not a legal conclusion and it does not eliminate device, browser,
XSS or software-supply-chain risk. There is an accuracy trade — a local rules parser
is weaker than a large vision model — but the mandatory **review-and-correct** step
between extraction and charting does not rest on that trade alone, and so does not
disappear if extraction improves. It stands on three independent grounds:

1. **Silent-failure containment.** The parser fails loudly: it emits `ParseFlag`s and
   a `Confidence` that review sorts on. A generative extractor resolves an ambiguous
   `1`/`7` silently and reports nothing. A wrong-but-plausible value that never
   surfaces in review is the worst outcome this product has.
2. **The D7 identifier scrub**, a hard persistence gate that no extractor discharges.
3. **The D6 date, grouping and same-person gates**, which are user confirmations
   rather than extraction results.

That step is not a fallback — it is the product's honesty mechanism. The
vision-model appendix records why no extractor, on-device or off-device, removes it.

**Deliberately left open.** v1 does everything client-side: pdf.js for text-layer
PDFs, the OCR engine selected by Task 0.7 for images, and a marker-anchored parser
over both. A future *on-device* document-vision adapter (**E2-local**) remains
possible behind the extraction seam. An *off-device* one (**E2-remote**) — whether a
third-party API or a server we operate ourselves — would replace D1 with a different
privacy posture; it is not a D1-conforming tier and no dormant remote-upload code
ships in v1.

**Delegation.** The work below is decomposed for less-capable builder models. Every
task names exact files, exact exported signatures, exhaustive behaviour rules,
fixtures with expected outputs, and a pass/fail command. No task contains a design
decision. The decisions all live in this document.

---

## Decisions already made (do not re-litigate)

| # | Decision | Rationale |
|---|---|---|
| D1 | **No user-data egress.** No document content, raw or OCR text, crop, identifier, confirmed value or anything derived from them leaves the device — not to Medigraph's own origin, not to any third party. There is no telemetry and no error reporting. Third-party *inbound* asset fetches are permitted but must be **declared**: `connect-src` carries an explicit origin allowlist (empty in v1, because every runtime asset is self-hosted), and any request to a non-`self` origin must be a GET or HEAD with no query string, no request body and no app-set header. `WebSocket`, `EventSource`, `sendBeacon` and `RTCPeerConnection` are never constructed. Adding an allowlisted origin is an ordinary code-review decision checked against the data rule; transmitting user data requires an ADR superseding this one. | The enforceable line is *what leaves the device*, not *which origins are contacted*. Stated as a data rule it stays honest under GDPR — Medigraph is never a controller for health data it never receives — while leaving room to add a third-party asset host without amending this plan. Self-hosting remains the default because it is free on the Cloudflare Pages target and avoids the consent obligation a third-party fetch would trigger (a CDN fetch discloses the visitor's IP; see ADR-0009). The v1 CSP, service-worker policy and the slimmed Task 5.2 regression test enforce the allowlist and the request-shape rule together; none of them is a security proof against already-malicious same-origin code. |
| D1a | **Extraction modes (`E0`/`E1`; `E2` splits into `E2-local` and `E2-remote`).** **E0** = pdf.js text layer. **E1** = the Task 0.7-selected in-browser Greek OCR engine. E1 is a shipping default only after the real image→OCR release gate passes; otherwise it ships clearly labelled assisted/beta while E0 remains supported. **E2-local** names a possible future *on-device* document-VLM adapter: it conforms to D1's data rule, and is blocked today on Greek coverage, on the absence of a browser runtime path, and on the Task 5.5 device gate — not on privacy. **E2-remote** names *off-device* inference of any kind, **including a server we operate ourselves**; it transmits document content off the device, therefore violates D1's data rule, and requires a new ADR, privacy copy, threat model and separately built consent flow. No E2 code or endpoint of either kind is present in v1. | E0/E1 keep document content on the device, and E2-local would too. The split exists because the undifferentiated `E2` invited two errors: reading "vision model" as inherently privacy-breaking, and reading "self-hosted" as inherently privacy-preserving. Neither holds — the test is whether the bytes leave the device, so our own VPS is barred on exactly the same rule as a third-party API. Note also that D1's origin allowlist does *not* open a path for E2-remote: it is barred by the data rule, not the origin rule, so declaring an origin can never authorise it. See ADR-0011 and the vision-model appendix. |
| D2 | **Astro 5 static output + one Preact application island.** Deployed to Cloudflare Pages as pure static assets. No Workers, adapter or SSR. Marketing/privacy routes hydrate nothing; `MedigraphApp` alone owns interactive state. | Static delivery preserves the deployment/privacy shape, while one island gives the attach→review→commit transaction a single owner. |
| D3 | **All v1 extraction is local and deterministic.** `pdfjs-dist` handles E0. Task 0.7 must prove PP-OCRv5 Greek ONNX (`PP-OCRv5_mobile_det` + `el_PP-OCRv5_mobile_rec`) in supported browsers; if it fails, the recorded fallback is `tesseract.js` with `ell+eng`. The selected engine, models, dictionary and WASM are self-hosted under `public/` and loaded lazily. | PP-OCRv5 has the better model fit but no official Greek ONNX browser path. The spike decides before Wave 3, and the OCR corpus—not vendor accuracy—decides whether E1 is release-ready. |
| D4 | **One extraction seam, two observation shapes, one review draft.** An `ExtractionAdapter` emits either positioned `TextItem` observations or direct `ParsedRow` observations. Both converge into an `ExtractionResult` containing rows, date candidates, identifier candidates and source references before review. E0/E1 must provide row/evidence provenance; direct rows may omit it but must still provide date/identifier evidence. `TextItem.confidence` remains optional. | This keeps parser fixtures independent of PDF/OCR while preserving the evidence mandatory review needs. Domain-valued provenance enables page/crop inspection without coupling downstream code to an adapter; a future direct adapter can report source-unavailable explicitly. |
| D5 | **Marker-anchored parsing is primary; layout parsing is secondary.** We locate known biological markers anywhere on the page, then read outward from each one. Layout/column analysis runs as a *second* pass, only to discover measurements whose label we don't recognise. | Layouts differ per lab; marker names barely do. Anchoring on the marker makes the parser layout-agnostic by construction. See the pipeline spec. |
| D5a | **The marker registry is the product's core asset, not a lookup table.** Its Greek alias coverage determines extraction quality more than any other single factor, and it is versioned, corpus-tested and scored. | Direct consequence of D5: if the parser is marker-driven, registry coverage *is* parser quality. |
| D6 | **Mandatory transactional review.** One attach batch produces one review session. Nothing is charted or persisted until all dates, report groupings, conflicts and identifier candidates are resolved and the user confirms the whole batch. Low-confidence rows sort first; every row can be edited, deleted or reassigned, and every E0/E1 row can be inspected at its source page/crop. | A silent misparse becomes a wrong health chart. A batch transaction prevents half-reviewed files from leaking into history. |
| D7 | **Identifier scrub is a hard persistence gate.** The persisted schema has no identity fields. Every identifier candidate must be redacted, have its row deleted, or be explicitly dismissed as a false positive before Confirm enables. Unknown labels are always included in the scrub surface. All references to source files, object URLs, bitmaps, raw text and crops are released on confirm/cancel and never enter IndexedDB, Cache Storage or export. | Merely displaying PII candidates does not enforce the promise. The residual free-text path is an approved unknown-marker label, so it needs both review and a final safety validator. |
| D8 | **Plaintext IndexedDB for one anonymous local Profile.** The app persists only confirmed `Profile` data. Before appending to a non-empty Profile, the user must confirm that the new reports belong to the same person; no patient identity is stored. | This provides useful returning-user history without implying at-rest protection. The privacy page must disclose shared-device, XSS, backup/sync and browser-eviction risks. |
| D9 | **Plaintext, versioned `.medigraph` JSON; no encryption or decryption.** Export is a transparent JSON envelope around one validated `Profile`, with explicit sensitivity warnings and size limits. Import offers previewed Cancel/Replace/Merge semantics and never silently overwrites local data. | Passphrases and recovery complexity are unnecessary for v1. Plaintext is an intentional usability trade-off, not a security feature; users must be told to store the file as they would the original lab reports. |
| D10 | **No LOINC codes in v1.** Canonical marker registry uses our own stable string IDs. | LOINC codes are a hallucination magnet for builder models and buy nothing at this stage. |
| D11 | **Charts are hand-written SVG Preact components.** No charting library. | Only two chart forms are needed, both simple; a library costs more bundle than it saves, and hand-rolled SVG gives us the accessibility and touch behaviour the spec below requires. |
| D12 | **No dual-axis charts, ever.** Markers with different units are never overlaid on one y-scale. | Universal data-viz rule; see chart specs. |
| D13 | **Display only: Medigraph never characterises a value or a trend.** Every status string is traceable to the reference range the lab itself printed. No severity language, no clinical inference, no trend direction, slope, rate of change or delta badge, in any view or in any product copy. Marketing copy states a capability (see your own data over time), never a clinical insight. | Under [MDCG 2019-11](https://health.ec.europa.eu/system/files/2020-09/md_mdcg_2019_11_guidance_en_0.pdf) the manufacturer's stated **intended purpose** is the primary qualification trigger, and interpretive software lands under MDR Rule 11 at Class IIa or above — notified body, CE marking, QMS. Display-only positioning stays outside that regime at almost no cost, because the chart specs were already written this way. This is a design constraint recorded for engineering purposes, not legal advice. |

The accepted ADRs for D1, D1a, D3, D4, D6/D7, D8, D9 and D13 live under `docs/adr/`,
along with ADR-0008, which scopes the CSP style directives. **ADR-0009 supersedes
ADR-0001** and is the current record for D1: the original decision mandated self-hosted
content-hashed assets and forbade all third-party origins, which was stricter than the
requirement and imposed permanent build tooling for a threat model it could not prove
anything about. ADR-0010 records D13. **ADR-0011** records why no vision-language
model ships in v1 — in any deployment, ours included — and splits E2 into E2-local and
E2-remote. The domain vocabulary below is mirrored in root `CONTEXT.md`. Any future
E2-remote proposal must supersede D1/D1a explicitly rather than weakening their tests
behind a feature flag; declaring an allowlisted origin is never sufficient to
authorise it.

---

## Glossary (use these exact terms in code, tests, issues and UI)

| Term | Meaning |
|---|---|
| **Source file** | A PDF or image the user attaches. |
| **TextItem** | One positioned text observation with stable `id`, text, rectangle and optional adapter confidence. Coordinates are page-normalised: top-left origin, y increasing downward, all values in `[0,1]`. |
| **Row** | TextItems clustered by vertical overlap. |
| **ParsedRow** | One ephemeral measurement candidate with a complete parse status, confidence, flags and optional source reference. It is not a persisted Measurement. |
| **ExtractionResult** | One source file's ephemeral review draft: ParsedRows plus date and identifier candidates and optional evidence pages. |
| **Review session** | The transactional draft for one attach batch. It groups sources into proposed Reports and must be fully resolved before Confirm. |
| **Marker** | A biological quantity measured over time (e.g. ferritin). Identified by a **marker key**. |
| **Marker key** | Stable string id. Canonical (`ferritin`) when the registry recognises the label, else derived (`x:<normalised-label>`). |
| **Report** | The confirmed measurements from one collection event. It has a stable opaque id and a user-confirmed local civil date, optionally a minute-precision time. Equal calendar dates do not imply equal Reports. |
| **Measurement** | One confirmed marker result within one Report, stored in the lab's native value, unit and range. A Report contains at most one Measurement per marker key. |
| **Series** | One marker's measurements across all Reports, ordered by date. |
| **Profile** | One anonymous person's complete local dataset. It is the only medical-data object persisted or exported. |
| **Reference range** | The lab's normal interval for a marker, as printed on that report. Belongs to the Measurement, not the Marker — it varies by lab and by year. |

### Field-level contracts

These are the authoritative shapes for Task 0.2. They remain **provisional until the
E0 and E1 walking slices in Task 3.8 pass**; after that task they are frozen. A field
change before or after freeze updates this section and all affected fixtures in the
same change—builders never add convenience fields locally.

```ts
type Confidence = 'high' | 'medium' | 'low';
type Comparator = '<' | '<=' | '>' | '>=';
type ParseStatus = 'value' | 'missing';
type ParseSource = 'anchor' | 'layout' | 'adapter';
type ParseFlag =
  | 'ambiguous-thousands'
  | 'ambiguous-role'
  | 'implausible-value'
  | 'unrecognised-unit'
  | 'unparsed-range'
  | 'competing-anchor'
  | 'low-ocr-confidence';

interface Rect { x: number; y: number; w: number; h: number }
interface SourceTextRange { itemId: string; start: number; end: number } // UTF-16 [start,end)
interface SourceRef {
  sourceId: string;
  page: number;               // 1-based
  box?: Rect;
  itemIds?: string[];
  textRange?: SourceTextRange; // exact span for a whole-line anchor
}
interface TextItem extends Rect {
  id: string;
  text: string;
  confidence?: number;       // [0,1], absent when the adapter has none
}

interface LexicalToken {
  text: string;
  parentItemId: string;
  start: number;             // UTF-16 code-unit offset, inclusive
  end: number;               // UTF-16 code-unit offset, exclusive
}

interface Row {
  id: string;
  sourceId: string;
  page: number;
  items: TextItem[];          // x-ascending, original observations preserved
  y: number;
  h: number;
}

type MatchTier = 'T1' | 'T2' | 'T3' | 'T4';
interface Anchor {
  id: string;
  markerKey: string;
  label: string;
  tier: MatchTier;
  confidence: Confidence;
  section: string | null;
  sourceRef: SourceRef;
}

type ColumnRole = 'label' | 'value' | 'unit' | 'range' | 'unknown';
interface Column { role: ColumnRole; xMin: number; xMax: number }
interface ColumnModel { page: number; yMin: number; yMax: number; columns: Column[] }

interface ParsedNumber {
  value: number;
  comparator: Comparator | null;
  ambiguousThousands: boolean;
}

type ReferenceRange =
  | { kind: 'closed'; min: number; max: number }
  | { kind: 'minOnly'; min: number; comparator: '>' | '>=' }
  | { kind: 'maxOnly'; max: number; comparator: '<' | '<=' };

interface ParsedRow {
  id: string;
  label: string;
  markerKey: string;
  status: ParseStatus;
  value: number | null;
  comparator: Comparator | null;
  unit: string | null;
  referenceRange: ReferenceRange | null;
  confidence: Confidence;
  source: ParseSource;
  section: string | null;
  flags: ParseFlag[];
  sourceOrder: number;
  sourceRef?: SourceRef;
}

interface DateCandidate {
  id: string;
  raw: string;
  date: string;               // YYYY-MM-DD
  time: string | null;        // HH:mm, local civil time
  precision: 'day' | 'minute';
  ambiguous: boolean;
  kind: 'collection' | 'report' | 'print' | 'birth' | 'unknown';
  score: number;
  sourceRef?: SourceRef;
}

interface IdentifierCandidate {
  id: string;
  kind: 'name' | 'national-id' | 'patient-id' | 'phone' | 'email' | 'address' | 'other'; // AMKA is national-id
  text: string;               // transient; never copied into Profile
  sourceRef?: SourceRef;
}

interface ExtractionResult {
  sourceId: string;
  adapterId: string;
  tier: 'E0' | 'E1' | 'E2';
  registryVersion: number;
  rows: ParsedRow[];
  dateCandidates: DateCandidate[];
  identifierCandidates: IdentifierCandidate[];
  unrecognised: string[];
  evidenceAvailable: boolean;
  evidencePages?: TextItem[][]; // transient review evidence only
}

interface CollectedAt {
  date: string;               // YYYY-MM-DD, local civil date
  time: string | null;        // required to distinguish two same-day Reports
  precision: 'day' | 'minute';
}

interface Measurement {
  markerKey: string;
  label?: string;             // allowed only for an approved x:* marker
  status: ParseStatus;
  value: number | null;       // native lab value
  comparator: Comparator | null;
  unit: string | null;        // native lab unit
  referenceRange: ReferenceRange | null; // native lab range
  sourceOrder: number;
}

interface Report {
  id: string;                 // UUID created only when review is confirmed
  collectedAt: CollectedAt;
  measurements: Measurement[]; // markerKey unique within this array
}

interface Profile {
  schemaVersion: 1;
  id: string;                 // opaque UUID, never a patient identifier
  reports: Report[];
}

interface Conflict {
  id: string;
  markerKey: string;
  candidateRowIds: string[];
  resolution: { kind: 'choose'; rowId: string } | { kind: 'edited'; measurement: Measurement } | null;
}

type IdentifierResolution = 'redacted' | 'deleted-row' | 'false-positive';
interface ReviewReportDraft {
  id: string;                 // ephemeral; never persisted as the Report id
  sourceIds: string[];
  groupingConfirmed: boolean;
  targetReportId: string | null; // explicit “add to existing report”, never inferred
  collectedAt: CollectedAt | null;
  dateConfirmed: boolean;
  rows: ParsedRow[];
  conflicts: Conflict[];
}

interface ReviewSession {
  id: string;
  results: ExtractionResult[];
  reportDrafts: ReviewReportDraft[];
  identifierResolutions: Record<string, IdentifierResolution>;
  approvedUnknownRowIds: string[];
  existingReportDateUpdates: Record<string, CollectedAt>;
  samePersonConfirmed: boolean | null;
}

interface ProfileChange {
  updates: Report[];
  additions: Report[];
}

type ProfileMergeConflict =
  | { kind: 'report-id'; existing: Report; incoming: Report }
  | { kind: 'same-day-precision'; existing: Report; incoming: Report };

interface ProfileMergePlan {
  duplicateReportIds: string[];
  updates: Report[];
  additions: Report[];
  conflicts: ProfileMergeConflict[];
}

type ProfileMergeResult =
  | { ok: true; profile: Profile }
  | { ok: false; error: 'report-id-conflict' | 'same-day-precision-conflict' };

interface SeriesPoint {
  reportId: string;
  collectedAt: CollectedAt;
  status: ParseStatus;
  value: number | null;       // converted to Series.unit when possible
  comparator: Comparator | null;
  referenceRange: ReferenceRange | null; // converted by the same factor
  nativeValue: number | null;
  nativeUnit: string | null;
  nativeReferenceRange: ReferenceRange | null;
}

interface Series {
  id: string;                 // `${markerKey}@${unit-or-none}`
  markerKey: string;
  label: string;
  unit: string | null;
  points: SeriesPoint[];
}
```

All ids are non-empty opaque strings; production Report/Profile ids are UUIDs.
Observation/review validation enforces finite coordinates, `0 ≤ x,y,w,h ≤ 1`,
`x+w ≤ 1`, `y+h ≤ 1`, and confidence in `[0,1]` when present. E0/E1
ExtractionResults require `registryVersion === REGISTRY_VERSION`,
`evidenceAvailable:true`, `evidencePages`, a SourceRef on every row/candidate, and
SourceRef item ids/ranges that exist on the referenced 1-based page. `validateProfile`
additionally enforces finite medical numbers, valid Gregorian dates/times, `min ≤ max`, status/value
consistency, one-sided comparator direction, unique Report ids and unique marker keys
per Report. `precision:'day'` requires `time:null`; `precision:'minute'` requires a
valid `HH:mm`. If a date occurs on more than one Report, **every** Report on that date
must be minute-precision and their times must be unique. Append/import may update an
existing Report's time in the same atomic transaction, or the user must cancel.
`status:'value'` requires a finite value;
`status:'missing'` requires `value:null` and `comparator:null` but may retain a
ReferenceRange.

### Required exported signatures

Issue bodies copy these signatures exactly. Implementations may add non-exported
helpers but may not widen inputs, return `any`, or expose browser/vendor types from
`domain/`.

```ts
// types.ts
export function validateProfile(value: unknown): Profile;
export function assertProfileSafe(profile: Profile): void;

// text.ts / numbers.ts / ranges.ts / units.ts / dates.ts
export function normaliseLabel(value: string): string;
export function normaliseAbbreviation(value: string): string;
export function tokenise(item: TextItem): LexicalToken[];
export function parseNumber(tokens: readonly string[]): ParsedNumber | null;
export function parseRange(tokens: readonly string[]): ReferenceRange | null;
export function normaliseUnit(value: string): string;
export function isKnownUnit(value: string): boolean;
export function convert(value: number, from: string, to: string, markerKey: string): number | null;
export function findDateCandidates(sourceId: string, pages: readonly (readonly TextItem[])[]): DateCandidate[];

// fuzzy.ts / markerKey.ts / rows.ts
export function damerauLevenshtein(a: string, b: string, maxDistance: number): number;
export const REGISTRY_VERSION: number;
export function markerKey(label: string): string;
export function clusterRows(sourceId: string, pages: readonly (readonly TextItem[])[]): Row[];

// anchors.ts / readout.ts / columns.ts / grammar.ts / extract.ts
export function findAnchors(rows: readonly Row[]): Anchor[];
export function readAnchor(anchor: Anchor, row: Row, allRows: readonly Row[], anchors: readonly Anchor[]): ParsedRow;
export function inferColumns(rows: readonly Row[]): ColumnModel[];
export function parseLayoutRow(row: Row, model: ColumnModel | null): ParsedRow | null;
export interface TextExtractionInput {
  sourceId: string;
  adapterId: string;
  tier: 'E0' | 'E1';
  pages: TextItem[][];
}
export function extract(input: TextExtractionInput): ExtractionResult;

// identifiers.ts / profile.ts / series.ts
export function findIdentifierCandidates(sourceId: string, pages: readonly (readonly TextItem[])[]): IdentifierCandidate[];
export function proposeReportGroups(results: readonly ExtractionResult[]): ReviewReportDraft[];
export function regroupSources(session: ReviewSession, groups: readonly (readonly string[])[]): ReviewSession;
export function confirmGrouping(session: ReviewSession, draftId: string): ReviewSession;
export function setReportDate(session: ReviewSession, draftId: string, collectedAt: CollectedAt): ReviewSession;
export function targetExistingReport(session: ReviewSession, draftId: string, reportId: string | null): ReviewSession;
export function stageExistingReportDate(session: ReviewSession, reportId: string, collectedAt: CollectedAt): ReviewSession;
export function reassignMarker(session: ReviewSession, rowId: string, markerKey: string, approvedUnknownLabel: string | null): ReviewSession;
export function approveUnknownMarker(session: ReviewSession, rowId: string): ReviewSession;
export function deleteRow(session: ReviewSession, rowId: string): ReviewSession;
export function resolveIdentifier(session: ReviewSession, candidateId: string, resolution: IdentifierResolution): ReviewSession;
export function resolveConflict(session: ReviewSession, conflictId: string, resolution: Conflict['resolution']): ReviewSession;
export function canConfirm(session: ReviewSession, existing: Profile | null): boolean;
export function buildProfileChange(session: ReviewSession, existing: Profile | null): ProfileChange;
export function applyProfileChange(existing: Profile | null, change: ProfileChange, samePersonConfirmed: boolean): Profile;
export function planProfileMerge(existing: Profile, incoming: Profile): ProfileMergePlan;
export function resolveSameDayPrecision(plan: ProfileMergePlan, existingReportId: string, incomingReportId: string, existingTime: string, incomingTime: string): ProfileMergePlan;
export function applyProfileMerge(existing: Profile, plan: ProfileMergePlan): ProfileMergeResult;
export function buildSeries(profile: Profile): Series[];
export function removeReport(profile: Profile, reportId: string): Profile | null;

// corpus scorer
export interface MetricCount { correct: number; total: number }
export interface CorpusScore {
  markerRecall: MetricCount;
  valuePrecision: MetricCount;
  unitPrecision: MetricCount;
  rangePrecision: MetricCount;
}
export function score(expected: readonly ParsedRow[], actual: readonly ParsedRow[]): CorpusScore;

// adapter.ts / pdfText.ts / pdfRaster.ts / preprocess.ts / ocr.ts
export interface ExtractionAdapter {
  readonly id: string;
  readonly tier: 'E0' | 'E1' | 'E2';
  supports(file: File): boolean;
  extract(file: File, sourceId: string, signal: AbortSignal): Promise<AdapterOutput>;
}
export function loadRuntimeAsset(path: string, signal: AbortSignal): Promise<ArrayBuffer>;
export function extractPdfText(file: File, signal: AbortSignal): Promise<TextItem[][]>;
export function rasterisePdfPage(file: File, page: number, signal: AbortSignal): Promise<ImageBitmap>;
export interface PreparedImage { image: ImageBitmap; dispose(): void }
export function preprocess(image: ImageBitmap, signal: AbortSignal): Promise<PreparedImage>;
export interface OcrEngine {
  readonly id: string;
  recognise(image: ImageBitmap, page: number, signal: AbortSignal): Promise<TextItem[]>;
}
export interface RouteProgress { sourceIndex: number; sourceCount: number; page: number; pageCount: number }
export type FileRouteErrorCode =
  | 'unsupported-type' | 'file-too-large' | 'too-many-files' | 'too-many-pages'
  | 'decode-failed' | 'ocr-failed' | 'cancelled';
export type RouteFailure =
  | { scope: 'batch'; code: 'too-many-files' | 'too-many-pages' | 'cancelled' }
  | {
      scope: 'source';
      sourceIndex: number;
      fileName: string;
      code: 'unsupported-type' | 'file-too-large' | 'decode-failed' | 'ocr-failed';
    };
export interface RouteBatchResult { results: ExtractionResult[]; failures: RouteFailure[] }
export function routeFiles(files: readonly File[], signal: AbortSignal, onProgress: (progress: RouteProgress) => void): Promise<RouteBatchResult>;

// fileFormat.ts / storage.ts
export type MedigraphReadError =
  | 'file-too-large' | 'malformed-json' | 'not-medigraph'
  | 'unsupported-version' | 'invalid-profile';
export type ImportResult<T> = { ok: true; value: T } | { ok: false; error: MedigraphReadError };
export interface ImportPreview { profile: Profile; plan: ProfileMergePlan | null }
export function serialiseMedigraph(profile: Profile): string;
export function parseMedigraph(bytes: Uint8Array): ImportResult<Profile>;
export function previewImport(bytes: Uint8Array, existing: Profile | null): ImportResult<ImportPreview>;
export function saveProfile(profile: Profile): Promise<void>;
export function loadProfile(): Promise<Profile | null>;
export function replaceProfile(profile: Profile): Promise<void>;
export function clearAll(): Promise<void>;

// appState.ts
export type AppPhase = 'idle' | 'extracting' | 'reviewing' | 'committing' | 'viewing';
export type AppErrorCode =
  | FileRouteErrorCode | MedigraphReadError
  | 'report-id-conflict' | 'same-day-precision-conflict' | 'commit-failed';
export interface AppState {
  phase: AppPhase;
  profile: Profile | null;
  review: ReviewSession | null;
  progress: RouteProgress | null;
  routeFailures: RouteFailure[];
  error: AppErrorCode | null;
}
export type AppAction =
  | { type: 'extract-started' }
  | { type: 'extract-progressed'; progress: RouteProgress }
  | { type: 'review-ready'; review: ReviewSession; routeFailures: RouteFailure[] }
  | { type: 'review-updated'; review: ReviewSession }
  | { type: 'commit-started' }
  | { type: 'commit-succeeded'; profile: Profile }
  | { type: 'cancelled' }
  | { type: 'failed'; error: AppErrorCode };
export function appReducer(state: AppState, action: AppAction): AppState;

// Preact child-component boundaries; MedigraphApp owns all I/O and persistence
export interface FileDropProps {
  disabled: boolean;
  progress: RouteProgress | null;
  failures: RouteFailure[];
  onFiles(files: File[]): void;
  onCancel(): void;
}
export function FileDrop(props: FileDropProps): JSX.Element;
export interface ReviewTableProps {
  session: ReviewSession;
  existingProfile: Profile | null;
  onChange(session: ReviewSession): void;
  onInspectSource(sourceRef: SourceRef): void;
  onConfirm(): void;
  onCancel(): void;
}
export function ReviewTable(props: ReviewTableProps): JSX.Element;
export interface PanelViewProps {
  profile: Profile;
  reportId: string;
  onSelectReport(reportId: string): void;
  onSelectSeries(seriesId: string): void;
}
export function PanelView(props: PanelViewProps): JSX.Element;
export interface TrendViewProps { series: Series; onBack(): void }
export function TrendView(props: TrendViewProps): JSX.Element;
export interface DataManagerProps {
  profile: Profile | null;
  persistenceGranted: boolean | null;
  onExport(): void;
  onImport(file: File): void;
  onDeleteReport(reportId: string): void;
  onClearAll(): void;
}
export function DataManager(props: DataManagerProps): JSX.Element;
export interface EvidenceResource {
  file: File;
  objectUrls: Set<string>;
  bitmaps: Set<ImageBitmap>;
}
export function MedigraphApp(): JSX.Element;
```

---

## Architecture

```text
src/
  domain/            pure TypeScript, zero DOM, zero I/O — 100% unit-tested
    types.ts             field-level contracts above (frozen by Task 3.8)
    text.ts              label/abbreviation normalisation, lexical tokenising
    numbers.ts           decimal parsing (comma/dot), comparators
    ranges.ts            reference-range parsing
    units.ts             unit normalisation + conversion table
    dates.ts             date parsing, candidate classification + scoring
    registry/            canonical marker registry, one file per panel (el/en aliases)
    fuzzy.ts             bounded edit distance + abbreviation matching
    markerKey.ts         label -> marker key
    anchors.ts           TextItem[] -> Anchor[]     (PASS A: marker detection)
    readout.ts           Anchor -> ParsedRow        (PASS A: spatial read-outward)
    rows.ts              TextItem[] -> Row[]        (shared: vertical clustering, used by BOTH passes)
    columns.ts           Row[] -> ColumnModel       (PASS B: x-clustering + headers)
    grammar.ts           Row + ColumnModel -> ParsedRow  (PASS B)
    extract.ts           runs both passes, reconciles -> ExtractionResult
    identifiers.ts       PII candidate detection
    review.ts            immutable review edits, reassignments + hard gates
    profile.ts           reviewed groups -> Reports; explicit merge/conflict rules
    series.ts            Profile -> Series[]        (alignment, unit reconciliation)
  io/                 browser-only adapters, thin, integration-tested
    pdfText.ts           pdfjs-dist -> TextItem[]
    pdfRaster.ts         pdfjs-dist -> ImageBitmap
    preprocess.ts        E1 input cleanup: EXIF orientation, downscale, deskew (Task 3.3b)
    ocr.ts               selected local OCR engine -> TextItem[] with confidence
    adapter.ts           ExtractionAdapter interface (D4) — the vision-model seam
    fileRouter.ts        File -> ExtractionAdapter output (picks the right adapter)
    fileFormat.ts        plaintext .medigraph serialise/parse/migrate
    storage.ts           IndexedDB via idb
  ui/                 one MedigraphApp island with child components
    MedigraphApp.tsx     owns the attach→review→confirm transaction
  pages/              Astro routes: index (landing), app, privacy
public/
  ocr/                 selected OCR models/dictionary/WASM (self-hosted, plain paths)
  pdf/                 self-hosted pdf.js worker (ships inside the pinned pdfjs-dist package)
  sw.js                static-asset-only app/model cache (Task 3.7)
```

**Data flow.** A batch of `File`s → `fileRouter` → adapters → `ExtractionResult[]`
→ one **review session** (edit, inspect, reassign, group, date, scrub, resolve) → one
atomic Confirm → new or explicitly merged `Report[]` → `Profile` → IndexedDB +
charts. Export is `Profile` → `fileFormat` → download; import is parse → validate →
preview → explicit Cancel/Replace/Merge. Files, raw text and render resources remain
inside the review session and all references are released on Confirm, Cancel or
navigation.

**The seam (D4, D1a).** Everything downstream of `ExtractionResult` is
extraction-agnostic. Swapping an E0/E1 adapter changes `io/`, not review or domain:

```ts
interface ExtractionAdapter {
  readonly id: string;                 // 'pdf-text' | 'ppocr-v5-el' | 'vlm-*' | …
  readonly tier: 'E0' | 'E1' | 'E2';
  supports(file: File): boolean;
  extract(file: File, sourceId: string, signal: AbortSignal): Promise<AdapterOutput>;
}
type AdapterOutput =
  | { kind: 'textItems'; pages: TextItem[][] }
  | {
      kind: 'parsedRows';
      rows: ParsedRow[];
      dateCandidates: DateCandidate[];
      identifierCandidates: IdentifierCandidate[];
      evidenceAvailable: boolean;
    };
```

**Rules that keep the option open** (state these in every `io/` and `domain/` issue):
no module outside `io/` may import `pdfjs-dist` or the selected OCR runtime; no module outside
`io/` may assume an `ExtractionResult` came from text items; `ParsedRow` must be
constructible without TextItem provenance, while `sourceRef` remains optional for
review. A direct-row adapter must supply date and identifier candidates and declare
whether source evidence is available; when false, review displays “source preview
unavailable” instead of inventing one. A builder that reaches through the seam has
broken D1a even if tests pass. The `'E2'` tier literal is unchanged and denotes
**E2-local** — the only kind of vision adapter that could ship under D1. E2-remote
cannot appear behind this seam; it needs an ADR superseding D1/D1a first (ADR-0011).

**Dependencies (pin exact versions).** Baseline: `astro@5`, `@astrojs/preact@4`,
`preact@10`, `pdfjs-dist@5`, `idb@8`, `vitest`, `@playwright/test`. Task 0.7 adds
exactly one OCR stack: `onnxruntime-web` (with a proved wrapper only if needed) for
PP-OCRv5, **or** `tesseract.js` for the fallback—not both in the production bundle.
Packages may be downloaded at build/install time, and all browser runtime bytes are
built or copied under `public/` and served first-party. Astro's own build hashing
applies; there is no separate content-hash manifest (D1, ADR-0009). `Profile` validation on import
is hand-rolled structural and semantic checking against the frozen types—no schema
validator and no crypto dependency. Dev-time tooling versions—Node, pnpm, TypeScript,
ESLint, Prettier and their plugins—are pinned in
**[Frontend toolchain](#frontend-toolchain--formatting-linting-and-static-gates)**
under the same exact-version rule.

### Threat model and control boundary

**Protected assets:** source bytes and pixels, raw/extracted text, identifiers,
review drafts, confirmed Profile data and plaintext exports. **Adversaries/failures:**
an accidental network regression, compromised package/build input, XSS, malicious or
stale service worker, network/hosting observation, shared/lost device and accidental
export sharing.

- D1 prevents intended app flows from transmitting protected assets, through the
  `connect-src` origin allowlist, the non-`self` request-shape rule, the banned
  outbound APIs and the Task 5.2 regression test. The strict CSP is retained, but its
  justification is now **XSS containment for the plaintext Profile in IndexedDB** —
  a narrow, defensible claim — rather than the supply-chain argument ADR-0001 made and
  could not substantiate. `style-src-attr 'unsafe-inline'` (ADR-0008) is the one
  loosening: it permits restyling, not exfiltration, because `default-src 'none'`
  with `connect-src`/`img-src`/`font-src` bounded to `'self'` leaves injected CSS no
  remote fetch target. `script-src` is unaffected. Self-hosting is retained as a cost
  and GDPR-simplicity choice; it is no longer load-bearing for this control. TLS
  protects static bytes in transit; the host still sees ordinary asset-request metadata.
- D6/D7 keep raw evidence memory-only and gate the sole persistence transaction.
- D8/D9 **do not** defend against local-device, browser-profile, malware or file
  access; plaintext disclosure is the control. Device/file-system encryption is
  outside Medigraph.
- No client-side control can guarantee confidentiality after arbitrary malicious
  same-origin code executes. Dependency review, no raw HTML, text-only rendering,
  CSP and service-worker integrity are therefore preventative parts of D1. The
  Playwright guard demonstrates exercised behavior only.
- Availability is best-effort: IndexedDB can be evicted and offline OCR needs one
  successful asset fetch. Export is the user-controlled recovery path.

---

## Frontend toolchain — formatting, linting and static gates

This section is binding in the same way the decision table is. The tools, the exact
versions, the execution order and the CI job below are not a builder model's choice.
Task 0.1 materialises this section verbatim; every later task inherits it. If a tool
here is genuinely wrong, change this section first, then the code.

### Runtime and package manager baseline

| Thing | Pin | Declared in | Why this value |
|---|---|---|---|
| Node | `24.20.0` (active LTS) | `.nvmrc`, `engines.node`, CI `node-version-file` | The lowest line satisfying every tool below: `eslint-plugin-astro@3` needs `^22.22.3 \|\| ^24.16.0 \|\| >=26.3.0`, `lint-staged@17` needs `>=22.22.1`, `@eslint/json` and `@eslint/markdown` need `>=24`. Node 26 is `latest`, not LTS, until Oct 2026. |
| pnpm | `11.24.0` | `packageManager`, enabled via Corepack | The project installs with **pnpm** (`engines.node >=22.13`, already satisfied). `pnpm-lock.yaml` is the single lockfile authority and is committed; `pnpm install --frozen-lockfile` is used everywhere non-interactive, so a lockfile that disagrees with `package.json` fails the build instead of being silently rewritten. |
| TypeScript | `6.0.3` | `devDependencies` | `typescript-eslint@8.68.0` peer-supports `>=4.8.4 <6.1.0`. TypeScript 7 is `latest` on the registry but is **not** yet supported by typescript-eslint, so it is out of scope until that peer range moves. |

**Version pinning is exact.** Every `devDependencies` entry is written without `^` or
`~`, matching the existing "pin exact versions" rule in Architecture. Set
`save-exact=true` in `.npmrc` (pnpm reads it) so this survives the next `pnpm add -D`. The formatter is
the strictest case: an unpinned Prettier minor rewrites files across the whole tree,
so a routine bump lands as an unreviewable diff and CI's `--check` stops agreeing
with the developer's pre-commit hook. Bumps are deliberate commits that carry their
own reformat and nothing else.

### Formatter — Prettier, pinned to 3.9.6

`prettier@3.9.6` **exactly**. It is the latest stable release as of 2026-08-29; the
only newer published versions are `4.0.0-alpha.*` behind the `next` tag and are out
of scope for v1.

| Package | Version | Covers |
|---|---|---|
| `prettier` | `3.9.6` | ts, tsx, js, jsx, mjs, cjs, **html**, css, json, jsonc, json5, markdown, yaml — all core parsers |
| `prettier-plugin-astro` | `0.14.1` | `.astro` |
| `prettier-plugin-sh` | `0.19.0` | bash/sh via the `sh` parser (shfmt), **Dockerfile** via the `dockerfile` parser, plus `.env`/`.gitignore`/`.properties` |

**HTML, JSON, Markdown and YAML need no plugin.** Prettier's built-in `html`, `json`,
`markdown` and `yaml` parsers own those languages; adding a third-party plugin for
any of them only introduces a second opinion about the same bytes. Only `.astro` and
shell/Dockerfile fall outside core, and those are the only two plugins we install.
`prettier-plugin-sh` peer-depends on `prettier@^3.6.0`, satisfied by the pin.

`.prettierrc.json`:

```json
{
  "plugins": ["prettier-plugin-astro", "prettier-plugin-sh"],
  "printWidth": 100,
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "endOfLine": "lf",
  "overrides": [
    { "files": "*.astro", "options": { "parser": "astro" } },
    { "files": ["*.sh", "*.bash", "*.zsh"], "options": { "parser": "sh" } },
    { "files": ["Dockerfile", "Dockerfile.*", "*.dockerfile"], "options": { "parser": "dockerfile" } },
    { "files": ["*.md"], "options": { "proseWrap": "preserve", "printWidth": 88 } },
    { "files": ["*.yml", "*.yaml"], "options": { "singleQuote": false } }
  ]
}
```

`proseWrap` is `preserve`, not `always`: this document and the ADRs are hand-wrapped
for reviewable diffs, and letting the formatter re-flow prose would turn every
one-word edit into a paragraph-sized hunk.

`.prettierignore` — these paths are **byte-significant** and must never be reformatted:

```text
pnpm-lock.yaml
dist/
.astro/
coverage/
public/ocr/
public/pdf/
fixtures/**/*.medigraph
fixtures/**/expected.json
fixtures/**/textitems.json
```

Golden fixtures are compared as committed bytes by Tasks 0.3, 0.6 and 3.5 — the
`fileFormat.ts` golden serialized file in particular asserts an exact serialization.
A formatter reaching into those files silently invalidates the test it is supposed to
protect.

### Linter — ESLint 10, flat config

`eslint@10.9.1`. Flat config only (`eslint.config.js`); `.eslintrc` is not supported
by ESLint 10 and must not appear. `eslint-plugin-astro` is ESM-only, which is already
satisfied because the Astro package is `"type": "module"`.

| Package | Version | Covers |
|---|---|---|
| `eslint` | `10.9.1` | the runner |
| `@eslint/js` | `10.0.1` | core JS recommended rules |
| `typescript-eslint` | `8.68.0` | ts, tsx — type-aware linting |
| `eslint-plugin-astro` | `3.1.0` | `.astro` components (brings `astro-eslint-parser`) |
| `eslint-plugin-jsx-a11y` | `6.10.2` | JSX/Astro accessibility — feeds Task 5.4 |
| `eslint-plugin-react-hooks` | `7.1.1` | Preact hook rules in the `MedigraphApp` island |
| `@eslint/json` | `2.0.1` | json, jsonc (`language: "json/json"` / `"json/jsonc"`) |
| `@eslint/markdown` | `8.0.3` | md, plus linting of fenced code blocks |
| `eslint-plugin-yml` | `3.8.1` | yml, yaml (brings `yaml-eslint-parser`) |
| `@html-eslint/eslint-plugin` | `0.65.0` | html (`language: "html/html"`; no separate parser package needed) |
| `eslint-config-prettier` | `10.1.8` | **the conflict eliminator — see below** |
| `globals` | `17.11.0` | environment global sets |

**Dockerfile and bash are not ESLint-able.** ESLint has no Dockerfile or shell
language plugin, and inventing one is out of scope. Prettier formats both (above);
linting them uses the standard native tools, wired as separate CI steps:

| Language | Linter | How it runs |
|---|---|---|
| bash / sh | `shellcheck` | Preinstalled on `ubuntu-latest`. Local hook skips with a notice when the binary is absent, so contributors are never blocked by a missing system package; CI never skips. |
| Dockerfile | `hadolint` | `hadolint/hadolint-action@v3.5.0` in CI. Local hook skips when absent, same rule. |

`eslint.config.js`:

```js
// Flat config. Order matters — see "Execution order and conflict resolution".
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import html from '@html-eslint/eslint-plugin';
import yml from 'eslint-plugin-yml';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
  { ignores: ['dist/**', '.astro/**', 'coverage/**', 'public/ocr/**', 'pnpm-lock.yaml'] },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.browser,
    },
  },

  // Preact island only.
  { files: ['src/ui/**/*.tsx'], extends: [reactHooks.configs.flat.recommended] },
  { files: ['src/ui/**/*.tsx'], extends: [jsxA11y.flatConfigs.recommended] },

  astro.configs.recommended,
  astro.configs['jsx-a11y-recommended'],

  { files: ['**/*.json'], plugins: { json }, language: 'json/json', extends: ['json/recommended'] },
  {
    files: ['**/*.jsonc', 'tsconfig*.json', '.vscode/*.json'],
    plugins: { json },
    language: 'json/jsonc',
    extends: ['json/recommended'],
  },
  { files: ['**/*.md'], plugins: { markdown }, extends: ['markdown/recommended'] },
  yml.configs.recommended,
  {
    files: ['**/*.html'],
    plugins: { html },
    language: 'html/html',
    extends: ['html/recommended'],
    rules: { 'html/no-inline-styles': 'error' },
  },

  // D1a seam guard: the "no module outside io/ may import the extraction runtime"
  // rule from Architecture, enforced mechanically instead of by review.
  {
    files: ['src/domain/**/*.ts', 'src/ui/**/*.{ts,tsx}', 'src/pages/**/*.astro'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['pdfjs-dist*', 'onnxruntime-web*', 'tesseract.js*'] },
      ],
    },
  },

  // Style-attribute guard — see "Astro component styles". Since ADR-0008 the
  // CSP permits style attributes, so this enforces the convention rather than
  // a hard constraint: waive it per-line with an eslint-disable comment that
  // says why.
  {
    files: ['src/**/*.{astro,tsx,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'Prefer a class in the component\'s <style> block, an SVG presentation ' +
            'attribute, or a CSS custom property set via CSSOM. If an inline style ' +
            'is genuinely the better fit, waive this line with an eslint-disable ' +
            'comment stating why.',
        },
      ],
    },
  },

  // MUST BE LAST.
  prettier,
]);
```

**pnpm peer-conflict note.** `eslint-plugin-astro@3.1.0` peer-requires
`eslint-plugin-jsx-a11y >=6.10.2`, but `eslint-plugin-jsx-a11y@6.10.2` still declares
its own `eslint` peer as `^3 || … || ^9` and has not published an ESLint 10 range.
pnpm reports that as an unmet peer warning (and as an error under
`strict-peer-dependencies=true`). Narrow the exception to exactly that one edge in
`package.json` — never by disabling peer checking tree-wide, which would hide a
future real conflict:

```json
"pnpm": {
  "peerDependencyRules": {
    "allowedVersions": { "eslint-plugin-jsx-a11y>eslint": "10" }
  }
}
```

Delete the rule the moment `eslint-plugin-jsx-a11y` publishes an ESLint 10 peer
range; leaving stale peer overrides in place is how a lockfile quietly drifts from
what the packages actually claim to support.

**pnpm layout note.** pnpm's isolated `node_modules` means a package can only be
resolved if something actually depends on it. Every ESLint plugin above is a direct
`devDependency`, so ESLint resolves each one from the config file without hoisting;
`astro-eslint-parser` and `yaml-eslint-parser` arrive as real dependencies of their
plugins rather than as peers. Do not add `shamefully-hoist` or
`node-linker=hoisted` to make a missing dependency work — declare it instead.

### Astro component styles

**Default: class-based CSS in one `<style>` block at the end of each `.astro` file.**
Markup carries `class` names and nothing else; the block that defines them is the
last thing in the file, after the template. Astro scopes a component `<style>` to that
component automatically, so this costs nothing in isolation and keeps a component's
appearance readable in one place instead of scattered across its markup.

This is a default, not a prohibition. A component with a genuine reason to deviate may
do so with a short comment saying why — and, per the amendment below, the CSP no
longer turns that judgement call into a broken page.

**Within the `<style>` block:**

- One block per component, last in the file. Do not split styles across several blocks.
- Rely on Astro's automatic scoping. `:global()` is a deliberate, commented choice,
  not a reflex reached for when a selector does not match.
- Shared design tokens — including the `.viz-root` custom properties and the dark
  palette from [Theming](#theming) — live in one global stylesheet, not copied into
  each component. A component consumes tokens; it does not redefine them.

**Style attributes are permitted, discouraged, and lint-flagged.** Task 0.4's CSP was
originally written with neither `'unsafe-inline'` nor `'unsafe-hashes'` on `style-src`,
which made a `style="…"` attribute a runtime failure rather than a style choice.
[ADR-0008](adr/0008-csp-style-attribute-amendment.md) amends that for the style
directives only: `style-src-attr 'unsafe-inline'` is now delivered, so a style
attribute works. It remains the last option, not the first, because it moves
appearance out of the one block a reviewer reads.

`no-restricted-syntax` in the ESLint config therefore reports it as an **error with a
documented escape hatch**, rather than being absent:

```astro
<!-- eslint-disable-next-line no-restricted-syntax -- measured popover offset;
     no class can express a value only known after layout -->
<div class="marker-popover" style={`--offset:${offsetPx}px`}>
```

An error that a comment can waive keeps the default enforced and makes each deviation
a visible, justified line in review. A warning would simply accumulate unread.

**Astro `define:vars` on a `<style>` block is available.** It carries its variables by
emitting a `style` attribute onto the component's root element — this is why Astro's
own CSP guidance names `define:vars` as the motivating case for
`style-src-attr 'unsafe-inline'` — and the amended header covers it. Prefer it over a
hand-written style attribute when the value comes from frontmatter, since it lands as
a named custom property consumed by a class in the `<style>` block, which is the shape
this section is asking for anyway.

One caveat, which Task 0.4 resolves when it verifies the delivered header: a browser
that does not implement `style-src-attr` falls back to `style-src`, where attributes
stay blocked. Do not let `define:vars` or a style attribute carry anything a page
cannot be read without — layout that collapses, or a warning that becomes invisible.
Decorative and positional refinements are fine; load-bearing structure is not.

**Dynamic values — the preferred mechanisms.** These still cover every dynamic case in
this plan without reaching for an attribute at all:

| Need | Mechanism | Why it is preferred |
|---|---|---|
| Chart geometry — point positions, bar widths, axis ticks (D11) | SVG **presentation attributes** (`x`, `y`, `cx`, `cy`, `d`, `points`, `width`) | These are markup attributes, not CSS. No `style-src` directive applies to them in any browser. This is the normal way to write the hand-rolled SVG charts. |
| A value that must reach CSS — a computed length, a per-series colour slot | A **CSS custom property set via CSSOM** from the island: `el.style.setProperty('--trend-x', …)`, consumed as `var(--trend-x)` by a class in the `<style>` block | `style-src` governs stylesheet and style-attribute *parsing*, not CSSOM mutation from already-executing script. Works identically regardless of `style-src-attr` support, so it has no browser caveat. |
| A binary or enumerated state — in-range/high/low, selected, loading | **Toggle a class**, with the appearance defined in `<style>` | Keeps status styling in one reviewable place, which is also what the monochrome and forced-colours requirements in [Theming](#theming) and Task 5.4 need. |

**Formatting.** `prettier-plugin-astro` formats the `<style>` block with Prettier's
core CSS parser, so no separate configuration is needed and the block is covered by
`pnpm format:check` like any other file.

### Execution order and conflict resolution (binding)

1. **ESLint runs first.** It owns correctness, type-awareness, accessibility, hook
   rules and the D1a seam guard. In fixing contexts it may `--fix`.
2. **Prettier runs second, and has the last word on formatting.** `--write` in the
   hook, `--check` in CI. Because it runs after ESLint's fixer, no ESLint autofix can
   survive in a shape Prettier disagrees with.
3. **`eslint-config-prettier` is the plugin that makes those two non-conflicting.**
   It disables every stylistic ESLint rule that Prettier owns, including the
   `@typescript-eslint/*` stylistic set. It is imported from its flat entry point
   (`eslint-config-prettier/flat`) and is the **last element of the exported array**.
   Placed anywhere earlier, a later config re-enables the rules it just turned off.
4. **`eslint-plugin-prettier` is explicitly rejected and must not be installed.** It
   runs Prettier *inside* ESLint as a lint rule, which inverts the required order,
   reports whole-file formatting as hundreds of per-character rule violations, and
   makes every lint run pay the formatter's cost. `eslint-config-prettier` (turn
   rules off) and `eslint-plugin-prettier` (run the formatter as a rule) are different
   packages solving different problems; only the former is wanted here.
5. **No stylistic ESLint rule is enabled by hand.** If a rule fights Prettier, the
   rule is wrong. Prove the config stays clean with the bundled CLI helper, which
   reports any rule left on that conflicts with Prettier:

   ```
   pnpm exec eslint-config-prettier src/ui/MedigraphApp.tsx
   ```

   This runs as the `lint:config-conflicts` script and as a CI step, so a future
   plugin addition that reintroduces a conflict fails the build rather than producing
   a hook that fights itself.

### Hooks — husky and lint-staged

`husky@9.1.7` and `lint-staged@17.4.1`, both pinned exactly. Installed by
`"prepare": "husky"`; set `HUSKY=0` in CI so the hook install is skipped there.

`.husky/pre-commit` — fast, staged files only:

```sh
pnpm exec lint-staged
```

`.husky/pre-push` — full tree, catches anything committed with `--no-verify`:

```sh
pnpm verify:static
```

`lint-staged` config in `package.json`. Commands within one glob run **in the listed
order**, which is where the ESLint-then-Prettier rule is actually enforced:

```json
"lint-staged": {
  "*.{ts,tsx,js,jsx,mjs,cjs,astro}": ["eslint --fix --max-warnings=0", "prettier --write"],
  "*.{json,jsonc,md,yml,yaml,html}": ["eslint --fix --max-warnings=0", "prettier --write"],
  "*.{sh,bash}": ["prettier --write", "scripts/lint-shell.sh"],
  "{Dockerfile,Dockerfile.*,*.dockerfile}": ["prettier --write", "scripts/lint-docker.sh"]
}
```

`scripts/lint-shell.sh` and `scripts/lint-docker.sh` exit 0 with a printed notice when
`shellcheck` / `hadolint` is not on `PATH`, and otherwise run it. Hooks are a
convenience that must not be bypassable in a way that matters: **CI is the gate**, and
CI installs both binaries, so `--no-verify` delays a failure rather than avoiding one.

### Scripts (`package.json`)

```json
"scripts": {
  "build": "astro build",
  "prepare": "husky",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "lint:config-conflicts": "eslint-config-prettier src/ui/MedigraphApp.tsx",
  "lint:shell": "scripts/lint-shell.sh --all",
  "lint:docker": "scripts/lint-docker.sh --all",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "typecheck": "astro check && tsc --noEmit",
  "verify:static": "pnpm lint && pnpm lint:config-conflicts && pnpm format:check && pnpm typecheck"
}
```

CI never runs `format` or `lint:fix`. A pipeline that rewrites the tree hides the
defect it was supposed to report.

### CI — `.github/workflows/ci.yml`

The `lint` job below is the static-quality gate for every PR and every push to
`main`. The existing `test` and `build` jobs from Task 0.1 depend on it, so a
formatting failure stops the pipeline before it spends time on Vitest and Playwright.
Later gates (`corpus:score` floors from 2.5c, the privacy E2E from 5.2, and the
bundle budget and CSP check from 5.3) attach to this same workflow as additional jobs.

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

env:
  HUSKY: 0

jobs:
  lint:
    name: Lint and format
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7            # pin to the full commit SHA
      - uses: pnpm/action-setup@v6.0.10      # must precede setup-node for `cache: pnpm`
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint                       # 1. ESLint first
      - run: pnpm lint:config-conflicts      # 2. prove no rule fights Prettier
      - run: pnpm format:check               # 3. Prettier second, check-only
      - run: pnpm typecheck
      - run: pnpm lint:shell                 # shellcheck: preinstalled on ubuntu-latest
      - uses: hadolint/hadolint-action@v3.5.0
        with:
          dockerfile: Dockerfile
        if: hashFiles('Dockerfile') != ''

  test:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6.0.10
      - uses: actions/setup-node@v7
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm vitest run

  build:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6.0.10
      - uses: actions/setup-node@v7
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
```

**Third-party actions are pinned by commit SHA**, with the human-readable tag in a
trailing comment. Tags are mutable; D1's threat model already names a compromised
build input as an adversary, and a movable tag in CI is exactly that hole. The tags
above are current as of 2026-08-29 — the implementing task resolves each to its SHA.

### Migration note

Introducing Prettier to a repository that already contains hand-written Markdown will
reformat Markdown tables (pipe alignment) on the first run. Task 0.1 lands that
reformat as **one separate commit containing nothing else**, before any source code
exists, so the diff is reviewable as pure formatting. `proseWrap: "preserve"` keeps
the prose in this document and the ADRs exactly as wrapped.

---

## Extraction pipeline spec

This is the part that must be specified to the token, because it is where builder
models will otherwise invent behaviour.

**The governing idea.** Layouts differ per lab — column counts, column order, header
wording, sections, gutters, whether units are glued to values, whether ranges even
have a column. What barely differs is the *marker*: every Greek lab that measures
ferritin prints a token normalising to `φερριτινη`, and every lab that measures red
cell count prints `(RBC)` somewhere on that line. So we anchor on the marker and read
outward, instead of reconstructing the table and hoping the marker is in column one.

The pipeline therefore runs **two passes over the same `TextItem[]`** and reconciles:

- **Pass A — marker-anchored (primary).** Find every registry marker mention on the
  page. For each, search a spatial neighbourhood for its value, unit and range.
  Layout-independent. Produces high-confidence rows.
- **Pass B — layout (discovery only).** Rows → columns → grammar, as a table reader.
  Its job is *not* to parse the document; it is to surface measurement-shaped lines
  that Pass A didn't claim, so unknown markers still get charted and so registry gaps
  become visible.

**Two geometry modes—never invent glyph coordinates.** pdf.js commonly emits small
fragments for which spatial read-out is reliable. OCR commonly emits one box for an
entire printed line, such as `Σάκχαρο ορού 71 mg/dL 70 - 110`. Splitting that box and
interpolating x-coordinates by character count is forbidden: proportional fonts make
the fabricated geometry unsafe. `text.ts` instead produces lexical tokens carrying
their parent `TextItem.id` and character offsets:

- **fragmented mode:** a Row contains several parent TextItems; Pass A uses the
  spatial rules below;
- **line mode:** a parent TextItem contains both a marker and numeric content; marker
  matching and read-out use token order inside that string, and only the parent box
  participates in page geometry;
- Pass B likewise uses line-local grammar for a single line box and column geometry
  only for genuinely separate fragments.

Parser fixtures exercise both modes. Real OCR tests begin from images, not from
hand-positioned TextItems, so detection, recognition and geometry are all measured.

---

### PASS A — Marker anchoring

#### A1. Matching (`fuzzy.ts`, `anchors.ts`)

For every Row, generate marker candidates deterministically: parent items left to
right; start offset left to right; contiguous token-run length 5 down to 1. Evaluate
all candidates at T1 before T2, all at T2 before T3, then T4. Within the first tier
that has hits, retain the longest non-overlapping spans; ties use leftmost source
order. This tier-wide search prevents a short alias from winning merely because it
was visited first.

Every match returns the **exact source-character span of the matched abbreviation or
alias**, not the full 1–5-token context used to find it. Anchor geometry/sourceRef is
that exact span's parent box (and `textRange` in line mode), so choosing a longer
context cannot swallow a neighbouring value or marker.

| Tier | Rule | Confidence |
|---|---|---|
| **T1 — Abbreviation** | The candidate contains a registry abbreviation as a standalone token or parenthesised: `RBC`, `HCT`, `HGB`/`HGb`, `MCV`, `MCH`, `MCHC`, `RDW`, `PLT`, `PDW`, `MPV`, `WBC`, `HDL`, `LDL`, `SGOT`/`AST`, `SGPT`/`ALT`, `γ-GT`/`GGT`, `ALP`, `CPK`/`CK`, `TSH`, `FT4`, `FT3`, `PSA`, `CRP`, `ESR`, `HbA1c`, `eGFR`, `Lp(a)`, `INR`, `PT`, `APTT` … | `high` |
| **T2 — Exact normalised** | `normaliseLabel(candidate)` equals a label-normalised registry alias exactly | `high` |
| **T3 — Alias containment** | A registry alias is a whole-word substring of the normalised candidate (catches `Τρανσαμινάσες SGOT`, `Fe ΣΙΔΗΡΟΣ ΟΡΟΥ`, `Βιταμίνη D3 -25-(OH)`) | `high` |
| **T4 — Bounded fuzzy** | Damerau–Levenshtein on label-normalised strings: max distance 0 for length < 5, 1 for 5–7, 2 for ≥ 8. If nearest markers tie, a unique matching `sectionHint` may break the tie; otherwise reject it. | `medium` |

Abbreviations (T1) are deliberately first: they are lab-invariant *and*
language-invariant, so they are the single most reliable signal on a Greek report.
`Αριθμός ερυθρών (RBC)`, `Ερυθρά αιμοσφαίρια (RBC)` and `RBC` all resolve identically.

T1 matching uses `normaliseAbbreviation`, while aliases use `normaliseLabel`; only
the abbreviation path performs Greek/Latin confusable folding. The biochemistry sample prints
`Lp (α)` — Greek alpha, and a space before the parenthesis — and `(Να)` — Greek
Nu + alpha. `Lp(a)` must match the former, so abbreviation matching must fold
homoglyphs and tolerate a space between the abbreviation and its parenthesis.

Row grouping for the "within a row" candidate runs uses `rows.ts` (B1) — it is
shared infrastructure built in Wave 1 (Task 1.8), not Pass-B-only code.

Overlapping anchors: better tier wins, then the **longest matched span**, then the
leftmost source order. Never emit two anchors covering the same source characters.

#### A2. Reading outward (`readout.ts`)

For fragmented mode, given an anchor at bounding box `B`, collect candidate TextItems
in this order and take the first that satisfies each role:

1. **Same row, to the right of `B`** (vertical centres within 0.6 × the smaller item
   height), ordered
   by `x` ascending — the overwhelmingly common case.
2. **Directly below `B`** (horizontal overlap ≥ 50 %, within 2.5 × height) — for
   stacked/narrow-mobile-style layouts.
3. **Same row, to the left of `B`** — for right-aligned label layouts.

For line mode, consider only lexical tokens after the anchor in the same parent line
and apply the same role and stop rules in token order; do not search another line for
a value. In either mode, first assemble all numeric groups, joining an immediately
preceding standalone `<`, `>`, `≤` or `≥` with its number and joining split ranges
such as `70`, `-`, `110`. Then assign roles:

- A two-sided or textual `Έως n` / `μέχρι n` group is always a **range**, including
  when no value exists; textual “up to” stores `{kind:'maxOnly', comparator:'<=',
  max:n}`. Symbolic one-sided ranges preserve their printed strictness exactly.
- In Pass A, the first exact standalone number is the **value**. A comparator group
  is the value when it has a glued/immediately-following recognised unit. Once a value
  exists, the first remaining comparator group is a one-sided range.
- A comparator group following a range heading/textual range word is a range. If a
  lone comparator group satisfies neither the value nor range rule, preserve it as a
  value, add `ambiguous-role`, force low confidence and require review rather than
  silently choosing either meaning.
- The **unit** is the glued or immediately following token accepted by `units.ts`
  after unit normalisation; raw-script characters never gate the attempt.

**Stop conditions — critical, to prevent bleeding into the next marker's data:**

- Stop at the x-position of the next anchor on the same row.
- Stop at the y-position of the next anchor below.
- Stop after a horizontal gap greater than 25 % of page width with nothing found.
- If no value is found within the neighbourhood, emit `value: null,
  status: 'missing'` — do **not** widen the search. This is what correctly reads
  `Βασεόφιλα %` (blank result cell) and `Δικτυοερυθροκύτταρα (ΔΕΚ%)` (range, no
  value) in the fixtures, instead of stealing a neighbour's number.

The shared number parser applies the ambiguous-thousands rule in **both** modes and
both passes. It preserves the decimal interpretation for review but adds
`ambiguous-thousands` and forces low confidence; no Pass-A exemption exists.

**Range-vs-value disambiguation without columns.** If exactly one numeric group is
the two-sided form `n - n`, it is a range and the row is `status:'missing'`—a single
measurement is never printed as an interval. If two groups exist, a two-sided group
is the range and the other is the value regardless of order. Comparator-only cases
follow the unit/context rules above.

#### A3. Section context

Some Greek reports print a section heading (`ΕΡΥΘΡΑ ΣΕΙΡΑ`, `ΛΕΥΚΗ ΣΕΙΡΑ`,
`ΑΙΜΟΠΕΤΑΛΙΑ`, `ΒΙΟΧΗΜΙΚΟΣ ΕΛΕΓΧΟΣ`, `ΟΡΜΟΝΕΣ`) that disambiguates otherwise
identical labels (a bare `%` row under `ΛΕΥΚΗ ΣΕΙΡΑ` is a differential count).
Track the nearest heading above each anchor and store it as `ParsedRow.section`.
Registry entries may declare a `sectionHint`. It may break a T4 tie only when exactly
one tied marker's hint matches the nearest heading; all remaining ties are rejected.

---

### PASS B — Layout (discovery)

Runs only to find measurement-shaped rows **not covered by any Pass-A anchor**.
Output is always capped at `confidence: 'low'` and always surfaces in the review
screen for confirmation, because by definition we did not recognise the marker.

#### B1. Rows (`rows.ts`) — shared infrastructure

Although specified here, `rows.ts` is used by **both** passes (Pass A's "within a
row" in A1/A2 is this clustering) and is built in Wave 1 as Task 1.8.
Cluster `TextItem[]` into `Row[]`: two items are in the same row if their vertical
centres differ by less than 0.6 × the smaller item's height. Sort rows by `y`
ascending, items within a row by `x` ascending. Preserve original items on the row.

#### B2. Column model (`columns.ts`)

1. Scan rows for a **header row**: any row containing a token matching a header
   keyword. Keywords (case/accent-insensitive): `Αποτέλεσμα`, `Τιμές Αναφοράς`,
   `Τιμή Αναφοράς`, `Εξέταση`, `Μονάδες`, `Result`, `Value`, `Reference`,
   `Reference Range`, `Normal Range`, `Test`, `Units`, `Flag`.
2. A header row defines column x-boundaries for all rows below it, until the next
   header row. A page may contain several header regions (the samples do).
3. Where no header row exists, cluster item x-starts across all rows; a cluster with
   ≥ 60 % of rows participating becomes a column boundary. If fewer than 2 boundaries
   are found, emit `ColumnModel = null` and grammar falls back to positional parsing.
4. Classify each column as `label` / `value` / `unit` / `range` by the header keyword
   when present; otherwise by content: the column where ≥ 70 % of cells match
   `RANGE_RE` is `range`; the leftmost column where ≥ 70 % of cells match `NUMBER_RE`
   is `value`; the leftmost remaining column is `label`.

#### B3. Grammar (`grammar.ts`)

Regexes, exactly:

```regex
NUMBER_RE   = /^[<>≤≥]?\s*[+-]?\d{1,6}(?:[.,]\d+)?$/          // standalone token only
RANGE_RE    = /^(?:[<>≤≥]\s*[+-]?\d+(?:[.,]\d+)?|[+-]?\d+(?:[.,]\d+)?\s*[-–—]\s*[+-]?\d+(?:[.,]\d+)?)$/
UNIT_RE     = /^[\p{L}%/^\d.·]+$/u                           // normalise first, then validate
```

`RANGE_RE` deliberately **never matches a bare number**: a range is either two-sided
(`70 - 110`) or comparator-prefixed (`< 75`). A lone `530` is a value, full stop.
In addition to `RANGE_RE`, `ranges.ts` accepts the textual Greek forms labs print —
`Έως n` / `έως n` / `ΕΩΣ n` / `μέχρι n` (matched post-normalisation) — all meaning
`{kind:'maxOnly', comparator:'<=', max:n}`. Symbolic `<`, `≤`, `>` and `≥` are stored
as `<`, `<=`, `>` and `>=` on the one-sided ReferenceRange. Ranges split across
adjacent tokens (`70`, `-`, `110`) are assembled before matching.

Rules, applied in order:

1. **A number token must be standalone.** `Β12`, `D3`, `1η`, `-25-(OH)` are
   alphanumeric and are therefore *label* tokens, never values. This rule alone
   handles `Βιταμίνη Β12  530  pg/mL  200-900` correctly.
2. **Split glued units.** A token like `5%` or `46,2%` splits into value `5` and
   unit `%`. For separate text such as `4,83 Κ/μl`, normalise `Κ/μl` before testing
   it against the unit allowlist; raw Greek `Μ` and `Κ` are valid inputs.
3. **When a `ColumnModel` exists, column assignment wins.** A row whose only numeric
   content sits in the `range` column has **no value** — emit
   `value: null, status: 'missing'`. This is what correctly reads
   `Δικτυοερυθροκύτταρα (ΔΕΚ%)   0,5 - 2,5` (range only, no result) and
   `Βασεόφιλα %   ␣   0,2 - 1,0` (blank result cell) instead of inventing a value.
4. **Fallback grammar** (no column model), left to right: label = leading run of
   non-NUMBER tokens; value = first NUMBER token; unit = following tokens accepted by
   `units.ts`; range = remaining tokens matching `RANGE_RE`.
5. **Comparator values are preserved, never coerced.** `< 0,10` yields
   `{ value: 0.10, comparator: '<' }`. Never store `0.10` alone, never store `0`.
6. **Label cleanup**: trim, collapse whitespace, strip trailing `:`. Keep
   parentheticals — `Αριθμός ερυθρών (RBC)` keeps `(RBC)`, which the registry uses.
7. **Large integers are suspect in Pass B.** A 4+ digit integer with no decimal part
   found by Pass B demotes the row to `low`—years, phone numbers and accession
   numbers are the usual cause. A Pass-A value such as `Βιταμίνη Β12 1120` is not
   demoted merely for having four digits, but `plausibleRange` still applies.
8. **Thousands separators are ambiguous in every pass, never guessed.** Every token
   matching `^[+-]?\d{1,3}[.,]\d{3}$` (for example `250.000` or `1.250`) is ambiguous:
   it may be a grouped integer or a decimal. A count-style unit such as `/μL` explains
   the warning but is not required to trigger it. Parse as a decimal, add
   `ambiguous-thousands`, demote to `low` and flag for review—a silent 1000× error is
   the worst outcome this parser can produce.
9. **Ambiguous comparator role is retained for review.** Apply the same unit/context
   rule as Pass A; if unresolved, keep it as the value with `ambiguous-role` and low
   confidence. Layout discovery never silently turns a detection-limit result into a
   lab reference bound or vice versa.

---

### Reconciliation and confidence (`extract.ts`)

**Reconciliation.** Pass A wins every conflict. A Pass-B row is discarded if any of
its TextItems is already consumed by a Pass-A anchor or its read-out. Surviving
Pass-B rows are emitted with `source: 'layout'` and `markerKey` of the form
`x:<normalised-label>`.

**Registry-gap reporting.** Every surviving Pass-B label is also written to
`ExtractionResult.unrecognised[]`. Task 2.5b wires this into `pnpm corpus:score` so
registry gaps (Task 2.5r) are measured, not guessed at.

**Confidence** is `'high' | 'medium' | 'low'`, computed deterministically. Start from
the matching tier (T1/T2/T3 → `high`, T4 → `medium`, Pass B → `low`), then demote.
Demotion always takes the worse of current and target (`high` → `medium` → `low`);
no rule can promote a `low` row to `medium`:

- Demote to `low` if: the value is `missing`; the read-out hit a stop condition
  before finding a unit *and* a range; the value-bearing OCR box confidence is below
  0.85; the row mean OCR confidence is below 0.75; a shared number parse is
  `ambiguous-thousands`; or the value is outside the MarkerDef's `plausibleRange`.
- Demote to `medium` if: the reference range failed to parse; the unit is
  unrecognised; the value carries a comparator; two anchors competed for the same
  read-out neighbourhood.

An implausible value is **retained**, tagged `implausible-value`, sorted to the top of
review and never silently dropped or clamped. Missing OCR confidence does not itself
demote a row; the E1 adapter records it whenever the selected engine exposes it.
Each trigger adds its matching flag: failed candidate range → `unparsed-range`, raw
unit rejected → `unrecognised-unit`, anchor overlap → `competing-anchor`, and either
OCR threshold → `low-ocr-confidence`. Thousands and plausible checks add the flags
named in their rules; unresolved numeric role adds `ambiguous-role`. A missing value
needs no extra flag because status is explicit.

Confidence never gets promoted. The review screen sorts `low` first and pre-focuses
the first `low` row.

### Date candidate pass (`dates.ts`, before measurement parsing)

Scan every source page in reading order. Accept `d/m/yyyy`, `d-m-yyyy`, `d.m.yyyy`,
`yyyy-mm-dd`, and `d <MonthName> yyyy`, plus optional `HH:mm`, with Greek and English
month names (nominative and genitive). Emit **every** candidate with its SourceRef;
never discard alternatives. When a line matches several keyword classes, classification
precedence is `birth` → `print` → `collection` → `report` → `unknown`, preventing
generic `Date` inside `Date of birth` from winning. Scores are:

1. `collection`: `λήψη`, `δειγματοληψία`, `collection`, `collected` (+40 score);
2. `report`: `ημερομηνία εξέτασης`, `ημ/νία`, `date`, `result date` (+25);
3. `print`: `εκτύπωση`, `printed`, `issued` (-20);
4. `birth`: `γέννηση`, `ημ. γεν.`, `DOB`, `birth` (-100 and never preferred);
5. `unknown` (0).

Add 10 for the first page and 5 for the top third of a page. Highest non-birth score
is the proposed collection date; equal top scores remain multiple proposals. If day
and month are both ≤12 **in a day-first numeric form**, emit day-first with
`ambiguous:true`; ISO `yyyy-mm-dd` is never ambiguous. Review displays the raw text
and requires an explicit ISO-date choice. Review must also explicitly confirm an
unambiguous proposal. No candidate or multiple plausible candidates blocks Confirm
until the user enters/selects one. Direct-row adapters must provide equivalent
DateCandidates rather than inventing a Report date downstream.

### Report grouping, identity and conflicts (`profile.ts`)

- **One source belongs to exactly one Report; several sources may share one.** A
  source file holds at most one visit's results, so it is never split — hence
  `regroupSources`' partition rule. The reverse is common: one visit is often emailed
  as several files, one per department. Multi-source Reports are the normal case, not
  an edge case.
- Equal dates **never merge automatically**. Within one attach batch, review may
  propose that files belong to one collection event, but the user must confirm or split
  every proposed group. The two synthetic fixture PDFs are accepted as one Report only
  after this grouping confirmation.
- **Grouping proposal uses two signals, not one.** Same best date is necessary but not
  sufficient. Add **marker-set disjointness**: sources sharing a date whose marker keys
  barely overlap are probably one visit split by department, and are proposed as one
  group; sources sharing a date whose marker keys substantially overlap are probably
  distinct collections (a retest, or two labs) and are proposed separately. Overlap is
  computed on canonical marker keys only, ignoring `x:*` rows, and the proposal is a
  default the user confirms — never an inference that bypasses the gate.
- A confirmed group creates one Report UUID. A later attach is a new Report even on
  the same date unless the user explicitly selects “add to existing report”; that
  selection stores `targetReportId` and rebuilds conflicts against its Measurements.
- Two distinct Reports may share a date only when **all** Reports on that date have
  distinct minute-precision times. Review stages any needed time update to an existing
  Report in `existingReportDateUpdates`; that update and the new addition commit in
  one ProfileChange. Times are local civil values—no timezone conversion.
- Within a proposed Report, duplicate marker keys produce a `Conflict`. Review must
  choose one candidate or edit one replacement Measurement. “Keep both” is not a v1
  resolution. Confirm requires exactly one Measurement per marker key.
- Appending any Report to a non-empty Profile requires a same-person confirmation.
  This is a transient boundary check; no identity answer is persisted.
- Profile merge/import uses Report IDs, never date equality. An identical ID and
  structurally identical validated content is a duplicate; identical ID with different
  content blocks Merge (the user may Cancel or Replace). Distinct incoming/existing
  Reports sharing a date create a resolvable precision conflict whenever **either**
  is day-precision: the user supplies a distinct valid time for every Report on that
  date, and all existing updates plus incoming additions commit atomically.

`regroupSources` accepts a complete partition of successful source ids (each exactly
once), rebuilds report drafts/conflicts and resets `groupingConfirmed`/date confirmation
for affected groups. `setReportDate` sets the local civil value and marks it confirmed;
later editing resets confirmation. A current `x:*` row is persistence-eligible only
when its id is in `approvedUnknownRowIds`; reassignment to a canonical key or deletion
removes stale approval and rebuilds conflicts.

`canConfirm` returns true only when every successful source is in one confirmed group,
every group has a confirmed valid date, every current conflict has one choose/edit
resolution, every IdentifierCandidate has a resolution, every surviving `x:*` row is
explicitly approved, same-person confirmation is true when the Profile is non-empty,
all `targetReportId`s exist, and the proposed Profile satisfies same-day precision.
`buildProfileChange` then creates UUIDs only for additions and emits complete existing
Report replacements in `updates`; `applyProfileChange` validates and applies both
arrays in the one IndexedDB transaction owned by `MedigraphApp`.

---

## Marker identity and units

### Normalisation (`text.ts`)

There is deliberately no one-size-fits-all `normalise` function:

- `normaliseLabel(s)` = NFKD → strip combining marks → lowercase → Greek final sigma
  `ς→σ` → collapse whitespace. It preserves the Greek and Latin alphabets. Thus
  uppercase/lowercase Greek aliases normalize identically without partial
  transliteration.
- `normaliseAbbreviation(s)` starts with `normaliseLabel`, removes spacing around
  parentheses, then case-stably folds only these abbreviation confusables to Latin:
  `α→a, β→b, ε→e, ζ→z, η→h, ι→i, κ→k, μ→m, ν→n, ο→o, ρ→p, τ→t, υ→y, χ→x`.
  Golden tests cover `Lp (α)→lp(a)` and `(Να)→(na)`.
- `normaliseUnit(s)` owns unit-specific folding. It maps micro sign `µ` and lowercase
  Greek mu `μ` to canonical `µ`; Greek **capital** mu `Μ` immediately before `/` to
  count prefix `M`; and Greek kappa `Κ/κ` immediately before `/` to `K`. Lowercase
  `μ/…` is never guessed to mean million. Matching then uses the explicit allowlist.

Homoglyph folding is never applied to an entire marker phrase. This avoids the
case-asymmetric and cross-language collisions caused by partial transliteration.

### Marker key (`markerKey.ts`)

`markerKey(label)`: `normaliseLabel` → look up label-normalised registry aliases →
return canonical id on hit; on miss retain Unicode letters/numbers, collapse every
other run to `-`, trim dashes, and prefix `x:`.
Unknown markers are first-class: they chart fine, they just have no canonical name.

### Registry (`src/domain/registry/`) — the core asset (D5a)

Because Pass A is primary, **registry coverage is parser quality**. Treat it
accordingly: it is versioned data with its own tests and its own score.
`REGISTRY_VERSION` starts at 1 and increments **once per merged change set** that
changes any marker identity, abbreviation or alias, regardless of how many entries
that change set touches. `extract` stamps every result with the exact current constant;
fixture expectations and validation require equality, never “at least” compatibility.

Split one file per panel so tasks parallelise and diffs stay readable:
`haematology.ts`, `biochemistry.ts`, `lipids.ts`, `hormones.ts`, `vitamins.ts`,
`inflammation.ts`, `coagulation.ts`, `urinalysis.ts`, `index.ts`.

```ts
interface MarkerDef {
  id: string;                 // stable: 'ferritin', never renamed once shipped
  en: string;                 // display name, English
  el: string;                 // display name, Greek
  abbreviations: string[];    // T1 tier — lab- and language-invariant
  aliases: string[];          // T2/T3/T4 tier — Greek and English spellings
  canonicalUnit: string;
  plausibleRange?: [number, number];  // sanity bound, NOT a reference range
  sectionHint?: string;       // unique T4 tie-break only
}
```

**Alias authoring rules** (put these verbatim in every registry issue):

1. Aliases are stored **pre-normalisation** as printed; `markerKey` label-normalises at
   match time. Include accented and unaccented spellings where labs differ
   (`Ομοκυστεΐνη` / `Ομοκυστεϊνη` / `Ομοκυστεινη`).
2. Include the **genitive and nominative** Greek forms where both occur
   (`Σάκχαρο ορού` / `Σάκχαρο αίματος` / `Γλυκόζη`).
3. Include the common Greeklish/Latin-script forms labs actually print.
4. **Never invent an alias.** Every alias must be either (a) present in a corpus
   fixture, or (b) on the supplied seed list in the issue — which is the ΚΕΟΚΕΕ
   extract produced by Task 0.5c, not a model's recollection of Greek lab vocabulary.
   Unsourced aliases are the main way a builder model silently poisons this file — an
   alias that matches the wrong marker produces a wrong health chart. Bulk-importing a
   seed by string similarity is the same failure wearing a citation: see the four
   real mis-matches recorded under *Sourcing the registry*.
5. `plausibleRange` is a deliberately wide sanity bound. An outside value is kept,
   tagged `implausible-value`, forced to low confidence and reviewed; it is never
   treated as a clinical range and never silently rejected.

#### Sourcing the registry — ΚΕΟΚΕΕ is the sanctioned seed

Alias rule 4 requires every alias to come from a corpus fixture or a **supplied seed
list**. That seed list is the Greek Ministry of Health's **ΚΕΟΚΕΕ** (Κατάλογος Ενιαίας
Ονοματολογίας και Κωδικοποίησης Εργαστηριακών Εξετάσεων) — the official unified
nomenclature and coding catalogue for laboratory tests, drafted in 2013 by a committee
of laboratory scientists on the EDMA reagent catalogue and explicitly intended to
correlate with ΕΟΠΥΥ prescription codes
([Ministry of Health](https://www.moh.gov.gr/articles/epitroph-promhtheiwn-ygeias/katalogos-eniaias-onomatologias-kai-kwdikopoihshs-ergasthriakwn-eksetasewn-keokee/2026-keokee);
described in [Arch Hellen Med 2015, 32(6):777-788](https://www.mednet.gr/archives/2015-6/pdf/777.pdf)).

Use **v5, April 2016, XLSX** (`?fdl=9688`, 352 KB,
`sha256:d73ef10530de0453ad5f4a4d04d06e7672a8c5a30cbf06fe269bcf4143642418`), which is
the only machine-readable release. Its columns map almost directly onto `MarkerDef`:

| ΚΕΟΚΕΕ column | `MarkerDef` field |
|---|---|
| `Αγγλική Ονομασία` | `en` |
| `Ελληνική Ονομασία` | `el` |
| `Συντομογραφία` | `abbreviations[]` — supplies the exact `ALT/SGPT`, `AST/SGOT`, `Γ-GT` pairs the T1 tier needs |
| `Άλλη Ονομασία` | `aliases[]` (one synonym only) |
| `GR code` | category hierarchy → `sectionHint` |

It holds 2,403 tests across 8 categories. Only four are quantitative markers a report
plots over time — **11** Clinical chemistry (131 leaves), **12** Immunochemistry (328),
**13** Haematology (270) and **18** Immunology (167): 896 tests, 435 carrying an
abbreviation and 74 an alternative name. Categories 14–17 (cultures, infection
serology, genetics, cytology) are largely non-numeric and out of scope.

**Two limits that decide how it may be used.**

1. **It is an *ordering* nomenclature, so panel-internal indices are absent.** The CBC
   is one entry — `13.01.01.01.001 ΠΛΗΡΗΣ ΓΕΝΙΚΗ ΑΙΜΑΤΟΣ ΜΕ ΔΙΑΧΩΡΙΣΜΟ 3/5` — because
   the indices it reports are not separately orderable. **MCV, MCH, MCHC, RDW, PDW,
   MPV, WBC and the differential do not appear anywhere in ΚΕΟΚΕΕ**, and those are the
   most frequently printed rows on any Greek report. `haematology.ts` must therefore be
   authored from the Task 0.5a corpus; `biochemistry.ts`, `lipids.ts`, `hormones.ts`,
   `vitamins.ts` and `inflammation.ts` are well served by ΚΕΟΚΕΕ.
2. **Its names are administrative, not printed.** ΚΕΟΚΕΕ says
   `ΑΜΙΝΟΤΡΑΝΣΦΕΡΑΣΗ ΑΛΑΝΙΝΗΣ`; a lab prints `SGPT` or `Τρανσαμινάσες SGPT`. Treat it
   as authoritative for **marker identity, canonical Greek/English name and
   abbreviation**, and the corpus as the source for printed alias variants.

**Curate; never bulk-import.** A trial substring match of 48 routine markers against
this catalogue returned four confidently wrong identities — `Haemoglobin` matched the
HbA1c row, `RBC` matched erythrocyte folate, `Cortisol` matched 11-deoxycortisol, and
`Platelets` matched a platelet-function assay. Every one would have produced a wrong
health chart. This is alias rule 4's failure mode demonstrated, and it is why the seed
enters the registry through human review, one panel at a time.

**Secondary cross-check: the LOINC Greek linguistic variant**, restored in LOINC 2.79
(February 2025). Using it to *find* Greek name variants does not violate D10, which
bars LOINC **codes from our data model** — no `loincCode` field appears in `MarkerDef`
and none may be added.

**Coverage target for v1:** ≥120 markers, covering 100% of sourced marker identities
in the Task 0.5a training corpus and standard Greek general-checkup seed list. The
holdout measures generalisation and does not become an alias source before its first
score. No LOINC (D10).

### Units (`units.ts`)

`normaliseUnit(s)` always returns trimmed normalized text, including for an unknown
unit, so review never loses the printed evidence. `isKnownUnit` checks the explicit
allowlist after normalization; an unknown is retained and flagged. Known mappings:
`u/l ≡ U/L`, `μg/dl ≡ µg/dL`, `ng/ml ≡ ng/mL`, `pg/ml ≡ pg/mL`, `μIU/ml ≡ mIU/L`,
`K/µl ≡ 10^3/µL`, `M/µl ≡ 10^6/µL`, `fl ≡ fL`, `g/dl ≡ g/dL`, `mmol/l ≡ mmol/L`.

`convert(value, from, to, markerKey)` supports **only** this enumerated table; any
other pair returns `null` and the caller must not convert:

| Marker(s) | From → To | Factor |
|---|---|---|
| glucose | mg/dL → mmol/L | × 0.05551 |
| cholesterol, hdl, ldl | mg/dL → mmol/L | × 0.02586 |
| triglycerides | mg/dL → mmol/L | × 0.01129 |
| creatinine | mg/dL → µmol/L | × 88.4 |
| uric-acid | mg/dL → µmol/L | × 59.48 |
| haemoglobin, mchc | g/dL → g/L | × 10 |
| ferritin | ng/mL → µg/L | × 1 |
| vitamin-b12 | pg/mL → ng/L | × 1 |
| folate | ng/mL → nmol/L | × 2.266 |
| vitamin-d | ng/mL → nmol/L | × 2.496 |

Inverse direction = divide by the same factor. For a canonical marker, Series.unit is
its registry `canonicalUnit`; convert each value **and its ReferenceRange bounds by
the same positive factor**, preserving all native fields on SeriesPoint. Comparator
direction is unchanged. For an unknown marker, no conversion is attempted; every
distinct normalised native unit is a separate Series.

If units differ and no conversion exists, split into one Series per normalised native
unit (`none` is its own group), label each `Name (unit)`, and show a notice linking
the split rows. Never plot mismatched units on one axis (D12).

---

## Chart specifications

Two forms only. Follow them literally.

### Panel view (default; the latest Report)

Twenty-five markers is **not** a twenty-five-series chart — it is a list. Render a
scrollable list of rows, one per marker:

- Marker name (canonical `el`/`en` per UI language, falling back to the raw label).
- Native value + comparator + unit, right-aligned with tabular figures. A missing
  result renders `—`, not zero; a printed ReferenceRange remains visible separately.
- Status uses neutral factual language only: `within reported range`, `below reported
  range`, `above reported range`, or `range comparison unavailable`. There is no
  `good`, `warning`, `critical`, percentage-outside heuristic or clinical severity
  inference. Exact non-comparator values can be classified against their own range;
  comparator/censored values are always comparison-unavailable because their actual
  value is unknown.
- For an exact result, closed ranges include both endpoints. A minimum-only range
  uses its stored `>` or `>=`; a maximum-only range uses its stored `<` or `<=`.
  Equality is outside a strict bound and within an inclusive bound.
- Status uses colour **plus a direction icon and visible text**, never colour alone.
  Use distinct tokens for within, outside and unknown; below/above share the outside
  hue but use down/up icons and labels.
- **Closed range meter:** let `span = max(max-min, max(abs(min),abs(max))*0.1, 1)`;
  domain is `[min-0.25*span, max+0.25*span]`. Draw `[min,max]` as the band; clamp an
  exact value beyond the domain to an end arrow.
- **Minimum-only meter:** let `span = max(abs(min)*0.25, 1)`; domain is
  `[min-span, min+3*span]`. Draw a bound tick labelled with the stored `>`/`>=`, shade rightward and
  clamp an exact value beyond the domain to the matching end arrow.
- **Maximum-only meter:** let `span = max(abs(max)*0.25, 1)`; domain is
  `[max-3*span, max+span]`. Draw the stored `<`/`<=`, shade leftward and apply the same
  clamping.
- **Missing range or censored result:** render no positional dot/band; show the
  textual value and `range comparison unavailable`. Never fabricate a two-sided rail.
- Sort factual below/above rows first, then `sourceOrder` (file attach order, page
  order, row order), then missing/unknown. A segmented control switches Reports.
- Mobile: name on line 1, value + meter on line 2, full width. Desktop: single row.
- Rows are buttons (`<button>`, 44 px minimum target) whose accessible name includes
  marker, value, unit and textual status; they open Trend view. Explicit missing rows
  remain visible and tappable.

### Trend view (one marker over time)

A **single-series** line chart:

- x = report date (time-proportional, not categorical index); y = value.
- Reference range drawn as a **stepped shaded band**, because the range changes
  between labs and years — never one flat rectangle across the whole chart. Only when
  the **first SeriesPoint** has a range may that range fill the plot's left padding.
  Each non-null range begins at its own report x and remains through the right-open
  interval ending at the next report x; a null range starts an unshaded gap, and the
  next non-null range restarts only at its own x. The final non-null range extends to
  the plot's right boundary. One-sided ranges shade only the bounded side of the
  visible y-domain.
- 2 px line in sequential blue (`#2a78d6` light / `#3987e5` dark). Markers ≥ 8 px
  with a 2 px surface ring. Exact points outside their own range take the factual
  outside token; within points remain blue/within.
- Single series ⇒ **no legend**; the title names the marker. Direct-label the first
  and last quantifiable points only, suppressing the first label when both positions
  are the same or when the two labels would overlap; never label every point.
- Comparator values (`< 0.10`, `> 20`) render as hollow markers at the reported
  bound with the matching caret and an accessible tooltip saying “reported as below
  \[or above\] this bound; exact value unknown.” They are not joined by the line.
- Explicit `missing` Measurements are gaps that break the line, whether or not the
  lab printed a ReferenceRange. A marker absent from another Report means “not
  supplied”, not a synthetic null point. Never interpolate across an explicit gap.
- A one-point `status:'value'` Series renders a dot and its range slice with no line.
  A Series containing only missing points renders the axes/range context plus “No
  reported value” and relies on the table—no dot or line. Reports with minute
  precision use local civil time; day-precision points use local noon, avoiding UTC
  date shifts.
- Crosshair + tooltip on hover and on touch-drag. Recessive grid and axes.
- A **table view toggle** renders the same data as an HTML `<table>` (accessibility
  requirement and the primary assistive-technology path), with columns Date, Reported
  value, Unit, Reported range and Status. The SVG is a `<figure>` labelled by title
  and summary; it is not the sole source of any value.
- Split unit Series render as separate linked choices titled `Name (unit)` with the
  unit-mismatch notice; they are never overlaid.
- Never overlay a second marker on a second y-axis (D12). Comparison across markers
  is out of scope for v1.
- **Display only (D13).** The Trend view names no direction and no rate of change:
  no slope indicator, no trend line or regression, no "rising"/"falling"/
  "improving"/"declining"/"stable" label, no delta-since-last badge, no
  time-to-out-of-range projection. The neutral-language rule from Panel view applies
  here verbatim — there is no `good`, `warning`, `critical`, severity inference or
  percentage-outside heuristic — and point styling uses the same factual
  within/outside/unknown tokens, each traceable to the range that lab printed for
  that report. The chart shows what was reported and when; the reader draws the
  conclusion. The title, summary, axis labels, tooltip and table copy are all bound
  by this rule.

### Theming

Define all colours as CSS custom properties on a `.viz-root`. Ship a selected dark
palette (not an inverted light one), declared under **both**
`@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]`. Every text,
icon, focus and graphical-object pair meets WCAG 2.2 AA contrast; status remains
understandable in monochrome and forced-colours mode. These tokens are declared once
in the global stylesheet and consumed by component `<style>` blocks; see
[Astro component styles](#astro-component-styles) for how per-datapoint geometry and
state reach the DOM without a CSP-blocked style attribute.

---

## The `.medigraph` file format

```jsonc
{
  "format": "medigraph",
  "v": 1,
  "profile": {
    "schemaVersion": 1,
    "id": "<uuid>",
    "reports": []
  }
}
```

- The file is UTF-8 JSON exactly as shown: no compression, encryption, KDF, cipher,
  passphrase or binary framing. Pretty-print with two spaces and one trailing newline
  so users can inspect it and implementations interoperate without canonical JSON.
- Filename: `medigraph-<YYYY-MM-DD>.medigraph`.
- The `Profile` schema contains **no name, no patient id, no lab id, and no free
  text from the source document other than user-confirmed marker labels** — dates,
  marker keys, values, units, ranges, and (for unknown markers only) the printed
  label the user saw and approved on the review screen. Those labels are the one
  path source text can take into Profile, so D7 always puts unknown labels in the
  scrub panel. `assertProfileSafe` rejects unknown labels over 120 characters, control
  characters/newlines, and high-confidence AMKA, email and phone patterns; canonical
  markers may not carry a `label` field.
- Reject files over **10 MiB** before parsing. Validation also caps 10,000 Reports,
  1,000 Measurements per Report and string fields at their contract-specific limits.
  No decompression means there is no decompression-bomb path.
- Import parses into memory, checks `format`/`v`, migrates old supported envelopes,
  calls `validateProfile` and `assertProfileSafe`, then shows a read-only preview with
  report count, date span, duplicate count and conflicts. Failures have exact codes:
  `file-too-large` (byte cap), `malformed-json` (UTF-8/JSON syntax), `not-medigraph`
  (wrong envelope marker), `unsupported-version`, and `invalid-profile`. These are
  returned only by `parseMedigraph`/`previewImport` as `ImportResult`, never inferred
  from an exception string.
- With empty storage, the preview offers Cancel or Import. With an existing Profile,
  it offers Cancel, **Replace**, or **Merge**. Replace adopts the imported Profile
  only after a destructive confirmation. Merge requires same-person confirmation,
  keeps the existing Profile id, skips structurally equal Report-id duplicates, and
  exposes a same-id/different-content conflict in the preview. Distinct ids never date-merge; if they
  would put multiple Reports on a date while any is day-precision, preview requires
  distinct times for all of them and stages existing updates with additions. `applyProfileMerge`
  returns typed `report-id-conflict` or `same-day-precision-conflict` until those
  blockers are absent. No choice is preselected and no write occurs before confirmation.
- Import and storage replacement are one IndexedDB transaction: interruption leaves
  the old Profile intact. Export first validates the in-memory Profile and creates a
  Blob locally; the Blob URL is revoked immediately after download starts.
- Export and import dialogs state: **“This file is not encrypted. It contains your
  medical history; store and share it as carefully as the original lab reports.”**

---

## Task breakdown

Each task below becomes one GitHub issue labelled `ready-for-agent`
(per `docs/agents/issue-tracker.md`), with this document linked as the spec.

**Every issue body must include, verbatim:** the exact file paths to create, the
exact exported function signatures, the behaviour rules copied from the relevant
section above, the fixture path and expected output, the command that proves it
(`pnpm vitest run <path>`), and this line: *"Do not make design decisions. If the
spec is ambiguous, stop and comment on the issue instead of choosing."*

### Wave 0 — foundations and empirical gates

| # | Task | Deliverable |
|---|---|---|
| 0.0 | **Domain baseline.** Commit root `CONTEXT.md` and accepted ADRs for D1, D1a, D3, D4, D6/D7, D8, D9 and D13, plus ADR-0008 (CSP style-directive scope), ADR-0009 (supersedes ADR-0001; D1's data rule and origin allowlist) and ADR-0010 (D13 display-only positioning), before implementation issues are opened. | Vocabulary and changed binding decisions are reviewable independently of code. |
| 0.1 | **Scaffold.** Astro 5 static output, one Preact `MedigraphApp` island entry, strict TypeScript, Vitest, Playwright and pnpm. Materialise **[Frontend toolchain](#frontend-toolchain--formatting-linting-and-static-gates)** exactly: Node/pnpm/TypeScript pins, `prettier@3.9.6` with its two plugins, ESLint 10 flat config with every listed language plugin, `eslint-config-prettier` last, husky + lint-staged hooks, and `.github/workflows/ci.yml` with the `lint` job gating `test` and `build`. Do not substitute versions, add `eslint-plugin-prettier`, or reorder ESLint and Prettier. Later score, privacy and bundle gates attach to the same workflow. | Empty static app builds and tests green; `pnpm verify:static` passes on a clean checkout and `pnpm exec eslint-config-prettier` reports no conflicting rule. |
| 0.2 | **Implement provisional contracts.** Create `types.ts` exactly from “Field-level contracts”, plus structural `validateProfile(x: unknown): Profile` and semantic `assertProfileSafe(profile: Profile): void`. Validate finite numbers, coordinate bounds, discriminated ranges, ids, timestamps, uniqueness, cardinality, status/value consistency and free-text policy. | Contract tests reject every malformed boundary. These shapes freeze only after 3.8, not here. |
| 0.3 | **Synthetic/redacted seed fixtures.** Build content-equivalent synthetic PDFs and hand-checked TextItem/expected JSON; do **not** copy the identifying root PDFs. Correct mapping: `MedilabRslt29384Page2.pdf` is the 25-marker **biochemistry** layout; `Page3.pdf` is the multi-region **haematology/CBC** layout. Commit only `fixtures/seed/biochemistry.{pdf,textitems.json,expected.json}` and `haematology.{pdf,textitems.json,expected.json}` with specimen identity and content-based names. Include fragmented and whole-line versions. | No real identity substring or document metadata survives. Expected output includes dates, comparators, missing status, retained ranges and SourceRefs. Human/capable-model task. |
| 0.4 | **Static security foundation—not the final privacy E2E.** Self-host every browser byte under `public/`. There is **no** generated asset manifest and **no** generated CSP hash list: the policy is a committed static string. Commit `_headers` with CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' blob: data:; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'`. `connect-src` carries D1's origin allowlist and is `'self'` alone in v1; adding an origin edits this one line. Set `build.inlineStylesheets: 'never'` so component `<style>` blocks always emit as external `'self'` stylesheets and no style hash is ever required. Emit no inline `<script>`, so `script-src` needs no hash, nonce, `'unsafe-inline'` or `'unsafe-hashes'`. `style-src-attr 'unsafe-inline'` is the deliberate, scoped exception recorded in [ADR-0008](adr/0008-csp-style-attribute-amendment.md); record which target browsers honour `style-src-attr` and which fall back to `style-src`. Add COOP `same-origin`, COEP `require-corp`, CORP `same-origin`, `Referrer-Policy: no-referrer`, HSTS, `X-Content-Type-Options: nosniff`, and a Permissions Policy allowing only same-origin camera while disabling microphone/geolocation/payment/USB. | A built-app Playwright smoke test boots under the delivered headers and finds no undeclared origin. COOP/COEP cost nothing once every asset is same-origin and give Task 3.3 `crossOriginIsolated` for WASM threads. Full workflow egress testing waits for 5.2. |
| 0.5a | **Parser corpus.** Collect hand-checked TextItem + expected fixtures from ≥8 Greek labs, covering fragmented and whole-line text, diverse layouts and all date/range cases. Reserve at least one lab as a blind holdout: its labels and expected output may not be used to author aliases or thresholds before the first release score is recorded. | Measures parser/registry behavior without pretending to test OCR. Human/capable-model task. |
| 0.5b | **Real OCR corpus.** From public specimen or wholly synthetic documents, commit source images/scanned PDFs plus expected rows for ≥3 labs, each with a clean scan and at least two phone-photo variants (skew, shadow, perspective or blur). Keep OCR output as a generated test artifact, not the authored input. Include one lab not used to tune preprocessing. | Exercises image→preprocess→detection→recognition→parse, including real box geometry. Human/capable-model task. |
| 0.5c | **ΚΕΟΚΕΕ marker seed list (capable model/human).** Fetch ΚΕΟΚΕΕ v5 XLSX from the Ministry of Health, verify the recorded sha256, and extract categories 11, 12, 13 and 18 into a committed reviewable TSV under `fixtures/registry-seed/` with columns `grCode, en, abbreviation, el, otherName`. Do **not** emit `MarkerDef`s and do **not** match seed rows to markers automatically — this task produces the *sourced vocabulary* that alias rule 4(b) requires, nothing more. Record in the issue that ΚΕΟΚΕΕ omits all CBC indices (MCV, MCH, MCHC, RDW, PDW, MPV, WBC, differential) because it is an ordering nomenclature, so `haematology.ts` is corpus-authored. | Pass/fail: the committed TSV has ≥890 rows, every row carries a `grCode` matching `^1[1238](\.\d+){4}$`, and a spot-check of 20 rows against the source file matches byte-for-byte. Feeds 1.6b-core and 2.5r. |
| 0.6 | **Metric definitions and generic scorer.** Implement fixture-schema validation and pure `score(expected, actual)` for marker recall, value/comparator precision, unit precision and range precision, grouped per lab and aggregate. It accepts supplied predictions and has no dependency on `extract.ts`; Task 2.5b wires the parser into it. | Metric denominator, numeric tolerance and missing/comparator behavior have golden tests, breaking the old scorer↔extract cycle. |
| 0.7 | **E1 feasibility spike (capable model/human; start with 0.5b).** Compare PP-OCRv5 Greek ONNX against `tesseract.js` `ell+eng` on a small 0.5b sample in Chromium and Safari. For PP-OCR, prove conversion, dictionary wiring, det+rec, confidence and coordinate normalization behind 0.4 headers. Store candidate bytes locally and record exact checksums, first/steady latency and failures in ADR-0003. | Select one `OcrEngine` or update D3/ADR to the fallback **before** Wave 3. No CDN/HF runtime option. This is feasibility evidence, not the E1 release gate. |

#### Fixture and corpus sourcing rules—non-negotiable

- **Prefer published specimen reports.** Most Greek labs publish a
  *υπόδειγμα αποτελεσμάτων* / sample report PDF. These are the ideal source: already
  synthetic, already public.
- **Any real-report-derived text must be redacted before commit**—name, AMKA, patient
  id, doctor, address, phone, barcode and accession id. Redact expected JSON and
  metadata, not just visible pixels.
- **Never commit a real patient's PDF to this repository.** For real-report-derived
  parser fixtures, commit only redacted TextItems. OCR source images/PDFs must be
  public specimens or generated synthetic documents, never redacted real reports
  whose underlying text layer/metadata may still identify someone.
- The two root `MedilabRslt29384Page*.pdf` inputs contain identifying text. They are
  private reference inputs only: do not commit, copy, publish or use them directly in
  tests. Task 0.3 recreates their useful layouts with synthetic identity and values.
- Target lab diversity, not volume: single-column, multi-column, sectioned,
  units-in-own-column, units-glued, range-absent and whole-line OCR geometry.
- Parser and OCR corpora are separate. Registry authors may inspect parser training
  fixtures only; OCR tuning may not rewrite expected values or consume its held-out
  lab. After the first release score, freeze that holdout as regression data and add
  a new unseen lab before the next tuning cycle.

### Wave 1 — pure domain (parallel only where dependencies permit)

| # | Task | Depends on |
|---|---|---|
| 1.1 | `text.ts` — separate label/abbreviation normalisers (including final sigma), lexical tokens with UTF-16 parent offsets, and no pseudo geometry | 0.2 |
| 1.2 | `numbers.ts` — comma/dot decimals, separated comparators, shared ambiguous-thousands result, `NUMBER_RE` | 0.2 |
| 1.3 | `ranges.ts` — parse every range form in the corpus | 0.2 |
| 1.4 | `units.ts` — normalisation + the enumerated conversion table | 0.2, 1.1 |
| 1.5 | `dates.ts` — parse, classify and score every candidate; ambiguity/time precision | 0.2, 1.1 |
| 1.6a | `fuzzy.ts` — bounded Damerau–Levenshtein, abbreviation matching and sectionHint-or-reject tie logic | 0.2, 1.1 |
| 1.6b-core | **`registry/` seed** — the ~40 markers appearing in the two fixture pages, authored strictly from the fixtures and the Task 0.5c ΚΕΟΚΕΕ seed; export `REGISTRY_VERSION = 1`. Enough to unblock Wave 2 without the corpus. | 0.2, 1.1, 0.3, 0.5c |
| 1.7 | `identifiers.ts` — PII candidates plus unknown-label `assertProfileSafe` checks | 0.2, 1.1 |
| 1.8 | `rows.ts` — vertical clustering (shared by both passes; spec in B1) | 0.2, 0.3 |
| 1.9 | `review.ts` — immutable marker reassignment, identifier/conflict resolution and `canConfirm`; changing marker keys immediately rebuilds duplicate conflicts | 0.2, 1.6b-core, 1.7 |

Every one of these is a pure function with a table-driven test file. Supply each
builder model with an explicit input→output table in the issue (e.g. for 1.3:
`"70 - 110" → {kind:'closed',min:70,max:110}`, `"< 75" →
{kind:'maxOnly',comparator:'<',max:75}`, `"> 20" →
{kind:'minOnly',comparator:'>',min:20}`,
`"0,270-4,480" → {kind:'closed',min:0.27,max:4.48}`, and `"Έως 200" →
{kind:'maxOnly',comparator:'<=',max:200}`).

### Wave 2 — pipeline

| # | Task | Depends on |
|---|---|---|
| 2.1 | `anchors.ts` — **Pass A** deterministic candidate enumeration, four tiers, overlap resolution and section tracking | 1.1, 1.6a, 1.6b-core, 1.8 |
| 2.2 | `readout.ts` — **Pass A** fragmented spatial and whole-line lexical read-out, comparator joining, stop conditions and range/value disambiguation | 2.1, 1.2–1.4 |
| 2.3 | `columns.ts` — **Pass B** column model | 1.8, 0.3 |
| 2.4 | `grammar.ts` — **Pass B** whole-line/fragmented grammar and nine ordered rules | 1.1–1.4, 2.3 |
| 2.5a | `extract.ts` core — date/identifier passes, both measurement passes, reconciliation, flags/confidence and `unrecognised[]` | 2.1–2.4, 1.5, 1.7 |
| 2.5b | Wire `pnpm corpus:score` to `extract` and report training-lab, per-lab and Pass-A-only metrics; no threshold tuning from holdout | 2.5a, 0.5a, 0.6 |
| 2.5r | **Registry corpus expansion—one issue per panel file.** Author only from 0.5a training labs and the Task 0.5c ΚΕΟΚΕΕ seed; never inspect the holdout to add aliases. `haematology.ts` is corpus-only — ΚΕΟΚΕΕ carries no CBC indices. Increment `REGISTRY_VERSION` once per merged registry change set and re-score each panel. | 1.6b-core, 0.5a, 2.5b |
| 2.5c | Run and commit the parser release baseline after 2.5r, including the sealed holdout; enable CI floors | 2.5r |
| 2.6 | `profile.ts` — proposed groups, explicit report construction, mandatory conflict resolution, same-person append and id-based profile merge | 2.5a, 1.6b-core, 1.9 |
| 2.7 | `series.ts` — ordering, canonical target units, range co-conversion, native preservation, explicit gaps and unit splits | 2.6, 1.4 |

**Acceptance for 2.2 (Pass A alone, no layout analysis):** on
`fixtures/seed/biochemistry.textitems.json`, all 25 markers with `D-Dimers` as
`{value: 0.10, comparator: '<'}` and `Βιταμίνη Β12` at 530 (not 12). On
`fixtures/seed/haematology.textitems.json`—the harder, multi-region page—`Βασεόφιλα %`
as `value: null, status: 'missing'`, `Δικτυοερυθροκύτταρα (ΔΕΚ%)` as
`value:null, status:'missing'` with its ReferenceRange retained,
`Μ/μl` and `Κ/μl` folded, and `Αριθμός λευκών (WBC)` read correctly despite its label
sitting in the left gutter column while its value sits in the middle column. **Pass A
must achieve this with Pass B disabled** — that is the proof that the parser is
marker-driven rather than layout-driven.

**Acceptance for 2.5c:** on all parser fixtures, aggregate marker recall ≥95%,
value+comparator precision ≥99%, unit precision ≥95% and range precision ≥95%; every
lab independently has recall ≥90% and value precision ≥98%. The previously sealed
holdout must independently meet the same per-lab floors before it is unsealed and
frozen as regression data. Pass A alone has aggregate recall ≥90% and value precision
≥99%. Precision is load-bearing: a missed marker is visible, a wrong value may not be.

**Acceptance for 2.6:** the two seed sources produce a one-Report proposal, but no
Report exists before confirmation. Confirming the proposed group yields one Report;
splitting yields two only after distinct times are confirmed when dates are equal.
Duplicate markers block Confirm until choose/edit leaves exactly one; adding a
distinct same-date Report never auto-merges.

**Acceptance for 2.7:** fixtures cover glucose conversion with range co-conversion,
native-field preservation, Lp(a) incompatible-unit splitting, one-sided ranges,
comparator preservation, explicit missing gaps, same-day minute ordering and stable
date/source ordering. No Series contains more than one normalised unit.

### Wave 3 — I/O adapters

| # | Task | Depends on | Notes |
|---|---|---|---|
| 3.1 | `pdfText.ts` — pdf.js → page TextItems, stable ids and source boxes, including y-flip; self-host the packaged worker under `public/pdf/` | 0.1–0.4 | Test against the synthetic PDFs, including text order and page dimensions. |
| 3.2 | `pdfRaster.ts` — render one page at a bounded scale to `ImageBitmap`; close each bitmap after that page is recognised | 0.1, 0.3 | Process sequentially to cap memory; never cache or persist pixels. |
| 3.3 | `OcrEngine` + `ocr.ts` — implement exactly the engine selected by 0.7, emitting line TextItems with confidence and normalised boxes | 0.2, 0.4, 0.7 | Self-host the model, dictionary and WASM bytes under `public/`; no `assetLoader` indirection and no hash manifest. Use SIMD; use threads only when `crossOriginIsolated`, with a tested single-thread fallback. WebGPU may be attempted, but WASM fallback is mandatory. Do not substitute PP-OCRv6 (no Greek). |
| 3.3b | `preprocess.ts` — EXIF orientation, bounded downscale, perspective/deskew and empirically selected thresholding | 0.5b, 0.7, 3.3 | Capable-model task. Every option is measured on 0.5b; defaults may improve scores but may not lower any held-out metric. Preserve an “original” retry path. |
| 3.4 | `fileRouter.ts` — route each PDF page independently. A text layer is usable when it has ≥20 letters, ≥2 standalone numeric tokens and either a known anchor or a measurement-shaped row; otherwise raster/OCR that page. If E0 produces zero rows, automatically retry E1; review also exposes “retry this page with OCR”. Images use E1. | 2.5a, 3.1–3.3b | Replaces the undefined `<5 rows` heuristic and handles hybrid PDFs/garbage text layers. Enforce 20 files, 100 total pages, 50 MiB per source and supported MIME/signature checks before decode. Return batch-scoped limit/cancel failures and source-scoped type/size/decode/OCR failures exactly as `RouteFailure`; successful siblings remain in `results`. |
| 3.5 | `fileFormat.ts` — plaintext UTF-8 envelope, migrations, bounds, `validateProfile`, `assertProfileSafe`, preview and id-based merge plan | 0.2, 2.6 | Golden serialized file, round-trip, malformed JSON, size/cardinality boundaries, unsupported version, duplicate/conflicting Report ids, and same-day precision resolution tests. No `crypto.ts`, WebCrypto, compression or passphrase UI. |
| 3.6 | `storage.ts` — plaintext IndexedDB `saveProfile`, `loadProfile`, atomic `replaceProfile`, `clearAll` and first-save `navigator.storage.persist()` result | 0.1, 0.2 | Store exactly one Profile and no drafts/evidence. `clearAll` removes the database and every Medigraph Cache Storage entry; app state separately disposes live object URLs/bitmaps. |
| 3.7 | `sw.js` — versioned cache of an explicit, committed app/model asset list only; cache-first exact-path lookup after first visit | 0.4, 3.3 | Never cache navigations with user data, blob/data URLs, source files or arbitrary request URLs. No push, background/periodic sync or dynamic `importScripts`. Cross-origin requests only for origins in D1's `connect-src` allowlist (none in v1). Scope to the app; upgrades remove old asset caches. E1 remains usable offline after assets were first fetched. |
| 3.8 | **E0 and E1 walking slices + contract freeze.** Through the minimal `MedigraphApp` shell, run one synthetic PDF and one corpus image from attach → ExtractionResult → source-aware review → explicit Confirm → Profile/Series → IndexedDB → panel/trend primitive → plaintext export/import. | 2.5c–2.7, 3.1–3.7 | Both slices pass under production CSP and with no test-only adapters. Assert `registryVersion` in every ExtractionResult and fixture. Resolve any contract mismatch in this plan, then mark `types.ts` frozen. Do this before broad UI component work. |
| 3.9 | **E1 quality gate.** `pnpm ocr:score` runs source images through preprocessing, actual OCR and parser; it never consumes committed OCR TextItems. | 0.5b, 2.5c, 3.3–3.4 | Aggregate recall ≥90%, value precision ≥99%, unit/range precision ≥90%; every OCR lab recall ≥85%, value precision ≥98% and unit/range precision ≥80%, including the untouched OCR holdout. If not, E1 is labelled assisted/beta and the failed dimensions are recorded; do not tune expected data. |

### Wave 4 — one mobile-first Preact application island

`MedigraphApp` is the only hydrated island. Child components receive state/actions;
they do not create independent stores or write IndexedDB. The state machine is
`idle → extracting → reviewing → committing → viewing`; Cancel returns to the prior
Profile, and a failed commit leaves it unchanged. No chart reads unconfirmed rows.
Outside serialisable `AppState`, MedigraphApp alone owns an ephemeral
`Map<sourceId, EvidenceResource>` containing File references, rendered page URLs and
open bitmaps. `onInspectSource` resolves a SourceRef through that map; it refuses an
unknown source/page, and direct adapters with `evidenceAvailable:false` show the
explicit unavailable state. Confirm/Cancel/error/unmount revokes every URL, closes
every bitmap and clears the map.

| # | Task |
|---|---|
| 4.0 | `appState.ts` + MedigraphApp evidence owner — reducer/events, one batch transaction, sourceId-keyed inspection callback and deterministic reference/URL/bitmap release on Confirm/Cancel/error/unmount |
| 4.1 | `FileDrop` — drag/drop, picker and mobile capture; enforce 3.4 limits; per-file/page progress; render each typed `RouteFailure`. `too-many-files`, `too-many-pages` and `cancelled` are batch errors; `unsupported-type`, `file-too-large`, `decode-failed` and `ocr-failed` identify a source. Source failures do not discard successful siblings. |
| 4.2 | `ReviewTable` — one session grouped by proposed Report. Preserve an ephemeral `ParsedRow.id`→edited draft mapping until Report construction; it never enters Profile. Every group requires date confirmation and source grouping/splitting; rows support edit/delete and searchable canonical marker reassignment or approved unknown. Reassignment recomputes duplicate conflicts. Conflicts require choose/edit; source page/crop opens beside a row. Low/flagged rows sort first. Identifier panel requires Redact (mask evidence and remove the substring from every derived field), Delete affected row, or False positive for every candidate; unknown labels always appear. Confirm remains disabled until all gates pass, then writes all Reports atomically and disposes evidence. |
| 4.2a | **Review-friction reduction.** A presentation layer over `ReviewTable`: it adds no domain function, weakens no gate and changes no `ReviewSession` shape. (a) **Confidence triage** — a row with `confidence: 'high'` and an empty `flags` array renders collapsed inside a pre-accepted group showing a count and a “review these anyway” disclosure; every other row renders expanded, flagged first, exactly as in 4.2. (b) **Batch confirm** — the primary action accepts all pre-accepted rows at once, with per-row exception still available. It stays disabled until every D6 and D7 gate passes, unchanged from 4.2: triage must never collapse an unresolved identifier candidate, an unconfirmed date, an unresolved conflict or an unapproved unknown marker, and those render expanded regardless of confidence. (c) **Inline correction** — editing a row opens its `SourceRef` crop beside the field rather than in a separate view, reusing the 4.0 `onInspectSource` callback. State in the issue that registry coverage (D5a) is the largest single lever on how many rows need touching, and that this task reduces review effort without reducing review authority. **Pass/fail (Playwright):** a fixture whose rows are all high-confidence and unflagged reaches Confirm in one action; a fixture with one `implausible-value` row and one identifier candidate renders both expanded and holds Confirm disabled until each is resolved. |
| 4.3 | `PanelView` — Report selector and factual meter list exactly per chart spec; empty/missing/split-unit states included |
| 4.4 | `TrendView` — single-Series SVG, one-sided/stepped bands, censored and gap behavior, crosshair and fully equivalent table exactly per chart spec |
| 4.5 | `DataManager` — plaintext export warning; import preview with Cancel/Replace/Merge, same-person gate and same-day time resolution; delete one Report; “Delete everything from this device” unregisters the service worker and clears Profile, caches and live review resources after confirmation; show persistence-denied/eviction education and export nudge. Empty storage always offers Attach and Import. |
| 4.6 | `app.astro` wires the sole island; zero-hydration `index.astro` and `privacy.astro`. Privacy copy says processing/history are local, runtime assets are first-party, IndexedDB/export are plaintext, browsers may evict data, and device/XSS/shared-file risks remain—no legal absolutes. It explains a Network-tab check without presenting it as proof, and lists the `connect-src` allowlist (empty in v1). **D13 disclaimer:** PanelView and TrendView each carry persistent, always-visible copy — not a dismissible modal and not a one-time gate — stating that Medigraph displays the user's own reported lab values and reference ranges, does not interpret them, and is not medical advice. Copy exists in both `el` and `en` and is bound by D13 like every other string. Initial language follows `navigator.language`; an el/en toggle is stored in non-medical localStorage. Review dates always show ISO alongside localized text. |

### Wave 5 — hardening

| # | Task |
|---|---|
| 5.1 | Happy-path Playwright E2E: attach both synthetic seed PDFs → confirm one proposed group/date → resolve review → one Report with 25+ markers → panel → ferritin trend → plaintext export → clear/reload → import preview → identical Profile |
| 5.2 | **D1 egress regression (slim).** Run 5.1 and a real E1 fixture. Assert that every network request targets an origin in the `connect-src` allowlist — `'self'` alone in v1, so any third-party request fails until it is declared — and that every request to a non-`self` origin is a GET or HEAD with no query string, no request body and no app-set header. Instrument `WebSocket`, `EventSource`, `navigator.sendBeacon`, `<a ping>`, form navigation and `RTCPeerConnection` and assert they are never constructed or used; these are unconditional, with no allowlist escape, because none has an inbound-asset use case. Inspect IndexedDB (one Profile, nothing else) and Cache Storage (declared assets only). No canary seeding and no cold/warm/offline matrix. This is regression evidence against accidental egress, not proof against malicious same-origin code. |
| 5.3 | Bundle budget: initial app route ≤150 KB gzip JS; pdf.js, OCR runtime and model bytes absent from the initial chunk and fetched only on their path. Assert the committed `_headers` CSP is byte-identical to the one the app is served under; there are no generated hashes and no manifest to enforce. |
| 5.4 | Accessibility: full keyboard review/panel traversal, focus restoration, 44 px targets, visible labels independent of colour, forced-colours, reduced motion, SVG figure naming, meter text alternatives, trend-table parity and axe pass in both themes/languages |
| 5.5 | **Mobile E1 release gate.** On a named mid-range Android and four-year-old iPhone, measure 0.5b pages on battery: first-fetch separately; steady-state median ≤15 s/page and no page >30 s, no OOM/crash, sequential-page resources released, and ≤512 MiB peak where measurable. If quality (3.9) or either-device gate fails after preprocessing/INT8 work, ship E1 as assisted/beta—not as the default—and keep all data local. |
| 5.6 | Safety/lifecycle E2E: no-date and ambiguous-date blocks; same-date split with distinct times and duplicate-minute rejection; duplicate-marker conflict rebuilt after reassignment; unresolved PII/unknown label block and derived-field redaction; source disposal; one-sided/censored charts; converted range and incompatible-unit split; import into non-empty store for Cancel/Replace/Merge/id/precision conflict; interrupted transaction preserves old Profile; delete one/all and eviction empty states |

---

## Verification

**Static quality gate.** `pnpm verify:static` runs ESLint over ts/tsx/astro/jsx,
json/jsonc, markdown, yaml and html, then `eslint-config-prettier`'s CLI helper to
prove no enabled rule conflicts with the formatter, then `prettier --check .` over the
same languages plus bash and Dockerfile, then `astro check && tsc --noEmit`. ESLint
always precedes Prettier and CI never rewrites files. `shellcheck` and `hadolint` cover
the two languages ESLint cannot parse. The CI `lint` job gates `test` and `build`, so a
formatting or lint failure stops the pipeline before Vitest and Playwright run.

**Unit/integration.** `pnpm vitest run` covers every pure domain table, profile
validator/safety boundary, merge transaction and file-format negative path. Seed and
parser-corpus tests consume TextItems. OCR tests never do: they begin with committed
images/scanned PDFs and generate observations during the run.

**Metric semantics.** An expected marker contributes once to recall. Match rows
one-to-one by marker key; every emitted row contributes once to value precision, and
an unmatched/duplicate row is incorrect. A matched row is correct only when
ParseStatus, result comparator and value match; therefore emitting `missing` for an
expected value lowers value precision. Numeric comparisons use
`max(1e-9, abs(expected) * 1e-6)` tolerance. Unit precision compares normalised units.
Range precision requires the same range kind, the same one-sided comparator and every
bound within tolerance. Missing rows match only `status:'missing'`, `value:null` and
`comparator:null`; any retained range is scored normally. Scores print integer
numerator/denominator as well as percentages so small labs cannot hide behind rounding.

**Parser gate.** `pnpm corpus:score` runs the hand-checked TextItem corpus at the
2.5c aggregate/per-lab floors, with Pass B both enabled and disabled. The first blind
holdout result is recorded before anyone examines misses or adds aliases. If Pass A
falls below its floor, improve registry/anchoring rather than making layout parsing
primary. CI subsequently prevents regression below the committed floors.

**OCR gate.** `pnpm ocr:score` separately runs 0.5b from source pixels through the
selected engine and parser at the 3.9 floors. Report detection/recognition failures,
parser failures and registry misses separately. Tune preprocessing/recognition only
on training labs, then run the untouched OCR holdout once. Failing quality or Task
5.5 device limits changes the E1 product label to assisted/beta; it does not justify
a hidden upload path.

**End-to-end.** `pnpm playwright test` runs 5.1, 5.2 and 5.6 against the exact static
build under production headers. Tests inspect the actual `.medigraph` download and
browser stores, not an in-memory substitute.

**Privacy evidence and its limit.** Task 5.2 checks that every request targets a
declared `connect-src` origin, that non-`self` requests carry no query, body or
app-set header, and that the banned outbound APIs are never used, across E0 and E1.
Any mismatch blocks release. This demonstrates the built app's exercised behavior; it
cannot prove that malicious same-origin code with memory access is safe. Pinned
dependencies, lockfile review, CSP and XSS prevention are therefore part of the same
control, not claims delegated to Playwright.

**Manual release pass.** On both Task 5.5 phones, photograph a synthetic fixture,
attach it, inspect crops, correct a row, cancel once to verify disposal, repeat and
confirm, then use panel/trend/export/import offline. Test screen reader/table parity
and the plaintext warning. Record device/browser versions and observations.

---

## Appendix — OCR / vision-model research (rev. Aug 2026)

The original version of this appendix asked "which vision model can we self-host for
Greek lab reports on a €4.54/mo OVH VPS-1?" and answered "none, and we don't need
one". That conclusion stands. The question was too narrow, though: the real question
is whether *any* vision model — on-device, on a server we run, or behind a third-party
API — could be trusted well enough to **delete the mandatory review step (D6)**, which
is the app's worst user experience. This revision answers that, and prices the server
option in full rather than dismissing it on cost.

**Two findings up front.** No vision model removes review. And the server option is
*cheap* — roughly €3/month of real compute, not the €184–569/mo that "a VPS" implies —
so cost is not why we reject it. Both matter: the second one means this decision has
to be defended on its actual grounds, because the next person to propose a server will
be right about the money.

### 1. Why no vision model removes the review step

This section is model-independent. It applies to a browser VLM, a VLM on our own
hardware, and a hosted API equally.

- **On Greek specifically**, VLMs exhibit visual-grounding failure: they generate
  plausible Greek from language priors instead of reading pixels, producing confident
  output that does not correspond to the image ([arXiv 2605.27750](https://arxiv.org/abs/2605.27750)).
  That is our exact language and our exact intolerable failure mode.
- **On medical reports specifically**, character-level errors on fine-print numeric
  values and units are a recurring end-to-end VLM failure pattern
  ([MedRepBench, arXiv 2508.16674](https://arxiv.org/abs/2508.16674)).
- **The failure *shape* is the problem, not the rate.** Our parser fails loudly: it
  emits `ParseFlag`s (`ambiguous-thousands`, `implausible-value`, `unrecognised-unit`,
  `low-ocr-confidence`) and a `Confidence`, and review sorts on them. A generative
  extractor resolves an ambiguous `1`/`7` silently. A wrong-but-plausible ferritin
  value that never surfaces in review is the worst outcome this product has, and a
  model that raises average accuracy while removing the signal that says *which rows
  to distrust* is a net loss for us even at a better headline score.
- **It would degrade review even where it improved extraction.** A VLM enters the D4
  seam through the `parsedRows` branch with `evidenceAvailable: false`, so review
  shows "source preview unavailable". We would lose crop inspection — the thing that
  makes review *fast* — and bypass the marker registry that D5a calls the product's
  core asset.
- **Review is not only a correction step.** The D7 identifier scrub is a hard
  persistence gate, and the D6 date, grouping and same-person questions are user
  confirmations rather than extraction results. No extractor discharges them.
- D13 (display-only, MDR Rule 11) is also easier to defend with a deterministic parser
  than with a generative model.

The achievable prize is therefore demoting review from "correct every row" to "glance
and confirm". That is a UX problem, addressed in the review-friction task, not a model
problem.

### 2. Would accepting PDFs only remove it?

No, but it is the strongest *available* accuracy lever and it is already the E0 path.
The distinction that matters is not PDF-versus-image but **text-layer versus
raster** — a scanned report wrapped in a PDF still needs OCR, which is why Task 3.4
routes per page rather than per file.

Restricting to text-layer PDFs eliminates the recognition error class outright: pdf.js
yields exact character codes, so `low-ocr-confidence` disappears. What survives:

- **Recognition is solved; parsing is not.** Deciding that `245` is the value and
  `30 - 400` is the range — rather than a previous-visit column, a footnote marker or
  an age-banded second range — is the hard part, and a perfect text layer does not
  help with it. Greek labs that print a prior result beside the current one are the
  dangerous case: both numbers are read perfectly and charting the wrong one is silent.
- **Text layers are not always honest.** Content-stream order is not reading order,
  and subsetted fonts with broken `ToUnicode` CMaps yield mojibake or Latin lookalikes
  (`Α`/`A`, `Ρ`/`P`, `Ο`/`O`) that are especially damaging in Greek. Task 3.4 already
  assumes garbage text layers exist and gates on usability.
- **D6 and D7 are untouched.** A text-layer PDF carries the patient's name and AMKA in
  *machine-readable* form, so the scrub gate matters at least as much. Collection,
  report, print and birth dates all appear; `DateCandidate.kind` exists precisely
  because choosing among them is not automatic.
- **Registry misses and duplicate-marker conflicts** remain review actions by
  construction.

So PDF-only shrinks review's workload substantially without removing it. Whether it
shrinks it *enough* to feel effortless is measurable rather than arguable: the corpus
scorer's `valuePrecision`, `unitPrecision` and `rangePrecision` against the Task 3.9
floors answer it directly, on our own documents. Note the product cost before treating
it as free — phone photos of paper reports are plausibly the dominant input for older
Greek results, and "your PDF is the wrong kind of PDF" is a confusing rejection. As a
*sequencing* decision (ship E0 first, hold E1 to its gates) it is sound and already
what D1a describes; as a claim that review becomes unnecessary, it is not supported.

### 3. On-device (E2-local): blocked on capability, not on privacy

| Model | Greek | Browser path | Weight budget |
|---|---|---|---|
| **PP-OCRv5 `el` mobile** | ✅ dedicated `el_PP-OCRv5_mobile_rec`, 89.28 % | ✅ onnxruntime-web | **~15 MB** (det 4.94 MB + rec ~10 MB) |
| Tesseract `ell` | ✅ | ✅ mature | ~1.4 MB data |
| PaddleOCR-VL 0.9B / 1.5 / 1.6 | ✅ edit distance **0.135** ([arXiv 2510.14528](https://arxiv.org/abs/2510.14528)) | ❌ no ONNX export; Paddle-framework | ~500–700 MB at Q4 |
| SmolVLM | ❌ 6 languages, no Greek | ✅ | — |
| Granite-Docling-258M | ❌ English + experimental AR/ZH/JA | ✅ | best size fit, no Greek |
| LFM-2.5VL-1.6B | ❌ not claimed | ✅ shipped WebGPU demo | **~1.5 GB, ~90 s first load** |
| dots.ocr | ✅ | ❌ | 3B — consumer GPU |
| PP-OCRv6 tiny/small/medium | ❌ | ✅ (but useless) | 1.5–34.5M |

Greek is PaddleOCR-VL's second-worst script (0.135 against 0.013 for Latin — roughly
ten times the error rate) and that is on clean benchmark scans, not phone photos.
GGUF/llama.cpp support for it landed 2026-03-06 and wllama v3 added WebGPU with
multimodal, so a browser path is newly *conceivable*; nobody has published one. That
is a research project, not an integration.

**The device gate settles it regardless of Greek.** A 0.9B model at Q4 is ~500–700 MB
(≈40× PP-OCRv5) with a 1–2 GB working set. Task 5.5 gates on a mid-range Android and a
four-year-old iPhone at ≤512 MiB peak and ≤15 s/page, and Safari's WebGPU Metal
backend caps buffers at ~256 MB on iPhone (~993 MB on iPad Pro). It does not fit.

**Weight delivery never requires a server.** Cloudflare Pages caps one asset at
25 MiB, but ONNX external-data sharding splits a 600 MB model across ~25 files against
a 20,000-file limit, and an R2 public bucket serves multi-GB files with no egress fee.
If it runs on the device, our existing hosting delivers it. If it needs a server, it is
not on-device — the document has left, and D1 is gone. **There is no version of
"run it locally" that forces us to provision a VPS.**

### 4. Off-device (E2-remote): cheap, and still rejected

**A cheap CPU box is dead on measured numbers.** PaddleOCR-VL 1.6 takes ~53 s/page on
an Apple M5 Pro CPU; two shared vCores are a small fraction of that machine, putting a
page in the several-minute range. That corroborates the original estimate here with
measurement rather than extrapolation. The CPU escape route also got worse: Hetzner
raised dedicated-vCPU CCX prices 113–176 % in June 2026 (CCX63 now €853.49/mo).

**Flat-rate GPU hosting is the wrong shape for this workload.**

| Option | Price | Notes |
|---|---|---|
| Hetzner GEX44 (RTX 4000 SFF Ada, 20 GB) | €184/mo + €79 setup | EU |
| Scaleway L4 (24 GB) | €0.79/GPU/hr ≈ €569/mo always-on | EU |
| GPU Mart RTX A4000 (16 GB) | $119/mo | US — triggers Chapter V transfer machinery |

VRAM is a non-issue (~1 GB INT8, ~2 GB FP16). Throughput is ~45 pages/min peak on an
L40S and roughly half that sustained; a RTX 4000 is a fraction again. That is far more
capacity than we need, running permanently, for a workload where each user attaches a
handful of pages a few times a *year*. At 100 active users/month × ~15 pages, a
€184/mo box costs ~€0.12/page while scale providers charge ~$0.0007 — about 170×
worse, because the box idles more than 99 % of the time.

**The right shape, if one accepted the premise, is serverless GPU.** Bursty
scale-to-zero traffic is what per-second billing exists for. 1,500 pages/month at ~4 s
of GPU each is ~100 GPU-minutes: **roughly €2–4/month.** Infrastructure cost is a
rounding error and "a VPS" was never the right question.

**So the rejection rests entirely on the following, and must be stated that way.**

- **The legal posture inverts.** We would receive Article 9 special-category health
  data and become a controller: explicit consent under Art. 9(2)(a), Art. 13
  transparency, a **DPIA under Art. 35** (likely mandatory), Art. 30 records,
  Art. 33/34 breach notification within 72 hours, an Art. 37 DPO assessment, an
  Art. 28 processor agreement with the host, and Chapter V transfer machinery if the
  hardware sits outside the EEA — which eliminates the cheapest row in the table above.
- **It contradicts the project's binding constraint.** The constraint is GDPR-shaped:
  *no sensitive user data on Medigraph's server.* A VPS is Medigraph's server. This
  option collides with that constraint more directly than a third-party API does,
  because it puts the data on the one machine the constraint names.
- **It demolishes the architecture.** It supersedes D1, D1a and D2, voids ADR-0009,
  rewrites the Task 0.4 CSP, deletes the Task 5.2 egress regression test, and requires
  a new threat model and privacy page. D2's pure-static, no-Workers, no-SSR property —
  the shape the whole plan is built on — is gone.
- **It carries permanent operational duty**: upload endpoint, consent flow, auth, rate
  limiting, abuse prevention, queue, DDoS, secrets, monitoring, patching, on-call,
  deletion guarantees, no-training warranties, audit logging.
- **And it still does not delete review** (§1).

### Consequences for this plan

- **No VPS, and not because of the price.** Both E1 candidates run client-side, so no
  server is needed; and if one were provisioned anyway it would cost about €3/month in
  compute while costing the project its privacy posture. Do not provision one. If E1
  proves inadequate, improve preprocessing and quantisation, restrict to E0, or ship
  E1 as assisted/beta — do not quietly add a server fallback.
- **Any off-device deployment breaks D1's invariant**, whether the server is a third
  party's or our own. It is a different product posture requiring an ADR that
  supersedes D1/D1a, a new threat/legal review, rewritten privacy copy, explicit
  per-use consent and a separate build. This plan neither approves nor implements it.
- **Do not adopt PP-OCRv6.** It is newer, smaller and faster, and it cannot read
  Greek — its 50 languages are ZH/EN/JA plus 46 *Latin-script* ones. Greek support
  exists in v5 and was dropped in v6. Recorded in the D3 ADR so nobody "upgrades" into
  a regression.
- **Do not swap in Granite-Docling** on size grounds either; it has no Greek.
- **PP-OCRv5 remains the leading E1 candidate, not a foregone conclusion.** It emits
  positioned text boxes — natively our `TextItem[]` (D4) — feeding the marker-anchored
  parser unchanged, where a document VLM emits prose that would have to be re-parsed.
  Its published accuracy is clean-input accuracy and is not evidence about Medigraph
  phone photos: Task 0.7 decides integration feasibility, Tasks 3.9 and 5.5 decide
  quality and device readiness, and `tesseract.js` with `ell+eng` remains the named
  fallback rather than being pre-dismissed. No official ONNX export of the Greek
  recognition model exists; conversion and dictionary wiring are exactly what 0.7 must
  prove. At ~15 MB it is an accuracy upgrade that costs no privacy and needs no server.

## Known risks

- **OCR quality and latency on photos remain the weakest product path.** Published
  character accuracy is not report-level value precision. Skew, shadows and dense
  tables can defeat either candidate. The image corpus, pleasant source-aware review,
  explicit E1 label and supported-phone gates are mandatory; model branding is not
  evidence.
- **Same-origin software is the privacy trust boundary.** A malicious bundled script
  that can read memory can attempt many egress channels. Self-hosting, lockfile
  review, strict CSP, no raw HTML, safe text rendering and the Task 5.2 regression
  test reduce risk but cannot mathematically prove a compromised app harmless. Treat
  dependency and XSS review as D1 work. Note the D1 origin allowlist is a guard
  against *accidental* egress, not against deliberate egress by compromised code.
- **Service workers are privileged, persistent code.** Cache only the explicit
  committed asset list, prohibit dynamic code and user-data caching, test upgrades, and
  unregister/clear it on “Delete everything”. A stale worker must not bypass new CSP
  or pin vulnerable model/runtime bytes forever.
- **Plaintext local data is intentionally exposed to local threats.** IndexedDB and
  `.medigraph` protect neither against another user of an unlocked device, malware,
  browser compromise, backup/sync software nor accidental file sharing. UI copy must
  never imply encryption; users needing at-rest protection rely on device/file-system
  controls outside Medigraph.
- **Display-only positioning is load-bearing and easy to erode.** D13 keeps Medigraph
  outside MDR Rule 11, but the failure mode is gradual: one “trending low” badge, one
  marketing sentence promising insight, one colour-by-direction trend line. The
  intended purpose a regulator reads is the one stated in `index.astro`, not the one
  in this plan. Review every user-facing string against D13, in both languages, and
  get a real regulatory opinion before any EU launch — this document is engineering
  guidance, not legal advice.
- **No user-data egress is not “no network” and not a legal conclusion.** The browser
  fetches first-party static assets, and the hosting provider sees ordinary asset
  request metadata. Product copy may say Medigraph does not send documents/results;
  it must not promise an empty Network tab, zero breach surface, no obligations or
  protection from a compromised device.
- **IndexedDB is evictable.** Browser storage persistence is best-effort. Show the
  persistence result, make plaintext export easy, and provide an honest empty/recovery
  state rather than promising a particular retention period.
- **Anonymous single-Profile storage can still mix people.** The same-person gate is
  explicit but cannot be verified without storing identity. Never auto-append/import;
  make Replace/Merge and report counts visible, and preserve cancellation.
- **Guard the D4 seam even though no E2 tier is implemented.** Optional source evidence
  must not become a required pdf.js/OCR object, and direct-row adapters must still
  satisfy date and identifier review contracts.
- **Marker alignment across labs will occasionally be wrong.** v1 mitigation is
  canonical-marker reassignment in review. A post-confirm “merge series” flow remains
  a possible v2 feature; it may not be simulated through unsafe aliases.
- **A bad alias is worse than a missing one.** Keep sourced aliases, sectionHint-only
  T4 tie resolution, implausible flags and human registry review. Never tune aliases
  from the sealed holdout before its score is recorded.
- **Corpus acquisition is the schedule risk.** Start 0.5a/0.5b with scaffolding and
  0.7. The identifying root PDFs are not fixtures; synthetic seed recreations unblock
  domain work only after Task 0.3 completes.
