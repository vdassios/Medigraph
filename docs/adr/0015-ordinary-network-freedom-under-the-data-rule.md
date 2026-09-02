# ADR-0015: The data rule is the whole of D1

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision:** D1 (supersedes [ADR-0009](0009-egress-data-rule-and-origin-allowlist.md))

## Context

ADR-0009 established the right rule — the enforceable line is _what leaves the device_,
not _which origins are contacted_ — and then kept a second apparatus enforcing the same
thing by proxy: a `connect-src` allowlist mandated empty in v1, a request-shape rule
confining non-`self` requests to GET/HEAD with no query, body or app-set header, an
unconditional ban on `WebSocket`, `EventSource`, `sendBeacon`, `<a ping>`, form
navigation and `RTCPeerConnection`, and self-hosting as the standing default.

That apparatus does not add protection the data rule lacks. Both ADR-0001 and ADR-0009
concede the point directly: none of it constrains deliberate exfiltration by compromised
same-origin code, which can encode data in a GET path to an allowlisted origin as easily
as in a POST body. What it constrains is ordinary development. A web font, a marker
registry update, an asset host, a third-party library — none of which touches document
content — each required a plan amendment or a shape argument before it could be used.
The rule was written to bar a class of data flow and ended up policing the mechanics of
every network call, which is a different and much larger thing.

The simplification of the product removed the last reason to keep the proxy. With one
document class, a text-layer parser and no model weights, the network surface is a
static site's: assets in, nothing out.

## Decision

**D1 is the data rule, and nothing else.** No document content, extracted text, crop,
identifier, confirmed value or anything derived from them leaves the device — not to
Medigraph's own origin, not to any third party. Medigraph stores no user data on any
server it operates. There is no telemetry and no error reporting, because both would
carry data derived from use.

**Network access is otherwise ordinary.** `fetch` is an ordinary API. Third-party
origins, CDNs and asset hosts are ordinary dependency choices, reviewed like any other.
Self-hosting stays the default for cost and for the consent obligation a third-party
fetch triggers (a CDN fetch discloses the visitor's IP — LG München 3 O 17493/20), but
it is a preference, not a rule, and departing from it needs no ADR.

**Withdrawn:** the mandated-empty `connect-src` allowlist, the non-`self` request-shape
rule, the banned-outbound-API list, and self-hosting as a D1 obligation. Adding an
origin is a code change, not a decision record.

**Retained in full, because they are security controls rather than egress policy:**

- The strict CSP, whose justification remains XSS containment for the plaintext
  `Profile` in IndexedDB. `connect-src` continues to name the origins the app actually
  uses — ordinary practice for any application handling sensitive local state, and the
  reason an injected script cannot simply POST the Profile to an attacker. What changes
  is that the list is sized to the app's real dependencies instead of mandated empty,
  and `default-src 'none'`, `object-src 'none'`, `base-uri 'none'` and
  `frame-ancestors 'none'` are unchanged.
- No raw HTML anywhere, text-only rendering, and no `dangerouslySetInnerHTML`.
- Exact dependency pinning, lockfile review, and supply-chain review of anything that
  ships to the browser.
- Service-worker discipline: an explicit committed asset list, no dynamic
  `importScripts`, no caching of user data, navigations, blob or data URLs.
- Transient handling of source files, text, crops and review drafts, which never reach
  IndexedDB, Cache Storage or an export.

## Consequences

Task 0.4 keeps the committed static CSP and sizes `connect-src` to what the app uses;
no line of it is mandated empty. Task 3.7's service worker keeps its asset-list
discipline and drops the allowlist clause. Task 4.6's privacy copy states the data rule
and the no-server-storage claim, and stops enumerating an allowlist.

**Task 5.2 changes character, and improves.** Asserting which origins were contacted no
longer tests D1, because contacting an origin is no longer the violation. The test now
seeds canary values into the fixture document — a marker value, an identifier, a date —
and asserts that no request URL, body or header carries any of them, alongside the
IndexedDB and Cache Storage inspection it already performs. That is a direct test of the
rule that actually binds, where the origin check was an indirect test of a proxy for it.
ADR-0009 dropped canary seeding as part of the machinery it was retiring; it returns
here as the primary instrument.

As before, this is regression evidence against accidental egress. It is not proof
against deliberate egress by compromised same-origin code, and no client-side control
makes it one.

## Alternatives considered

- **Keep ADR-0009 unchanged:** rejected. It imposes a standing tax on ordinary work to
  re-state, weakly, a rule it already states strongly.
- **Open `connect-src` to `https:`:** rejected. That is not egress policy but XSS
  containment, and widening it would let injected script exfiltrate the plaintext
  Profile — the one concrete thing the CSP buys. Naming real origins costs nothing.
- **Narrow D1 to "we do not store user data on our servers":** rejected. Transmitting
  Article 9 health data is processing whether or not it is retained, so the storage-only
  claim is both weaker than what Medigraph does and weaker than what its copy promises.
