# Medigraph domain context

`docs/plan.md` is the normative source for architecture, field-level contracts and
behavior. This file is the compact vocabulary map; when it conflicts with the plan,
fix both in the same change and treat the plan as authoritative.

## Purpose

Medigraph turns a user's ΑΗΦΥ laboratory-result documents — the PDFs they download
from Greece's national digital repository at `myhealth.gov.gr` — into reviewed, local
longitudinal marker data. No other file type is accepted.
The operator never receives document content or results.
Confirmed history and exported backups are intentionally plaintext on the user's
device, so the UI must not imply at-rest protection. Medigraph displays what the labs
reported; it never interprets it.

## Ubiquitous language

| Term                    | Meaning                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ΑΗΦΥ document**       | The only accepted input: one repository-issued laboratory-results PDF. One document is one order — one laboratory, one collection date, every department consolidated.                                     |
| **Source file**         | One ΑΗΦΥ document attached for one review session. It is transient, and is never split or merged.                                                                                                          |
| **TextItem**            | A positioned text observation with a stable id, page-normalised rectangle and optional recognition confidence.                                                                                             |
| **Row**                 | TextItems clustered by vertical overlap.                                                                                                                                                                   |
| **ParsedRow**           | An ephemeral measurement candidate with parse status, confidence, flags and optional source evidence.                                                                                                      |
| **ExtractionResult**    | One source file's ephemeral rows, date candidates, identifier candidates and optional evidence pages.                                                                                                      |
| **Review session**      | One attach batch's transactional draft. All gates must resolve before one atomic Confirm.                                                                                                                  |
| **Marker**              | A biological quantity tracked over time.                                                                                                                                                                   |
| **Marker key**          | A stable canonical id, or `x:<normalised-label>` for a reviewed unknown marker.                                                                                                                            |
| **Marker seed**         | The sourced Greek/English vocabulary extracted from ΚΕΟΚΕΕ (Task 0.5c) that registry aliases may be authored from. It is vocabulary, not a registry.                                                       |
| **Report**              | The confirmed measurements from one collection event, identified by an opaque UUID and user-confirmed local civil date/time. Equal dates do not imply the same Report.                                     |
| **Measurement**         | One confirmed marker result: either a native numeric value with unit and reference range, or a categorical printed string with the lab's printed expected value. Marker keys are unique within a Report.   |
| **Reference range**     | A closed, minimum-only or maximum-only interval printed by the lab for one Measurement. It is not a property of the Marker.                                                                                |
| **Series**              | One marker's compatible-unit Measurements across Reports, ordered by collection date/time.                                                                                                                 |
| **Profile**             | One anonymous person's complete confirmed local dataset. It is the only medical-data object persisted or exported.                                                                                         |
| **Document validation** | The Pass V gate: confirm a source is an ΑΗΦΥ document, or reject it. On acceptance it binds column roles, the collection date and the identifier positions. It never confirms a gate on the user's behalf. |
| **Conflict**            | Duplicate candidate rows for one marker in a proposed Report; review must choose or edit exactly one Measurement.                                                                                          |

## Invariants

- Runtime processing is local; no source or derived user data is sent to any origin —
  neither Medigraph's own nor a third party's. No telemetry, no error reporting.
- Third-party _inbound_ asset fetches are permitted only from a declared `connect-src`
  origin allowlist, empty in v1; requests to a non-`self` origin carry no query, body
  or app-set header. No E2-remote code ships in v1 — off-device inference is barred
  whether the server is a third party's or our own — and declaring an origin can never
  authorise it.
- Source files, raw text, crops, bitmaps, object URLs and review drafts never enter
  IndexedDB, Cache Storage or `.medigraph`.
- A Profile has no patient identity. Appending or merging requires an explicit
  same-person confirmation but does not persist that answer.
- One ΑΗΦΥ document is exactly one Report. A source is never split and never merged, so
  there is no grouping flow. The collection date is read from `Ημερομηνία Λήψης
Δείγματος` and confirmed by the user.
- Only the ΑΗΦΥ document class is accepted. Photographs, scans and loose lab PDFs are
  rejected at attach. There is no OCR anywhere in the product.
- Review resolves dates, source grouping, duplicate markers and every identifier
  candidate before Confirm.
- Document validation pins column roles and pre-resolves gates; it never creates, alters
  or suppresses a value, a flag or a confidence, and never confirms on the user's behalf.
  It fails closed: an unvalidated source yields no rows at all.
- The document carries the patient's ΑΜΚΑ. It is redacted at the D7 gate and never
  compared, so the same-person question stays explicit and unverified.
- A Measurement is numeric or categorical. A categorical result has no unit, is never
  converted, and is never ranked or ordered against another string.
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
- `docs/adr/0011-no-vision-language-model-for-v1.md` (amends 0002)
- `docs/adr/0012-template-recognition-assists-review.md` (amends 0006; largely superseded by 0013)
- `docs/adr/0013-ahfy-documents-are-the-only-input.md` (supersedes 0003; amends 0002, 0004, 0012)
- `docs/adr/0014-categorical-measurements.md` (amends 0007)
