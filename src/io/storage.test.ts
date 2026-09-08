// `idb` needs the whole IndexedDB surface — IDBRequest, IDBTransaction and the
// rest — not only the factory, so the globals are installed once here and each
// test then swaps in a fresh factory for isolation.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectedAt, Measurement, Profile, Report } from '../domain/types';
import {
  clearAll,
  loadProfile,
  replaceProfile,
  requestStoragePersistence,
  saveProfile,
} from './storage';

const DAY: CollectedAt = { date: '2025-05-14', time: null, precision: 'day' };
const OTHER: CollectedAt = { date: '2025-01-10', time: null, precision: 'day' };

function measurement(markerKey: string, overrides: Partial<Measurement> = {}): Measurement {
  return {
    markerKey,
    status: 'value',
    value: 1,
    comparator: null,
    textValue: null,
    unit: 'mg/dL',
    referenceRange: null,
    categoricalReference: null,
    sourceOrder: 0,
    ...overrides,
  };
}

function report(id: string, collectedAt: CollectedAt = DAY): Report {
  return { id, collectedAt, measurements: [measurement('glucose')] };
}

function profile(reports: Report[], id = 'profile-1'): Profile {
  return { schemaVersion: 1, id, reports };
}

/** A CacheStorage that only remembers names, which is all `clearAll` reads. */
function fakeCaches(names: string[]): CacheStorage {
  const held = new Set(names);

  return {
    keys: () => Promise.resolve([...held]),
    delete: (name: string) => Promise.resolve(held.delete(name)),
    has: (name: string) => Promise.resolve(held.has(name)),
    open: () => Promise.reject(new Error('not needed')),
    match: () => Promise.resolve(undefined),
  } as Partial<CacheStorage> as CacheStorage;
}

/** Reach past the exported API to plant something the writers would refuse. */
async function plant(value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('medigraph', 1);
    request.onupgradeneeded = (): void => {
      request.result.createObjectStore('profile');
    };
    request.onsuccess = (): void => {
      const db = request.result;
      const transaction = db.transaction('profile', 'readwrite');
      transaction.objectStore('profile').put(value, 'current');
      transaction.oncomplete = (): void => {
        db.close();
        resolve();
      };
      transaction.onerror = (): void => {
        reject(new Error('could not plant'));
      };
    };
    request.onerror = (): void => {
      reject(new Error('could not open'));
    };
  });
}

beforeEach(() => {
  // A fresh factory per test: IndexedDB is global state, and a test that
  // inherited another's database would pass for the wrong reason.
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveProfile and loadProfile', () => {
  it('reads back exactly what was written', async () => {
    const stored = profile([report('r1'), report('r2', OTHER)]);
    await saveProfile(stored);

    expect(await loadProfile()).toEqual(stored);
  });

  it('reports empty storage as null, not as an empty Profile', async () => {
    // A user with no history and a user whose history is empty are different
    // people, and only one of them should be offered Import.
    expect(await loadProfile()).toBeNull();
  });

  it('keeps exactly one Profile, however many times it is saved', async () => {
    await saveProfile(profile([report('r1')]));
    await saveProfile(profile([report('r2', OTHER)], 'profile-2'));

    const loaded = await loadProfile();

    expect(loaded?.id).toBe('profile-2');
    expect(loaded?.reports.map((each) => each.id)).toEqual(['r2']);
  });

  it('refuses to write a Profile the schema would reject', async () => {
    // The database must never come to hold a shape this app would later
    // refuse to read.
    const broken = profile([report('r1'), report('r2')]);

    await expect(saveProfile(broken)).rejects.toThrow(/invalid-profile/u);
    expect(await loadProfile()).toBeNull();
  });

  it('leaves the stored Profile untouched when a later save is refused', async () => {
    const good = profile([report('r1')]);
    await saveProfile(good);

    await expect(saveProfile(profile([report('a'), report('b')]))).rejects.toThrow();

    expect(await loadProfile()).toEqual(good);
  });

  it('refuses to read a stored value that is no longer a valid Profile', async () => {
    // A downgrade or a tampered database. Returning null would say "empty
    // storage", the app would offer to start fresh, and the next save would
    // overwrite a history nobody knew was there.
    await plant({ schemaVersion: 1, id: 'profile-1', reports: [{ id: 'r1' }] });

    await expect(loadProfile()).rejects.toThrow(/invalid-profile/u);
  });
});

