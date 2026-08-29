# ADR-0007: Plaintext `.medigraph` files

- **Status:** Accepted
- **Date:** 2026-08-29
- **Decision:** D9

## Context

The initial plan proposed AES-GCM with a PBKDF2 passphrase, but passphrase loss,
mobile KDF cost, framing/AAD interoperability and recovery UX add complexity that is
not necessary for v1. The user explicitly chose to drop encryption/decryption.

## Decision

`.medigraph` is UTF-8, two-space-pretty-printed JSON containing `{format, v,
profile}` and one trailing newline. It has no compression, encryption, KDF,
passphrase or binary framing. The file is capped before parse and validated
structurally and semantically.

Export warns that the file contains plaintext medical history. Import always previews
the report count/date span and offers explicit Cancel/Import for empty storage or
Cancel/Replace/Merge for non-empty storage. Replace and Merge are atomic. Merge uses
Report ids, never date equality, requires same-person confirmation, skips identical
id/content duplicates and blocks same-id/different-content conflicts. Distinct Reports
sharing one date require the user to supply unique times for all of them whenever any
is day-precision; existing updates and incoming additions are one atomic merge.

## Alternatives considered

- **AES-GCM/PBKDF2 export:** rejected for v1 by product decision; it adds passphrase
  and interoperability failure modes that outweigh the desired protection.
- **gzip before export:** rejected because transparent JSON is simpler and a size cap
  removes the need while avoiding decompression-bomb handling.

## Consequences

Users must store/share `.medigraph` as carefully as original lab reports. File-system
or device encryption may protect it outside Medigraph. Import errors cover size,
JSON syntax, envelope format, version, validation and Report-id conflicts—never
“wrong passphrase.”
