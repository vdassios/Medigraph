/**
 * Medigraph's service worker: an offline cache of this app's own files, and
 * nothing else.
 *
 * A service worker is privileged, persistent code that outlives the page which
 * registered it, so this one is written to be boring on purpose. It caches an
 * explicit, committed list of same-origin paths and answers only for those
 * exact paths. It never inspects a request, never learns, never caches what it
 * was not told about, and never touches anything carrying user data — no blob
 * or data URL, no source document, no arbitrary request URL. There is no push
 * handler, no background or periodic sync, and no dynamic `importScripts`.
 *
 * `app-assets.json` names the files to hold. The build writes it from its own
 * output (ADR-0017): the list is mechanical, and hand-copying content hashes is
 * work with no judgement in it. The **policy** — this file — stays hand-written,
 * because that is the part worth reading.
 *
 * D1: everything here is same-origin by construction. A path that is not on
 * the list falls through untouched, which is also what keeps a stale worker
 * harmless — it can serve an old asset of ours, never another origin.
 */

const MANIFEST = '/app-assets.json';

/**
 * Every cache name begins `medigraph-`.
 *
 * `clearAll` in `storage.ts` deletes Medigraph caches by that prefix and has
 * to reach a name written by a build it has never heard of: "delete everything
 * from this device" that left one behind would be a lie.
 */
const CACHE_PREFIX = 'medigraph-assets-';

/**
 * The list, held from the moment the script is evaluated.
 *
 * `assets` is deliberately readable **synchronously**. A `fetch` handler has to
 * decide whether to call `respondWith` before it can await anything, so a
 * worker that had to load its list first would have to intercept every request
 * in order to decide it wanted none of them. Until the list has loaded — the
 * window after a restarted worker re-evaluates — `assets` is null and the
 * worker behaves exactly as if it were not installed, which is the right
 * failure.
 */
let assets = null;

const ready = load();

// Attaching a handler here keeps a failed load from surfacing as an unhandled
// rejection in a worker nobody is watching. Anything that awaits `ready` still
// sees the failure — `install` and `activate` both do, and both should fail
// loudly when the list cannot be read.
ready.catch(() => undefined);

async function load() {
  const response = await fetch(MANIFEST, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`app-assets-unavailable: ${String(response.status)}`);
  }

  const parsed = await response.json();
  assets = parsed.assets;
  return parsed;
}

function cacheName(revision) {
  return `${CACHE_PREFIX}${String(revision)}`;
}

/**
 * Fill this build's cache.
 *
 * `addAll` is all-or-nothing: a list with one bad path leaves no half-filled
 * cache behind claiming to be complete.
 */
async function precache() {
  const parsed = await ready;
  const cache = await caches.open(cacheName(parsed.revision));
  await cache.addAll(parsed.assets);
  await self.skipWaiting();
}

/**
 * Take over, and delete every older Medigraph asset cache.
 *
 * The revision is a hash of the list, so it changes exactly when the cached set
 * changes — which is when the previous cache must go. The shell paths `/` and
 * `/app/` are not content-hashed, so a cache kept across builds would serve
 * yesterday's HTML forever, and deriving the name removes the chance of anyone
 * forgetting to say so. Taking over immediately matters too, because a worker
 * left running from an older build is a stale copy of privileged code.
 */
async function activate() {
  const parsed = await ready;
  const keep = cacheName(parsed.revision);

  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX) && name !== keep) {
      await caches.delete(name);
    }
  }

  await self.clients.claim();
}

/** Whether this exact request is one of the files we were told to hold. */
function isListed(request) {
  if (assets === null || request.method !== 'GET') {
    return false;
  }

  const url = new URL(request.url);
  return url.origin === self.location.origin && assets.includes(url.pathname);
}

/** Cache first, then the network. Nothing is ever added to the cache here. */
async function respond(request) {
  const cached = await caches.match(new URL(request.url).pathname, { ignoreSearch: true });
  return cached ?? fetch(request);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(activate());
});

self.addEventListener('fetch', (event) => {
  // No `respondWith` at all for anything unlisted: the browser then does
  // exactly what it would have done with no worker installed. That is the
  // whole policy — there is no heuristic here to get wrong, and nothing a
  // request can say that puts it in the cache.
  if (isListed(event.request)) {
    event.respondWith(respond(event.request));
  }
});
