# Medigraph domain context

`docs/plan.md` is the normative source for architecture, field-level contracts and
behavior. This file is the compact vocabulary map; when it conflicts with the plan,
fix both in the same change and treat the plan as authoritative.

## Purpose

Medigraph turns user-supplied laboratory PDFs and images into reviewed, local
longitudinal marker data. The operator never receives document content or results.
Confirmed history and exported backups are intentionally plaintext on the user's
device, so the UI must not imply at-rest protection. Medigraph displays what the labs
reported; it never interprets it.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **Source file** | A PDF or image attached for one review session. It is transient. |
| **TextItem** | A positioned text observation with a stable id, page-normalised rectangle and optional recognition confidence. |
| **Row** | TextItems clustered by vertical overlap. |
| **ParsedRow** | An ephemeral measurement candidate with parse status, confidence, flags and optional source evidence. |
| **ExtractionResult** | One source file's ephemeral rows, date candidates, identifier candidates and optional evidence pages. |
| **Review session** | One attach batch's transactional draft. All gates must resolve before one atomic Confirm. |
| **Marker** | A biological quantity tracked over time. |
| **Marker key** | A stable canonical id, or `x:<normalised-label>` for a reviewed unknown marker. |
| **Report** | The confirmed measurements from one collection event, identified by an opaque UUID and user-confirmed local civil date/time. Equal dates do not imply the same Report. |
| **Measurement** | One confirmed marker result in native lab value, unit and reference range. Marker keys are unique within a Report. |
| **Reference range** | A closed, minimum-only or maximum-only interval printed by the lab for one Measurement. It is not a property of the Marker. |
| **Series** | One marker's compatible-unit Measurements across Reports, ordered by collection date/time. |
| **Profile** | One anonymous person's complete confirmed local dataset. It is the only medical-data object persisted or exported. |
| **Conflict** | Duplicate candidate rows for one marker in a proposed Report; review must choose or edit exactly one Measurement. |

## Invariants

- Runtime processing is local; no source or derived user data is sent to any origin —
  neither Medigraph's own nor a third party's. No telemetry, no error reporting.
- Third-party *inbound* asset fetches are permitted only from a declared `connect-src`
  origin allowlist, empty in v1; requests to a non-`self` origin carry no query, body
  or app-set header. No remote E2 code ships in v1, and declaring an origin can never
  authorise it.
- Source files, raw text, crops, bitmaps, object URLs and review drafts never enter
  IndexedDB, Cache Storage or `.medigraph`.
- A Profile has no patient identity. Appending or merging requires an explicit
  same-person confirmation but does not persist that answer.
- Review resolves dates, source grouping, duplicate markers and every identifier
  candidate before Confirm.
- A Report has at most one Measurement per marker key. Equal dates never auto-merge.
- Values and reference ranges stay native in Profile. Series conversion transforms
  both by the same factor and preserves native fields; incompatible units split.
- `.medigraph` is bounded, validated plaintext JSON with explicit Cancel/Replace/Merge
  import behavior. It has no encryption or passphrase.
- No user-facing string characterises a Measurement or a Series. Status language is
  factual and traceable to the range that lab printed; no severity, no trend
  direction, no clinical inference, in any view or in product copy.

## Accepted decision records

- `docs/adr/0001-no-user-data-egress.md` — superseded by 0009
- `docs/adr/0002-local-extraction-tiers.md`
- `docs/adr/0003-gated-local-ocr.md`
- `docs/adr/0004-extraction-observation-seam.md`
- `docs/adr/0005-transactional-review-and-identifier-gate.md`
- `docs/adr/0006-plaintext-local-profile-storage.md`
- `docs/adr/0007-plaintext-medigraph-files.md`
- `docs/adr/0008-csp-style-attribute-amendment.md`
- `docs/adr/0009-egress-data-rule-and-origin-allowlist.md` (supersedes 0001)
- `docs/adr/0010-display-only-positioning.md`
