# ADR-0013: ΑΗΦΥ documents are the only accepted input

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decisions:** D1a (rewritten), D3, D4, D5, D6, D14 (rewritten)
- **Amends:** [ADR-0002](0002-local-extraction-tiers.md), [ADR-0004](0004-extraction-observation-seam.md), [ADR-0012](0012-template-recognition-assists-review.md)
- **Supersedes:** [ADR-0003](0003-gated-local-ocr.md)

## Context

The plan was built to absorb the variability of loose Greek laboratory PDFs and phone
photographs: two extraction tiers, a layout-discovery pass, a date-candidate scorer, a
multi-source grouping flow, an eight-lab corpus, and most recently a template
recognition pass. Each of those exists to answer a question of the form "which of many
shapes is this?".

Greece answers that question centrally. Results from every public and private facility
land in the ΑΗΦΥ digital repository, and a patient retrieves their own history from
`myhealth.gov.gr` with Taxisnet, ΑΜΚΑ and an OTP. The repository emits one document
class: ReportLab-generated, pyHanko-signed, A4, always carrying a text layer.

Three documents from three different issuing laboratories were examined. The container
is identical in all three — the same title, the same twelve metadata labels in the same
order, the same five-column table header `Περιγραφή | Αποτέλεσμα | Μονάδα Μέτρησης |
Φυσιολογικές Τιμές | Παρατηρήσεις` — and each document is exactly one order: one
laboratory, one collection date, every department consolidated into one file.

The repository does **not** normalise cell contents. Across those same three documents
the marker wording varied (`Λευκά Αιμοσφαίρια (WBC) (WBC)`, `Λευκά αιμοσφαίρια (WBC)
(WBC)`, bare `WBC (WBC)`), the decimal separator varied by laboratory (one 41 periods
and no commas, another 23 commas), the unit notation varied for one quantity
(`x10^3 / μL`, `k/ml`, `k/μl`), and mixed-script text is normal rather than corrupt —
`(ΜCV)` opens with U+039C Greek capital mu, `Μ/μl` mixes three scripts, and one issuing
laboratory's name ends in a Latin `O`.

## Decision

Accept exactly one input: the ΑΗΦΥ document. Reject everything else at attach with a
message naming what is accepted and where to obtain it.

**Deleted, not deferred:** E1 in-browser OCR, with its engine selection, models,
dictionary, WASM, preprocessing, device gate and image corpus. No recognition step ships
in any form. E2-local and E2-remote remain unbuilt, E2-remote still barred by D1.

**Deleted as unreachable:** Pass B layout discovery (`columns.ts`, `grammar.ts`), since
column roles are given by a validated header; the date-candidate scorer and
`DateCandidate.kind`, since the repository labels its dates; multi-source grouping, since
one document is one Report; and the direct-`ParsedRow` adapter branch of D4, since the
input class is closed.

**Replaced:** template recognition (ADR-0012) collapses to a single document validator.
There is no fingerprint, no similarity score, no learned or shipped profile store, and
no persisted template object. D8's amendment for a template store is withdrawn;
IndexedDB holds one `Profile` and nothing else.

**Retained deliberately:** mandatory review and its confirmation of the collection date,
the D7 identifier scrub, the D8 same-person gate, and the marker registry. The document
carries the patient's ΑΜΚΑ in a known position and Medigraph does **not** use it to
answer D8: it is redacted at the D7 gate and never compared. Never processing a national
id is worth more than a verified same-person answer.

## Consequences

Extraction difficulty moved from layout to content. The registry and `units.ts` are now
the only axes on which quality varies, and per-laboratory scoring is the load-bearing
metric. The corpus floor is restated as issuing laboratories, not layouts.

Two costs, both accepted knowingly. **A user's paper history is out of reach**: results
predating the repository, or held only on paper, cannot be read, and the rejection
message must say so without implying the document is defective. **Everything rests on a
source we do not control**: if the repository changes its template, Pass V fails closed
for every user at once with no fallback, because E1 is gone. That is the right failure
shape, but the product is unusable until an update ships, so a repository redesign is a
release-blocking incident.

The OCR/vision-model appendix is retained as history. Its conclusions about generative
extraction still bar E2 in either form; its engine comparisons are moot.
