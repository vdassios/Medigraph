# ADR-0006: Plaintext local Profile storage

- **Status:** Accepted
- **Date:** 2026-08-29
- **Decision:** D8

## Context

Returning users need local history, but browser-side encryption either requires a
recurring passphrase/recovery flow or stores its key beside the ciphertext. Neither
protects against script running in the app origin. The operator still does not
receive IndexedDB content, but “no storage anywhere” would be false.

## Decision

Persist exactly one confirmed anonymous Profile in plaintext IndexedDB. Persist no
source file, raw text, review evidence, identity or extraction draft. Before appending
to a non-empty Profile, require transient confirmation that reports belong to the
same person. Call `navigator.storage.persist()` and disclose its result without
promising retention.

Product copy explicitly states that local history is plaintext and vulnerable on a
shared, lost, compromised or backed-up device. `clearAll` removes the Profile and all
Medigraph caches; atomic replacement leaves the old Profile intact on interruption.

## Alternatives considered

- **Passphrase-encrypted IndexedDB:** rejected for v1 as unnecessary recovery and
  unlock complexity; it would not protect against XSS while unlocked.
- **No local persistence:** rejected because it makes longitudinal use impractical,
  especially on phones.

## Consequences

Device/file-system security is the user's at-rest control. The privacy promise is
operator non-receipt and no egress, not local encryption or guaranteed durability.
