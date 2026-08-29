# ADR-0008: CSP style-directive amendment for inline style attributes

- **Status:** Accepted
- **Date:** 2026-08-29
- **Decision:** Amends the Task 0.4 CSP under D1. Does not supersede D1 or ADR-0001.

## Context

Task 0.4 specified `style-src 'self' <generated-inline-hashes>` with neither
`'unsafe-inline'` nor `'unsafe-hashes'`, and stated that inline style attributes are
forbidden. That is stricter than D1 requires. D1 is about **egress** — protected
assets never leaving the device. Blocking `style` attributes does not serve that goal
directly; it was defence in depth.

The cost lands on ordinary Astro authoring. A `style="…"` attribute is dropped by the
browser at runtime rather than rejected at build time, so the failure mode is an
unstyled element that passes review and breaks in production. Astro's `define:vars`
on a `<style>` block carries its variables by emitting a `style` attribute, so the
original policy made a standard, useful Astro directive unusable. Astro's own CSP
guidance names `define:vars` as the motivating case for allowing style attributes.

The counter-question is what the strict policy was actually buying. The classic
attack it defends against is CSS-based exfiltration: injected CSS uses attribute
selectors plus a remote `url()` to leak DOM content a character at a time. That
channel needs a remote fetch target, and the rest of the policy already denies every
one: `default-src 'none'` with `connect-src 'self'`, `img-src 'self' blob: data:` and
`font-src 'self'`. Under D1's self-hosting rule there is no allowlisted third-party
origin for injected CSS to reach.

## Decision

Amend the style directives of the Task 0.4 CSP, and only those:

```text
style-src 'self' <generated-style-hashes>;
style-src-elem 'self' <generated-style-hashes>;
style-src-attr 'unsafe-inline';
```

Set `build.inlineStylesheets: 'never'` so component `<style>` blocks always emit as
external first-party stylesheets covered by `'self'`, leaving the style hash list
empty in practice and removing a fragile build-output-to-header coupling.

`script-src` is unchanged and gains no `'unsafe-inline'`, `'unsafe-hashes'` or nonce.
No other directive changes. Every other D1 control — the `connect-src` origin
allowlist, the non-`self` request-shape rule, service-worker policy and the Task 5.2
egress test — is untouched.

**Amended 2026-08-29 ([ADR-0009](0009-egress-data-rule-and-origin-allowlist.md)):** the
content-hash manifest and exact-path loader referenced above no longer exist, and the
style-hash list this ADR made empty in practice is now empty by construction, since
`build.inlineStylesheets: 'never'` means the CSP is a committed static string with no
generated hashes at all. The `style-src-attr 'unsafe-inline'` exception itself stands
unchanged.

Style attributes remain **discouraged by convention**. The plan's "Astro component
styles" section keeps class-based CSS in one `<style>` block per component as the
default, and ESLint reports a style attribute as an error waivable per line by an
`eslint-disable` comment that states the reason.

## Alternatives considered

- **Keep the original strict policy.** Rejected: it bans a standard Astro directive
  and produces silent runtime breakage, in exchange for closing a channel that
  `default-src 'none'` and the `'self'`-bounded fetch directives already close.
- **`style-src 'self' 'unsafe-inline'` across the board.** Rejected: it would also
  permit injected `<style>` _elements_, which is a strictly larger surface than the
  attribute case that motivated the change. Splitting into `style-src-elem` and
  `style-src-attr` keeps stylesheet elements as strict as before.
- **`'unsafe-hashes'` with a hash per style-attribute value.** Rejected: it covers
  only attribute values known at build time, so it cannot express a computed value,
  which is most of the motivating cases. It also grows the header with every literal.
- **CSSOM-only (`el.style.setProperty`) with no CSP change.** Not rejected — this
  remains the documented preferred mechanism for dynamic values and has no browser
  caveat. It is insufficient on its own because it does not cover `define:vars` or
  static markup authored in `.astro` files without an island.

## Consequences

What is newly permitted is **restyling, not exfiltration**. An adversary who can
inject HTML but not script — `script-src` still blocks script — can now apply
arbitrary presentational CSS through a style attribute. The concrete harm is UI
redressing: hiding or obscuring content. That matters here more than on a typical
site, because D8 and D9 rely on the user actually reading plaintext-storage and
export-sensitivity warnings. Task 5.4 and Task 5.6 assert those warnings are present
and reachable; neither asserts they are visually unobscured, and no client-side
control can guarantee that once arbitrary markup executes. This is a recognised
residual risk, consistent with the existing position that browser controls cannot
prove safety against already-injected same-origin content.

`style-src-attr` is a CSP Level 3 directive. A browser that does not implement it
falls back to `style-src`, where style attributes stay blocked. Task 0.4 records
which target browsers honour the split. Because of this, a style attribute or
`define:vars` must not carry load-bearing layout or anything a page cannot be read
without.

If a future change needs `'unsafe-inline'` on `style-src-elem` or any relaxation of
`script-src`, it supersedes this ADR explicitly rather than widening these directives
in place.
