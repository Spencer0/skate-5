import { Clip, Edit, FPS, MAX_CLIPS, MAX_LIBRARY_SECONDS } from './clip';

/**
 * Clips live in IndexedDB: localStorage caps out around 5 MB and only holds
 * strings, while a minute of footage is close to a megabyte of floats.
 */

const DB = 'skate5.studio';
const CLIPS = 'clips';
const KV = 'kv';

let opening: Promise<IDBDatabase> | null = null;
function db() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(CLIPS, { keyPath: 'id' });
      r.result.createObjectStore(KV);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      opening = null;
      reject(r.error);
    };
  });
  return opening;
}

function req<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const r = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(r.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** Seconds of footage left before the library is full. */
export function roomLeft(clips: { frames: number }[]) {
  if (clips.length >= MAX_CLIPS) return 0;
  return Math.max(0, MAX_LIBRARY_SECONDS - clips.reduce((n, c) => n + c.frames / FPS, 0));
}

export const listClips = () => req<Clip[]>(CLIPS, 'readonly', (s) => s.getAll()).then((cs) => cs.sort((a, b) => b.created - a.created));
export const putClip = (c: Clip) => req<IDBValidKey>(CLIPS, 'readwrite', (s) => s.put(c));
export const deleteClip = (id: string) => req<undefined>(CLIPS, 'readwrite', (s) => s.delete(id));
export const loadEdit = () => req<Edit | undefined>(KV, 'readonly', (s) => s.get('edit'));
export const saveEdit = (e: Edit) => req<IDBValidKey>(KV, 'readwrite', (s) => s.put(e, 'edit'));
