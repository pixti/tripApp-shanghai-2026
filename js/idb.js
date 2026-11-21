// 아주 작은 IndexedDB 저장소 — 암호 키(CryptoKey)를 기기에 기억해 두는 용도
const DB = 'tripplanner';
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req && req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

export const get = key => tx('readonly', s => s.get(key));
export const set = (key, val) => tx('readwrite', s => s.put(val, key));
export const del = key => tx('readwrite', s => s.delete(key));
