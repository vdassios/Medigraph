# ADR-0017: The service-worker asset list is generated, and its cache name is derived

- **Status:** Accepted
- **Date:** 2026-09-05
- **Decision:** Amends Task 3.7's prohibition on generating `public/app-assets.json`.
- **Does not supersede:** [ADR-0009](0009-egress-data-rule-and-origin-allowlist.md). The
  content-hash asset manifest and the CSP hash lists it deleted stay deleted.
- **Does not supersede:** [ADR-0015](0015-ordinary-network-freedom-under-the-data-rule.md)
  or D1. Nothing here changes what is cached, from where, or under what conditions.

## Context

Task 3.7 states: _"Task 3.7 updates it after inspecting a deterministic production
build; no build step generates or mutates it."_ The list in question is
`public/app-assets.json`, the exact same-origin paths the service worker precaches.

The rule is inherited framing rather than a reasoned position. ADR-0009 deleted a
**different** artifact — the content-hash asset manifest, the `assetLoader` indirection
and the generated CSP hash lists — because they were the permanent cost of a
supply-chain argument ADR-0001 conceded it could not substantiate. That reasoning is
about hashes pinned into a security policy. It says nothing about a service worker's
precache list, and Task 3.7 inherited the prohibition without inheriting a reason for
it.

Applied here the rule lumps together two artifacts with very different properties:

- **The caching policy** — what is cached, from what origin, whether an unlisted request
  is touched at all, what happens on upgrade. This is privacy-bearing and belongs in
  reviewed, hand-written code. `public/sw.js` is 55 lines of it.
- **The list of build-output filenames** — `/_astro/MedigraphApp.DzY-C78h.js` and its
  siblings. This is mechanical. A reviewer reading that hash in a diff learns nothing the
  build did not already determine, and cannot meaningfully approve or reject it.

Hand-copying the second has a real cost and no corresponding benefit. Astro content-hashes
every JS and CSS output, so the names change whenever the island changes — which through
Wave 4 is nearly every commit. Each one requires a human to transcribe hashes correctly
into a JSON file, and `serviceWorker.test.ts` fails the build until they do. The
transcription is exactly the kind of work that is done inattentively because there is no
judgement in it.

The manual `version` field carries the same problem in sharper form. It names the cache —
`medigraph-assets-v<version>` — and an upgrade evicts the previous build only if someone
remembers to increment it. The shell paths `/` and `/app/` are not content-hashed, so a
forgotten bump means the previous build's HTML is served from cache indefinitely. A
correctness property should not depend on remembering.

## Decision

**`public/app-assets.json` is generated from the production build**, by
`scripts/app-assets.mjs`, which runs as part of `pnpm build`. The file stays committed,
so an asset change remains visible in a diff; nobody transcribes it by hand.

**The cache name is derived from the list, not declared beside it.** The generator
records a `revision` — a hash of the sorted asset paths — and the worker names its cache
`medigraph-assets-<revision>`. The revision changes exactly when the set of cached files
changes, which is the condition under which the previous cache must be evicted. The
manual `version` integer is withdrawn.

**Withdrawn from Task 3.7:** _"no build step generates or mutates it"_, and the
description of the list as manually reviewed.

**Retained unchanged, and load-bearing:**

- `public/sw.js` stays hand-written. The policy is the part worth reading, and no
  generator writes any of it.
- Cache-first, exact-path, same-origin, `GET` only. An unlisted request receives no
  `respondWith` at all, so the browser behaves as though nothing were installed.
- No push, background or periodic sync, notification or message handler, and no
  `importScripts`.
- Every cache name begins `medigraph-`, so `clearAll` in `storage.ts` reaches a name
  written by a build it has never heard of.
- `serviceWorker.test.ts` keeps its job. Generating the list does not make it
  self-evidently correct: the tests still assert that every listed path exists in
  `dist/`, that every `_astro` asset the shell references is listed, that the runtime
  paths are present, and that the worker declines everything unlisted.

## Alternatives considered

- **Keep the manual list.** Rejected. It buys the appearance of review over an artifact
  that cannot be reviewed on its merits, and pays for it with per-commit transcription
  and a correctness property (`version`) that depends on memory.
- **Workbox, via `@vite-pwa/astro`.** Rejected. Its value is concentrated in runtime
  caching strategies, navigation fallback, background sync and expiration plugins —
  every one of which this application forbids. What remains after removing them is the
  precache slice, which is the 55 lines already written. Importing a toolkit to use a
  tenth of it adds dependency surface and bundle weight against Task 5.3's budget, and
  moves the caching policy into generated code, which is the one part that should stay
  hand-written.
- **Workbox `injectManifest`.** The closest alternative: keep the hand-written worker and
  let Workbox inject only the file list. Rejected because it is a dependency for
  something a fifteen-line script does, and the script has no upgrade treadmill.
- **Generate into `dist/` only, and stop committing the file.** Rejected. The committed
  file is what makes an asset change visible in review, and it keeps the manifest tests
  runnable without a prior build.

## Consequences

`pnpm build` now writes a tracked file. It writes identical bytes when nothing changed,
so a clean tree stays clean; when assets do change, the diff shows it and is committed
with the change that caused it. A contributor who edits the island and does not rebuild
gets the same failure they get today, from the same test.

The cache name now changes on every asset change rather than on every remembered bump.
Correctly, this evicts more often than the manual scheme did — a build that alters one
hashed file re-fetches the whole listed set on next activation. That is a small,
bounded cost on a static app of this size, and it is the direction to err in: serving a
stale shell is a user-visible fault, re-downloading a few hundred kilobytes is not.

Nothing about egress, origins or the CSP moves. The worker still reaches no origin but
its own, and `connect-src 'self'` still says so where a browser enforces it.

If a future change needs runtime caching — a strategy, a fallback, an expiring entry —
that is a change to the policy, not to the list, and it supersedes this record rather
than extending the generator.
