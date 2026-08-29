# ADR-0001: No user-data egress and self-hosted runtime assets

- **Status:** Superseded by [ADR-0009](0009-egress-data-rule-and-origin-allowlist.md)
- **Date:** 2026-08-29
- **Decision:** D1

> **Superseded on 2026-08-29.** The data rule below still holds and is restated in
> ADR-0009. What was withdrawn is the coupling of that rule to origins: the mandate for
> content-hashed first-party paths, the generated asset manifest and CSP hash lists, and
> the blanket prohibition on third-party runtime fetches. Those were stricter than the
> requirement and imposed permanent build cost for a supply-chain claim this ADR itself
> declines to make. Read ADR-0009 for the current decision.

## Context

Medigraph handles source documents, OCR text and longitudinal medical results in the
browser. An origin allowlist does not prevent data encoded in an allowed URL path or
header, and a live CDN/model host is part of the runtime trust boundary. A browser
test can observe exercised traffic but cannot prove already-malicious same-origin
code harmless.

## Decision

No document content, raw text, crop, identifier, result or derived user data may
leave the device, including to Medigraph's own origin. There is no telemetry.

Every runtime script, stylesheet, worker, model, dictionary and WASM binary is served
from an exact first-party content-hashed path in a generated manifest. CSP, a narrow
asset loader, a static-asset-only service worker and an end-to-end egress regression
test enforce the intended behavior together. Dependencies, lockfiles and generated
hashes are reviewed as part of this control. The product describes the test as
evidence, not a proof against compromised code.

Source files and derived evidence are memory-only and may never be cached or
persisted. Product copy may say that documents/results are not sent; it may not claim
an empty network log, immunity to XSS/device compromise or a legal conclusion.

## Alternatives considered

- **Third-party origin allowlist:** rejected because allowed paths, headers and host
  compromise remain exfiltration channels and cross-origin isolation becomes fragile.
- **`connect-src 'none'`:** rejected for v1 because lazy first-party OCR/model fetches
  require same-origin connections. Exact manifest paths and tests constrain them.
- **CSP or Playwright alone:** rejected; neither is a complete supply-chain or
  malicious-script boundary.

## Consequences

Build tooling must generate the manifest and CSP hashes from exact static output.
Model/runtime upgrades change checked-in hashes and service-worker cache versions.
Any future remote processing explicitly supersedes this ADR rather than adding an
exception hidden behind a feature flag.
