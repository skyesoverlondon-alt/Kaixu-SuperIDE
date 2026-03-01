/*
  db.js — IndexedDB wrapper for kAIxU Super IDE
  Loaded before everything else. Exposes global functions used by all modules.
*/

const DB_NAME = 'kaixu-workspace';
const DB_VERSION = 3;
var db; // global — shared across all modules

function _storeExists(storeName) {
  return !!(db && db.objectStoreNames && db.objectStoreNames.contains(storeName));
}

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('files'))
        d.createObjectStore('files', { keyPath: 'path' });
      if (!d.objectStoreNames.contains('commits'))
        d.createObjectStore('commits', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('meta'))
        d.createObjectStore('meta', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('settings'))
        d.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!_storeExists(storeName)) {
      if (key === undefined) {
        const tx = db.transaction('meta', 'readonly');
        const req = tx.objectStore('meta').get(storeName);
        req.onsuccess = () => {
          const rec = req.result || null;
          resolve(rec ? (rec.value ?? null) : null);
        };
        req.onerror = () => reject(req.error);
        return;
      }
      resolve(null);
      return;
    }
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    if (!_storeExists(storeName)) {
      const tx = db.transaction('meta', 'readwrite');
      const req = tx.objectStore('meta').put({ key: storeName, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      return;
    }
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDel(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!_storeExists(storeName)) {
      const tx = db.transaction('meta', 'readwrite');
      const req = tx.objectStore('meta').delete(storeName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      return;
    }
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbAll(storeName) {
  return new Promise((resolve, reject) => {
    if (!_storeExists(storeName)) {
      resolve([]);
      return;
    }
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// File helpers
async function listFiles() { return idbAll('files'); }
async function readFile(path) {
  const rec = await idbGet('files', path);
  return rec ? (rec.content || '') : '';
}
async function writeFile(path, content) {
  await idbPut('files', { path, content: String(content ?? '') });
}
async function renameFile(oldPath, newPath) {
  const content = await readFile(oldPath);
  await writeFile(newPath, content);
  await deleteFile(oldPath);
}
async function duplicateFile(path) {
  const content = await readFile(path);
  const dot = path.lastIndexOf('.');
  const base = dot >= 0 ? path.slice(0, dot) : path;
  const ext  = dot >= 0 ? path.slice(dot) : '';
  let candidate = `${base} copy${ext}`;
  let n = 2;
  while ((await idbGet('files', candidate)) !== null) candidate = `${base} copy ${n++}${ext}`;
  await writeFile(candidate, content);
  return candidate;
}
async function deleteFile(path) { await idbDel('files', path); }

// Meta helpers
async function getMeta(key, fallback = null) {
  const rec = await idbGet('meta', key);
  return rec ? rec.value : fallback;
}
async function setMeta(key, value) { await idbPut('meta', { key, value }); }

// Settings helpers
async function loadSettings() {
  const rec = await idbGet('settings', 'ide');
  return rec ? rec.value : {};
}
async function saveSettings(obj) { await idbPut('settings', { key: 'ide', value: obj }); }
