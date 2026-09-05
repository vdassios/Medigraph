import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const MANIFEST = new URL('public/app-assets.json', ROOT);
const WORKER = new URL('public/sw.js', ROOT);
const DIST = new URL('dist/', ROOT);

interface Manifest {
  revision: string;
  assets: string[];
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
}

/** Where a served path lives in a static build. A directory serves its index. */
function built(path: string): string {
  const relative = path.endsWith('/') ? `${path}index.html` : path;
  return fileURLToPath(new URL(relative.slice(1), DIST));
}

const HAS_BUILD = existsSync(fileURLToPath(new URL('index.html', DIST)));

// --------------------------------------------------------------------------
// A service worker global, small enough to be obviously honest.
// --------------------------------------------------------------------------

interface FakeEvent {
  request: Request;
  waited: Promise<unknown>[];
  responded: Promise<Response>[];
}

interface Harness {
  install: () => Promise<void>;
  activate: () => Promise<void>;
  fetch: (request: Request) => Promise<Response | null>;
  cacheNames: () => string[];
  cached: (name: string) => string[];
  fetched: string[];
}

/**
 * Run `public/sw.js` against a stub global.
 *
 * The worker is plain script, not a module, and it registers its listeners at
 * evaluation. Driving it here is the only way to assert what it does *not* do
 * — an unlisted request has to be observed passing through untouched, and no
 * static reading of the file proves that.
 */
function harness(
  options: { caches?: Record<string, string[]>; manifestOk?: boolean } = {},
): Harness {
  const store = new Map<string, Set<string>>(
    Object.entries(options.caches ?? {}).map(([name, paths]) => [name, new Set(paths)]),
  );
  const listeners = new Map<string, (event: FakeEvent) => void>();
  const fetched: string[] = [];
  const source = readFileSync(WORKER, 'utf8');

  const cacheApi = {
    open: (name: string) =>
      Promise.resolve({
        addAll: (paths: string[]) => {
          store.set(name, new Set([...(store.get(name) ?? []), ...paths]));
          return Promise.resolve();
        },
      }),
    keys: () => Promise.resolve([...store.keys()]),
    delete: (name: string) => Promise.resolve(store.delete(name)),
    match: (path: string) => {
      for (const paths of store.values()) {
        if (paths.has(path)) {
          return Promise.resolve(new Response(`cached:${path}`));
        }
      }
      return Promise.resolve(undefined);
    },
  };

  const scope = {
    location: { origin: 'https://medigraph.test' },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    addEventListener: (name: string, handler: (event: FakeEvent) => void) => {
      listeners.set(name, handler);
    },
  };

  const context = vm.createContext({
    self: scope,
    caches: cacheApi,
    URL,
    Response,
    Request,
    fetch: (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.url;
      fetched.push(url);
      if (url === '/app-assets.json') {
        return options.manifestOk === false
          ? Promise.resolve(new Response('', { status: 404 }))
          : Promise.resolve(new Response(readFileSync(MANIFEST, 'utf8')));
      }
      return Promise.resolve(new Response(`network:${url}`));
    },
  });

  vm.runInContext(source, context);

  const dispatch = async (name: string, request?: Request): Promise<FakeEvent> => {
    const event: FakeEvent = {
      request: request ?? new Request('https://medigraph.test/'),
      waited: [],
      responded: [],
    };
    Object.assign(event, {
      waitUntil: (promise: Promise<unknown>) => event.waited.push(promise),
      respondWith: (promise: Promise<Response>) => event.responded.push(promise),
    });

    listeners.get(name)?.(event);
    await Promise.all(event.waited);
    return event;
  };

  return {
    install: async () => {
      await dispatch('install');
    },
    activate: async () => {
      await dispatch('activate');
    },
    fetch: async (request) => {
      const event = await dispatch('fetch', request);
      const [answer] = event.responded;
      return answer === undefined ? null : await answer;
    },
    cacheNames: () => [...store.keys()],
    cached: (name) => [...(store.get(name) ?? [])],
    fetched,
  };
}

// --------------------------------------------------------------------------