describe('replaceProfile', () => {
  it('adopts the imported Profile in place of the stored one', async () => {
    await saveProfile(profile([report('r1')]));
    await replaceProfile(profile([report('r9', OTHER)], 'imported'));

    const loaded = await loadProfile();

    expect(loaded?.id).toBe('imported');
    expect(loaded?.reports.map((each) => each.id)).toEqual(['r9']);
  });

  it('leaves the old Profile intact when the replacement is refused', async () => {
    // The user either has their previous history or the new one, never
    // neither.
    const original = profile([report('r1')]);
    await saveProfile(original);

    await expect(replaceProfile(profile([report('a'), report('b')]))).rejects.toThrow();

    expect(await loadProfile()).toEqual(original);
  });

  it('works against empty storage', async () => {
    const imported = profile([report('r1')], 'imported');
    await replaceProfile(imported);

    expect(await loadProfile()).toEqual(imported);
  });
});

describe('requestStoragePersistence', () => {
  it('returns the browser’s answer when it grants', async () => {
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.resolve(true) } });

    expect(await requestStoragePersistence()).toBe(true);
  });

  it('returns the browser’s answer when it refuses', async () => {
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.resolve(false) } });

    expect(await requestStoragePersistence()).toBe(false);
  });

  it('returns null where the API does not exist', async () => {
    // Null is "nobody asked", which the UI shows differently from a refusal:
    // a denied user needs the export nudge, an unasked one was denied nothing.
    vi.stubGlobal('navigator', {});

    expect(await requestStoragePersistence()).toBeNull();
  });

  it('returns null when the request itself throws', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persist: () => {
          throw new Error('denied by policy');
        },
      },
    });

    expect(await requestStoragePersistence()).toBeNull();
  });

  it('is asked once, before the first save', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', { storage: { persist } });

    await saveProfile(profile([report('r1')]));
    await saveProfile(profile([report('r2', OTHER)]));

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('never lets a refusal block a save', async () => {
    // Declining to store a history because it might one day be evicted is
    // worse than storing one that might be.
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.resolve(false) } });

    const stored = profile([report('r1')]);
    await saveProfile(stored);

    expect(await loadProfile()).toEqual(stored);
  });

  it('never lets a missing API block a save', async () => {
    vi.stubGlobal('navigator', {});

    const stored = profile([report('r1')]);
    await saveProfile(stored);

    expect(await loadProfile()).toEqual(stored);
  });
});

describe('clearAll', () => {
  it('removes the stored Profile', async () => {
    await saveProfile(profile([report('r1')]));
    await clearAll();

    expect(await loadProfile()).toBeNull();
  });

  it('removes every Medigraph cache, including versions it never wrote', async () => {
    // A cache written by an older service worker outlives the build that made
    // it, and "delete everything from this device" that left one behind would
    // be a lie.
    const caches = fakeCaches(['medigraph-assets-v1', 'medigraph-assets-v2', 'medigraph-pdf']);
    vi.stubGlobal('caches', caches);

    await clearAll();

    expect(await caches.keys()).toEqual([]);
  });

  it('leaves another origin’s caches alone', async () => {
    const caches = fakeCaches(['medigraph-assets-v1', 'someone-elses-cache']);
    vi.stubGlobal('caches', caches);

    await clearAll();

    expect(await caches.keys()).toEqual(['someone-elses-cache']);
  });

  it('succeeds where Cache Storage does not exist', async () => {
    vi.stubGlobal('caches', undefined);

    await expect(clearAll()).resolves.toBeUndefined();
  });

  it('leaves storage usable afterwards', async () => {
    await saveProfile(profile([report('r1')]));
    await clearAll();

    const fresh = profile([report('r2', OTHER)], 'profile-2');
    await saveProfile(fresh);

    expect(await loadProfile()).toEqual(fresh);
  });
});

describe('a database that exists without this module’s store', () => {
  it('is repaired rather than fatal', async () => {
    // Reachable in a real browser: a "delete everything" that races an open,
    // or anything opening this name with no version, leaves the database at a
    // current version with no object stores. Every later read and write throws
    // `NotFoundError`, and no amount of reopening fixes it.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('medigraph');
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => {
        reject(new Error('open failed'));
      };
    });

    const profile: Profile = { schemaVersion: 1, id: 'p-repair', reports: [] };
    await replaceProfile(profile);

    expect(await loadProfile()).toEqual(profile);
  });
});
