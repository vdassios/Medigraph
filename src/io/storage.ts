import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import { validateProfile } from '../domain/types';
import type { Profile } from '../domain/types';

/**
 * The one thing this product keeps: a confirmed `Profile`, in plaintext
 * IndexedDB (D8).
 *
 * **What is stored, exhaustively.** One Profile, under one key, in one store.
 *
 * **Plaintext is disclosed, not hidden.** The privacy page names the risks this
 * implies — a shared device, an XSS, a browser backup or sync, eviction — and
 * this module makes no at-rest claim it cannot keep. Availability is
 * best-effort: a browser may evict this database, which is why export exists
 * and why the app nudges towards it.
 */

const DATABASE = 'medigraph';
const DATABASE_VERSION = 1;
const STORE = 'profile';

const KEY = 'current';

/**
 * The prefix every Medigraph Cache Storage entry carries.
 *
 * `clearAll` has to remove *every* one of them, including versions this build
 * has never heard of — a cache written by an older service worker outlives the
 * build that made it, and "delete everything from this device" that left one
 * behind would be a lie. A prefix is the only rule that covers a name written
 * in the future, so Task 3.7's versioned asset caches are named under it.
 */
const CACHE_PREFIX = 'medigraph-';

/**
 * Read a platform global through a call, because the DOM types promise more
 * than a runtime does.
 *
 * TypeScript declares `navigator` and `caches` as always present, so a direct
 * check on either reads as dead code to the compiler. They are genuinely
 * absent in Node, and absent in an older browser for `caches`, which is
 * exactly the case each caller has to answer for.
 */
function platform(): Record<string, unknown> {
  return globalThis;
}

function persisting(): (() => Promise<boolean>) | undefined {
  const storage = (platform().navigator as { storage?: { persist?: unknown } } | undefined)
    ?.storage;

  return typeof storage?.persist === 'function'
    ? (storage.persist.bind(storage) as () => Promise<boolean>)
    : undefined;
}

function caching(): CacheStorage | undefined {
  return platform().caches as CacheStorage | undefined;
}

function database(): Promise<IDBPDatabase> {
  return openDB(DATABASE, DATABASE_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    },
  });
}

/**
 * Ask the browser to exempt this origin from eviction.
 *
 * Returns the browser's answer, or `null` where the API does not exist —
 * `null` is "nobody asked", which the UI shows differently from a refusal,
 * because a user who was denied persistence needs the export nudge and a user
 * on a browser without the API has not been denied anything.
 *
 * A refusal never blocks a save. The alternative — declining to store a
 * history because it might one day be evicted — is worse than storing one that
 * might be.
 */
export async function requestStoragePersistence(): Promise<boolean | null> {
  const persist = persisting();
  if (persist === undefined) {
    return null;
  }

  try {
    return await persist();
  } catch {
    return null;
  }
}

/** Whether anything is stored yet, without validating what it is. */
async function isEmpty(db: IDBPDatabase): Promise<boolean> {
  return (await db.get(STORE, KEY)) === undefined;
}

/**
 * Write the confirmed Profile.
 *
 * Validated before it is written, so the database cannot come to hold a shape
 * this app would later refuse to read. The write is one transaction over one
 * key, which is what makes it atomic: an interrupted save leaves the previous
 * Profile exactly as it was rather than half of a new one.
 *
 * Persistence is requested once, before the first save, and its answer is
 * discarded here. Asking earlier would prompt a user who has stored nothing;
 * waiting for the answer would let a browser dialog stand between Confirm and
 * the only durable copy of the work.
 */
export async function saveProfile(profile: Profile): Promise<void> {
  const validated = validateProfile(profile);
  const db = await database();

  try {
    if (await isEmpty(db)) {
      await requestStoragePersistence();
    }

    await db.put(STORE, validated, KEY);
  } finally {
    db.close();
  }
}

/**
 * Read the stored Profile, or `null` when nothing is stored.
 *
 * What is read is validated again. Nothing but this module writes here and
 * both writers validate first, so a stored Profile that fails is a downgrade
 * or a tampered database — and in both cases **throwing beats returning
 * `null`**: `null` means "empty storage", the app would offer to start fresh,
 * and the next save would overwrite a history nobody knew was there.
 */
export async function loadProfile(): Promise<Profile | null> {
  const db = await database();

  try {
    const stored: unknown = await db.get(STORE, KEY);
    return stored === undefined ? null : validateProfile(stored);
  } finally {
    db.close();
  }
}

/**
 * Adopt an imported Profile in place of the stored one.
 *
 * Import's destructive branch. The clear and the write are one transaction, so
 * an interruption leaves the old Profile intact — the user either has their
 * previous history or the new one, never neither.
 */
export async function replaceProfile(profile: Profile): Promise<void> {
  const validated = validateProfile(profile);
  const db = await database();

  try {
    const transaction = db.transaction(STORE, 'readwrite');
    await transaction.store.clear();
    await transaction.store.put(validated, KEY);
    await transaction.done;
  } finally {
    db.close();
  }
}

/**
 * Delete everything this product stored on this device.
 *
 * The database and every Medigraph cache, whatever version wrote it. Live
 * resources — object URLs, bitmaps, the open review session — belong to
 * `MedigraphApp` and are disposed separately: this module never held them, and
 * claiming to release them would leave the real ones alive.
 */
export async function clearAll(): Promise<void> {
  await deleteDatabase();
  await deleteCaches();
}

async function deleteDatabase(): Promise<void> {
  const db = await database();
  db.close();

  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    // Resolve on every outcome, including `blocked`: another tab holding the
    // database open must not leave "delete everything" hanging with no answer.
    request.onsuccess = (): void => {
      resolve();
    };
    request.onerror = (): void => {
      resolve();
    };
    request.onblocked = (): void => {
      resolve();
    };
  });
}

async function deleteCaches(): Promise<void> {
  const storage = caching();
  if (storage === undefined) {
    return;
  }

  for (const name of await storage.keys()) {
    if (name.startsWith(CACHE_PREFIX)) {
      await storage.delete(name);
    }
  }
}