describe('app-assets.json', () => {
  it('names this exact set of files with a derived revision (ADR-0017)', () => {
    // The cache is named for the revision, so it must change precisely when
    // the cached set does: the shell paths are not content-hashed, and a cache
    // carried across builds would serve yesterday's HTML forever.
    const listed = manifest();

    expect(listed.revision).toMatch(/^[0-9a-f]{12}$/u);
    expect(listed.assets.length).toBeGreaterThan(0);
  });

  it('is generated by the build, not transcribed by hand', () => {
    // Re-run the generator's own hash over the committed list. A file edited
    // by hand, or left behind by a build nobody re-ran, disagrees here.
    const listed = manifest();
    const expected = createHash('sha256')
      .update(listed.assets.join('\n'))
      .digest('hex')
      .slice(0, 12);

    expect(listed.revision).toBe(expected);
  });

  it('lists only same-origin absolute paths', () => {
    for (const path of manifest().assets) {
      expect(path.startsWith('/')).toBe(true);
      expect(path.startsWith('//')).toBe(false);
    }
  });

  it('lists no path twice', () => {
    const { assets } = manifest();

    expect(new Set(assets).size).toBe(assets.length);
  });

  it('lists every path the app needs at runtime', () => {
    // A missing entry here is an app that stops working offline, which is the
    // failure this list exists to prevent.
    const { assets } = manifest();

    expect(assets).toContain('/app/');
    expect(assets).toContain('/pdf/pdf.worker.min.mjs');
    expect(assets.some((path) => path.endsWith('.js'))).toBe(true);
    expect(assets.some((path) => path.endsWith('.css'))).toBe(true);
  });

  it('caches nothing that could carry user data', () => {
    // Never a blob or data URL, never a source document, never a navigation
    // with user data in it. Every listed path is a static app file.
    for (const path of manifest().assets) {
      expect(path).not.toMatch(/^(?:blob|data):/u);
      expect(path).not.toMatch(/\.(?:pdf|medigraph)$/u);
      expect(path).not.toContain('?');
    }
  });

  it('caches neither itself nor the worker that reads it', () => {
    // The worker fetches this list fresh on every start to learn what to hold.
    // A cached copy would pin it to whichever build it first met.
    const { assets } = manifest();

    expect(assets).not.toContain('/app-assets.json');
    expect(assets).not.toContain('/sw.js');
    expect(assets).not.toContain('/_headers');
  });

  it.runIf(HAS_BUILD)('lists nothing that a production build does not contain', () => {
    // `pnpm build` first. A stale hash here is a worker that fails to install.
    for (const path of manifest().assets) {
      expect(existsSync(built(path)), `${path} is not in dist/`).toBe(true);
    }
  });

  it.runIf(HAS_BUILD)('lists every hashed asset the build emitted', () => {
    const { assets } = manifest();
    const emitted = readFileSync(built('/app/'), 'utf8');

    for (const match of emitted.matchAll(/["'(](\/_astro\/[^"')]+)["')]/gu)) {
      expect(assets, `${String(match[1])} is served but unlisted`).toContain(match[1]);
    }
  });
});

/** The worker's code, with its prose removed — comments describe, they do not run. */
function code(): string {
  return readFileSync(WORKER, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

describe('sw.js', () => {
  describe('what it will not do', () => {
    it('registers no push, sync or notification handler', () => {
      for (const forbidden of ['push', 'sync', 'periodicsync', 'notificationclick', 'message']) {
        expect(code(), `sw.js listens for ${forbidden}`).not.toContain(`'${forbidden}'`);
      }
    });

    it('never imports anything at runtime', () => {
      expect(code()).not.toContain('importScripts');
    });

    it('reaches no origin but its own', () => {
      expect(code()).not.toMatch(/https?:\/\//u);
    });
  });

  describe('install', () => {
    it('caches exactly the listed paths, under a versioned name', () => {
      const worker = harness();

      return worker.install().then(() => {
        expect(worker.cacheNames()).toEqual([`medigraph-assets-${manifest().revision}`]);
        expect(worker.cached(worker.cacheNames()[0] ?? '')).toEqual(manifest().assets);
      });
    });

    it('names its cache under the prefix clearAll deletes by', async () => {
      // `storage.ts` removes Medigraph caches by this prefix, including names
      // written by builds it has never heard of.
      const worker = harness();
      await worker.install();

      expect(worker.cacheNames().every((name) => name.startsWith('medigraph-'))).toBe(true);
    });
  });

  describe('activate', () => {
    it('deletes an older Medigraph asset cache', async () => {
      const worker = harness({ caches: { 'medigraph-assets-000000000000': ['/', '/old.js'] } });
      await worker.install();
      await worker.activate();

      expect(worker.cacheNames()).toEqual([`medigraph-assets-${manifest().revision}`]);
    });

    it('leaves a cache belonging to something else alone', async () => {
      const worker = harness({ caches: { 'someone-elses-cache': ['/x'] } });
      await worker.install();
      await worker.activate();

      expect(worker.cacheNames()).toContain('someone-elses-cache');
    });
  });

  describe('fetch', () => {
    it('answers a listed path from the cache', async () => {
      const worker = harness();
      await worker.install();

      const answer = await worker.fetch(new Request('https://medigraph.test/app/'));

      expect(await answer?.text()).toBe('cached:/app/');
    });

    it('works offline for a listed path after the first visit', async () => {
      const worker = harness();
      await worker.install();
      await worker.activate();

      for (const path of manifest().assets) {
        const answer = await worker.fetch(new Request(`https://medigraph.test${path}`));
        expect(await answer?.text(), `${path} was not served from the cache`).toBe(
          `cached:${path}`,
        );
      }
    });

    it('does not answer for an unlisted path', async () => {
      // No `respondWith` at all, so the browser does exactly what it would
      // have done with no worker installed.
      const worker = harness();
      await worker.install();

      expect(await worker.fetch(new Request('https://medigraph.test/anything.js'))).toBeNull();
    });

    it('does not answer for another origin', async () => {
      const worker = harness();
      await worker.install();

      expect(await worker.fetch(new Request('https://example.com/app/'))).toBeNull();
    });

    it('does not answer a request that is not a GET', async () => {
      const worker = harness();
      await worker.install();

      const posted = new Request('https://medigraph.test/app/', { method: 'POST' });

      expect(await worker.fetch(posted)).toBeNull();
    });

    it('adds nothing to the cache that it was not told to hold', async () => {
      const worker = harness();
      await worker.install();

      await worker.fetch(new Request('https://medigraph.test/anything.js'));
      await worker.fetch(new Request('https://medigraph.test/app/'));

      expect(worker.cached(worker.cacheNames()[0] ?? '')).toEqual(manifest().assets);
    });

    it('behaves as if absent until its list has loaded', async () => {
      // A restarted worker re-evaluates its script without installing again.
      // Passing requests through is the right failure for that window.
      const worker = harness({ manifestOk: false });

      expect(await worker.fetch(new Request('https://medigraph.test/app/'))).toBeNull();
    });
  });
});
