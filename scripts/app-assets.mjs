import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Write `public/app-assets.json` from a production build (ADR-0017).
 *
 * The service worker's **policy** is hand-written and stays that way — what is
 * cached, from where, whether an unlisted request is touched at all. This
 * script writes only the mechanical half: the list of files the build emitted.
 * Astro content-hashes every JS and CSS output, so those names change whenever
 * the island does, and transcribing them by hand is work with no judgement in
 * it and a wrong answer that fails the build.
 *
 * Run after `astro build`, as part of `pnpm build`. Writes identical bytes when
 * nothing changed, so a clean tree stays clean.
 */

const ROOT = new URL('../', import.meta.url);
const DIST = new URL('dist/', ROOT);
const OUTPUT = new URL('public/app-assets.json', ROOT);

/**
 * The shell pages, by served path.
 *
 * A static host serves `dist/app/index.html` at `/app/`, and the worker matches
 * on the served path, so that is what the list has to name.
 */
const SHELL = ['/', '/app/'];

/** Emitted files worth holding offline: the app's own code, styles and worker. */
const CACHEABLE = /\.(?:js|mjs|css)$/u;

/**
 * Files that exist in `dist/` and must never be cached.
 *
 * `_headers` is deployment configuration the host consumes, not a runtime
 * asset. `app-assets.json` is this list itself: the worker fetches it fresh on
 * every start to learn what to hold, and a cached copy of it would pin the
 * worker to whichever build it first met.
 */
const EXCLUDED = new Set(['/_headers', '/app-assets.json', '/sw.js']);

function walk(directory, prefix = '') {
  const found = [];

  for (const entry of readdirSync(new URL(directory, DIST), { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...walk(`${directory}${entry.name}/`, path));
    } else {
      found.push(path);
    }
  }

  return found;
}

function assets() {
  const emitted = walk('')
    .filter((path) => !EXCLUDED.has(path))
    .filter((path) => CACHEABLE.test(path) || path === '/pdf/pdf.worker.min.mjs')
    .sort();

  return [...SHELL, ...emitted];
}

/**
 * A name for this exact set of files.
 *
 * The worker's cache is named for it, so it changes precisely when the cached
 * set changes — which is the condition under which the previous cache has to be
 * evicted. The shell paths are not content-hashed, so a cache carried across
 * builds would serve yesterday's HTML indefinitely; deriving the name removes
 * the chance of anyone forgetting to say so.
 */
function revision(paths) {
  return createHash('sha256').update(paths.join('\n')).digest('hex').slice(0, 12);
}

const paths = assets();
const manifest = `${JSON.stringify({ revision: revision(paths), assets: paths }, null, 2)}\n`;

const before = (() => {
  try {
    return readFileSync(OUTPUT, 'utf8');
  } catch {
    return null;
  }
})();

if (before !== manifest) {
  writeFileSync(OUTPUT, manifest, 'utf8');
  // The built copy is written too: `astro build` already copied the previous
  // one out of `public/`, and leaving that stale would ship a list that
  // disagrees with the build beside it.
  writeFileSync(fileURLToPath(new URL('app-assets.json', DIST)), manifest, 'utf8');
  process.stdout.write(`app-assets.json updated: ${String(paths.length)} paths\n`);
} else {
  process.stdout.write(`app-assets.json unchanged: ${String(paths.length)} paths\n`);
}
