# ADR-0020: An identifier candidate says whether the document put it there

- **Status:** Accepted
- **Date:** 2026-09-08
- **Decisions:** D7, D14
- **Amends:** the frozen `types.ts` contract (Task 3.8)

## Context

`docs/plan.md` has always said that Pass V pre-resolves the ΑΗΦΥ document's known
identifier positions as `redacted`, leaving those resolutions the user's to reverse.
The code never did it: `beginReview` opened every session with an empty
`identifierResolutions`, so a user attaching one document answered every candidate by
hand — nine of them on the cleanest synthetic fixture, six of which are the labelled
fields the container itself fixes.

The gap was a contract gap rather than a missing line. `IdentifierCandidate` carried
`id`, `kind`, `text` and `sourceRef`, so nothing downstream could tell a match found
under `ΑΜΚΑ:` from an eleven-digit number scanned out of a free-text line. Task 4.2a's
pass/fail line ("an all-clean fixture reaches Confirm in one action") assumed the
behaviour existed and had to be rewritten to what the code could honestly claim.

`types.ts` was frozen by the Task 3.8 walking slice, and this is the first field added
since. It is added rather than derived because the distinction is a fact about _where
the text was found_, which only the detector knows and which is lost the moment it
returns.

## Decision

`IdentifierCandidate` gains **`knownPosition: boolean`** — true when the candidate was
read from one of the labelled fields the ΑΗΦΥ container fixes (`ΑΜΚΑ`, `Επώνυμο`,
`Όνομα`, their `Ιατρού` variants, `Αρ. Υπόθεσης`, `Αριθμός Παραγγελίας`, `Κωδικός`),
false when it was scanned out of a line by shape.

`beginReview` pre-resolves every `knownPosition` candidate as `redacted`, **through
`resolveIdentifier`** rather than by seeding the map: one code path, so the text leaves
the drafts' free text exactly as it would if the user had answered. The resolution
stays theirs to change — `false-positive` and `deleted-row` remain available on every
candidate, and the D7 gate is discharged by an answer either way.

The review screen does not print the text of a candidate resolved as `redacted`
(Task 5.6). A pre-resolved national id is therefore never displayed at all, which is
the intended reading of D7: the document carries an ΑΜΚΑ, Medigraph removes it and
never compares it (ADR-0013).

## Consequences

Review asks about what the document did **not** put in a fixed position. On
`fixtures/seed/ahfy-minimal.pdf` that is nothing, so a clean document now costs exactly
one action — confirming the collection date — which is what Task 4.2a's original
pass/fail line described. Task 4.2a's e2e asserts it directly.

Two costs, both accepted. **A pre-resolution cannot be undone into visible text**: the
scrub has already run, so choosing `false-positive` afterwards records a different
answer without restoring the string. That is the safe direction, and it is the same
behaviour a user-initiated redaction has always had. **A mislabelled field would be
scrubbed silently** — if a laboratory printed something under `Κωδικός` that was not an
identifier, the user would see the row's text already removed rather than being asked.
The container is fixed and validated by Pass V before any of this runs, which is what
makes that acceptable; a document whose labels are not the ΑΗΦΥ labels never reaches
review at all.

`ExtractionResult` is unchanged. Fixtures that construct candidates state the new field.
