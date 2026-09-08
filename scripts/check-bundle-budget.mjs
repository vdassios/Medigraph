import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';

/**
 * The bundle budget for the app route (Task 5.3).
 *
 * What is measured is what a browser must download before the app is usable:
 * every script the `/app/` document names, plus everything those modules
 * statically import. A dynamic import is not in that set — it is the point of
 * being dynamic — so the pdf.js chunk is expected to be absent here and its
 * absence is asserted rather than assumed.
 *
 * Gzip, because that is what a static host serves and therefore what a user
 * actually waits for. The numbers are printed either way: a budget nobody can
 * see the slack in is a budget people learn to fear rather than use.
 *
 * Run by `pnpm build && node scripts/check-bundle-budget.mjs`. Exits non-zero
 * over budget, or if a lazy chunk has leaked into the initial set.
 */

const ROOT = new URL('../', import.meta.url);
const DIST = new URL('dist/', ROOT);

/** ≤150 KB gzip of JavaScript, before anything is attached. */
const BUDGET_BYTES = 150 * 1024;

/** Bytes that must never be in the initial set: they are fetched on their path. */
const LAZY = [/pdf/u];

function read(path) {
  return readFileSync(new URL(path.replace(/^\//u, ''), DIST));
}

/** Every module path the entry pulls in statically, transitively. */
function staticGraph(entry) {
  const seen = new Set();
  const queue = [entry];

  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || seen.has(path)) {
      continue;
    }
    seen.add(path);

    const source = read(path).toString('utf8');
    // Static `import ... from "./x.js"` and `export ... from "./x.js"` only.
    // A dynamic `import("./x.js")` is deliberately not matched: it is a
    // separate request, made when the path that needs it runs.
    for (const match of source.matchAll(
      /\b(?:import|export)\s*(?:[^;'"]*?\bfrom\s*)?["']([^"']+)["']/gu,
    )) {
      const specifier = match[1];
      if (specifier.startsWith('/') || specifier.startsWith('.')) {
        // Served paths, resolved as the browser would: relative to the module
        // that named them, rooted at the site's root.
        queue.push(
          specifier.startsWith('/') ? specifier : posix.join(posix.dirname(path), specifier),
        );
      }
    }
  }

  return [...seen];
}

/**
 * The modules the app document names.
 *
 * Astro boots an island from two inline `<script>` blocks that import the
 * runtime and the component by path, so there is no `src` attribute to read.
 * Every `_astro/*.js` the document mentions runs on load, which is exactly
 * what "initial" means here.
 */
function entryScripts() {
  const html = readFileSync(new URL('app/index.html', DIST), 'utf8');

  return [
    ...new Set([...html.matchAll(/_astro\/[A-Za-z0-9._-]+\.js/gu)].map((match) => `/${match[0]}`)),
  ];
}

const entries = entryScripts();
if (entries.length === 0) {
  console.error('no module scripts found in dist/app/index.html — did the build run?');
  process.exit(1);
}

const modules = [...new Set(entries.flatMap((entry) => staticGraph(entry)))].sort();
const measured = modules.map((path) => {
  const bytes = read(path);

  return { path, bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
});

const total = measured.reduce((sum, each) => sum + each.gzip, 0);
const leaked = measured.filter((each) => LAZY.some((pattern) => pattern.test(each.path)));

for (const each of measured) {
  console.log(
    `${each.path.padEnd(48)} ${String(each.bytes).padStart(8)} B  ${String(each.gzip).padStart(7)} B gzip`,
  );
}

const emitted = readdirSync(new URL('_astro/', DIST)).filter((name) => name.endsWith('.js'));
console.log(
  `\ninitial: ${String(measured.length)} of ${String(emitted.length)} emitted modules, ` +
    `${String(total)} B gzip of ${String(BUDGET_BYTES)} B budget ` +
    `(${String(Math.round((total / BUDGET_BYTES) * 100))}%)`,
);

if (leaked.length > 0) {
  console.error(
    `\nlazy bytes in the initial set: ${leaked.map((each) => each.path).join(', ')}\n` +
      'pdf.js is fetched on the path that reads a document, not on load.',
  );
  process.exit(1);
}

if (total > BUDGET_BYTES) {
  console.error(`\nover budget by ${String(total - BUDGET_BYTES)} B gzip`);
  process.exit(1);
}

// Kept honest about what it is: a budget on the initial download, not on the
// app's total weight. The lazy chunk is measured too, and only reported.
const lazyBytes = emitted
  .map((name) => `/_astro/${name}`)
  .filter((path) => !modules.includes(path))
  .map((path) => ({ path, gzip: gzipSync(read(path), { level: 9 }).length }));

for (const each of lazyBytes) {
  console.log(`lazy: ${each.path.padEnd(42)} ${String(each.gzip).padStart(7)} B gzip`);
}

console.log('bundle budget met');
