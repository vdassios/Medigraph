# ADR-0009: The egress rule is about data, not origins

- **Status:** Accepted
- **Date:** 2026-08-29
- **Decision:** D1 (supersedes [ADR-0001](0001-no-user-data-egress.md))

## Context

ADR-0001 stated D1 as two coupled rules: no user data may leave the device, *and*
every runtime byte must be served from a first-party content-hashed path with no
third-party origin contacted at all. Only the first was ever the requirement.

The second was adopted on a supply-chain argument that ADR-0001 itself conceded it
could not substantiate — it admits browser controls "cannot prove safety against
already-malicious same-origin code" — while imposing permanent cost: a generated
asset manifest, generated CSP script and style hashes regenerated from exact build
output, checked-in hashes churning on every model upgrade, an `assetLoader`
indirection, and a canary-based three-mode egress suite. It also produced a footgun:
because it forbade *requests* rather than *transmission*, any future legitimate
inbound fetch would fail CI and require a plan amendment to unblock.

The actual constraint is GDPR-shaped. Medigraph must not put sensitive user data on
its own infrastructure; data held on the user's own device is fine. Notably, the
strict rule was not even the conservative choice on its own terms: a third-party CDN
fetch discloses the visitor's IP address to that host, which is itself a
GDPR-relevant transfer — the point of the Google Fonts ruling, LG München
3 O 17493/20 — so a CDN would have *added* a consent obligation rather than removed
one.

## Decision

**The binding rule is about data.** No document content, raw or OCR text, crop,
identifier, confirmed value or anything derived from them leaves the device — not to
Medigraph's own origin, not to any third party. There is no telemetry and no error
reporting.

**Third-party inbound asset fetches are permitted but must be declared.** CSP
`connect-src` carries an explicit origin allowlist, empty in v1. Any request to a
non-`self` origin must be a GET or HEAD with no query string, no request body and no
app-set header, which permits retrieving an asset while closing the paths that would
carry data out. `WebSocket`, `EventSource`, `sendBeacon`, `<a ping>`, form navigation
and `RTCPeerConnection` are never used; these are unconditional and have no allowlist
escape, because none has an inbound-asset use case.

**Adding an allowlisted origin is an ordinary code-review decision**, checked against
the data rule. Transmitting user data requires an ADR superseding this one. Declaring
an origin can never authorise E2-remote (see
[ADR-0002](0002-local-extraction-tiers.md)): E2-remote is barred by the data rule, not
by the origin rule.

**Self-hosting is retained as the default, but as a choice rather than a mandate.**
It is free on the Cloudflare Pages target (20,000 files, 25 MiB per file, unlimited
static bandwidth), and it avoids the consent obligation a third-party fetch triggers.

**The manifest and CSP-hash tooling is deleted.** The CSP remains strict and is a
committed static string; with no inline scripts and `build.inlineStylesheets: 'never'`,
no generated hash is required. Its justification changes: the strict policy is now
XSS containment for the plaintext `Profile` in IndexedDB — a narrow, defensible claim
— not the supply-chain argument it could not support.

## Alternatives considered

- **Keep ADR-0001 unchanged:** rejected. It bought build complexity and future
  friction for a threat model it explicitly declined to claim coverage of.
- **Fully open third-party fetching, CDN-hosted models:** rejected as the *default*,
  though now permitted by declaration. On the deployment target it saves no money,
  and it would require a blocking consent interstitial before the app could load its
  own runtime — worse cost and worse UX than self-hosting.
- **Require an ADR per added origin:** rejected as recreating the friction this ADR
  removes. The data rule is the standing constraint, and "does this fetch send
  anything?" is a normal review question.

## Consequences

Task 0.4 loses its manifest and hash generators and commits a static `_headers`.
Task 3.3 self-hosts under plain `public/` paths with no `assetLoader`. Task 3.7
caches an explicit committed asset list. Task 5.2 slims to the allowlist check, the
non-`self` request-shape check and the banned-API assertions, dropping canary seeding
and the cold/warm/offline matrix. Task 5.3 drops hash verification. COOP/COEP are
retained and become free, giving Task 3.3 `crossOriginIsolated` for WASM threads.

The egress test now guards against *accidental* egress. It was never a defence
against deliberate egress by compromised same-origin code, and ADR-0001's stricter
rule did not make it one.
