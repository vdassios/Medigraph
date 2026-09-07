import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

/**
 * Serve the production build under the headers the production host will send.
 *
 * Playwright's browser must meet the same Content-Security-Policy the deployed
 * app meets, or the end-to-end tests prove nothing about it: a slice that
 * passes with no CSP tells you the app works somewhere Medigraph is never
 * deployed. The headers are read from `dist/_headers` — the built artifact, not
 * the source under `public/` — so a build that failed to carry the policy fails
 * the tests rather than being quietly served without it.
 *
 * Static only. There is no API, no SSR and no fallback that invents a route
 * (D2): a request for a path the build did not emit is a 404, exactly as on
 * Cloudflare Pages.
 */

const ROOT = resolve(process.argv[2] ?? 'dist');
const PORT = Number(process.env.PORT ?? 4173);

/** Cloudflare Pages `_headers`: a path pattern, then indented `Name: value`. */
function headersFor(root) {
  const file = join(root, '_headers');
  if (!existsSync(file)) {
    throw new Error(`no _headers in ${root}: run pnpm build first`);
  }

  const headers = [];
  let matching = false;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trimStart().startsWith('#') || line.trim() === '') {
      continue;
    }
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      matching = line.trim() === '/*';
      continue;
    }
    const at = line.indexOf(':');
    if (matching && at > 0) {
      headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
    }
  }

  if (headers.length === 0) {
    throw new Error('dist/_headers carries no policy for /*');
  }

  return headers;
}

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.wasm', 'application/wasm'],
  ['.pdf', 'application/pdf'],
]);

/** The file a served path names, or undefined. Never escapes the build. */
function fileFor(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/u, '');
  const candidate = join(ROOT, clean);
  if (!candidate.startsWith(ROOT)) {
    return undefined;
  }

  for (const path of candidate.endsWith('/')
    ? [join(candidate, 'index.html')]
    : [candidate, join(candidate, 'index.html')]) {
    if (existsSync(path) && statSync(path).isFile()) {
      return path;
    }
  }

  return undefined;
}

const policy = headersFor(ROOT);

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
  const file = fileFor(pathname);

  for (const [name, value] of policy) {
    response.setHeader(name, value);
  }

  if (file === undefined) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': TYPES.get(extname(file)) ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`serving ${ROOT} on http://127.0.0.1:${String(PORT)}\n`);
});
