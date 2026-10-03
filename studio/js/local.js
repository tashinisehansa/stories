// Local-first draft storage: IndexedDB (preferred) with a localStorage fallback.
// Every keystroke batch lands here first, so a refresh or lost Wi-Fi never loses writing.
const DB = 'story-studio';
const STORE = 'drafts';
const LS_PREFIX = 'story-studio:draft:';
const FEEDBACK = 'feedback';

let dbPromise;
function openDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('no indexedDB'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FEEDBACK)) db.createObjectStore(FEEDBACK, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn, store = STORE) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function getLocal(id) {
  try {
    return (await tx('readonly', (s) => s.get(id))) ?? null;
  } catch {
    try {
      return JSON.parse(localStorage.getItem(LS_PREFIX + id)) ?? null;
    } catch {
      return null;
    }
  }
}

export async function putLocal(rec) {
  const value = { ...rec, localSavedAt: new Date().toISOString() };
  try {
    await tx('readwrite', (s) => s.put(value));
  } catch {
    try {
      localStorage.setItem(LS_PREFIX + rec.id, JSON.stringify(value));
    } catch {
      return false;
    }
  }
  return true;
}

export async function allLocal() {
  try {
    return (await tx('readonly', (s) => s.getAll())) ?? [];
  } catch {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(LS_PREFIX)) out.push(JSON.parse(localStorage.getItem(k)));
      }
    } catch {
      /* ignore */
    }
    return out;
  }
}

export function newStoryId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `story-${d}${rand}`;
}

// Push any drafts that only exist (or are newer) on this device.
export async function syncDirty(putFn) {
  let synced = 0;
  for (const rec of await allLocal()) {
    if (!rec?.dirty) continue;
    try {
      const saved = await putFn(rec);
      await putLocal({ ...rec, dirty: false, baseRevision: saved.revision, updatedAt: saved.updatedAt });
      synced += 1;
    } catch {
      /* still offline; try again later */
    }
  }
  return synced;
}

// Feedback is also kept on this device so Tashini can read it without the studio.
export async function cacheFeedback(key, data) {
  try {
    await tx('readwrite', (s) => s.put({ key, data, savedAt: new Date().toISOString() }), FEEDBACK);
  } catch {
    /* best effort */
  }
}

export async function cachedFeedback(key) {
  try {
    return (await tx('readonly', (s) => s.get(key), FEEDBACK))?.data ?? null;
  } catch {
    return null;
  }
}
