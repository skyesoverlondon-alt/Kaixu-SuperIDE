/*
  kAIxU Super IDE

  Fortune-500 build principles for this repo:
  - No provider keys in client code
  - All AI edits route through kAIxU Gate via Netlify Functions
  - Auth + sync uses Neon (Postgres)
  - Local-first via IndexedDB for speed

  UI: Files + Chat Timeline + Local Source Control + Live Preview
*/

// -----------------------------
// Tiny helpers
// -----------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg) {
  // Minimal toast using alert fallback. Keep it simple and reliable.
  console.log('[toast]', msg);
}

// -----------------------------
// Global state
// -----------------------------

let db;
let editor;
let currentFile = null;
let selectedCommitId = null;
let selectedPaths = new Set();

let authToken = null;
let currentUser = null;
let currentWorkspaceId = null;
let chatMessages = []; // {role,text,operations?,checkpointCommitId?,applied?,id?,createdAt?}

const DB_NAME = 'kaixu-workspace';
const DB_VERSION = 2;

// -----------------------------
// IndexedDB (local-first)
// -----------------------------

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'path' });
      if (!d.objectStoreNames.contains('commits')) d.createObjectStore('commits', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

function idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDel(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Files
async function listFiles() {
  return await idbAll('files');
}

async function readFile(path) {
  const rec = await idbGet('files', path);
  return rec ? (rec.content || '') : '';
}

async function writeFile(path, content) {
  await idbPut('files', { path, content: String(content ?? '') });
}

async function deleteFile(path) {
  await idbDel('files', path);
}

// Meta
async function getMeta(key, fallback = null) {
  const rec = await idbGet('meta', key);
  return rec ? rec.value : fallback;
}

async function setMeta(key, value) {
  await idbPut('meta', { key, value });
}

// -----------------------------
// Editor
// -----------------------------

function initEditor() {
  const textarea = $('#editor');
  editor = {
    getValue: () => textarea.value,
    setValue: (v) => { textarea.value = v || ''; },
  };

  let t = null;
  textarea.addEventListener('input', () => {
    const previewOn = !$('#preview-section').classList.contains('hidden');
    const autoSaveOn = $('#autoSave')?.checked;
    clearTimeout(t);
    t = setTimeout(async () => {
      if (autoSaveOn && currentFile) {
        await writeFile(currentFile, editor.getValue());
        await refreshFileTree();
      }
      if (previewOn) await updatePreview();
    }, 400);
  });
}

// -----------------------------
// File tree + selection
// -----------------------------

function buildFileTree(files) {
  const root = {};
  files.forEach(({ path }) => {
    const parts = path.split('/');
    let node = root;
    parts.forEach((part, idx) => {
      if (!node[part]) node[part] = { __children: {} };
      if (idx === parts.length - 1) node[part].__file = path;
      node = node[part].__children;
    });
  });
  return root;
}

function renderFileTree(tree, container) {
  container.innerHTML = '';
  const ulRoot = document.createElement('ul');

  function renderNode(node, parentUl, depth = 0) {
    Object.keys(node).sort().forEach((key) => {
      const entry = node[key];
      const li = document.createElement('li');
      li.style.paddingLeft = `${depth * 10}px`;

      if (entry.__file) {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '8px';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedPaths.has(entry.__file);
        cb.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (cb.checked) selectedPaths.add(entry.__file);
          else selectedPaths.delete(entry.__file);
        });

        const name = document.createElement('span');
        name.textContent = key;
        wrap.appendChild(cb);
        wrap.appendChild(name);
        li.appendChild(wrap);
        li.dataset.path = entry.__file;

        li.addEventListener('click', () => selectFile(entry.__file));
      } else {
        li.textContent = key;
      }

      if (entry.__children && Object.keys(entry.__children).length) {
        const ul = document.createElement('ul');
        renderNode(entry.__children, ul, depth + 1);
        li.appendChild(ul);
      }

      parentUl.appendChild(li);
    });
  }

  renderNode(tree, ulRoot, 0);
  container.appendChild(ulRoot);
  highlightCurrentFile();
}

async function refreshFileTree() {
  const files = await listFiles();
  const tree = buildFileTree(files);
  renderFileTree(tree, $('#file-tree'));
}

function highlightCurrentFile() {
  $$('#file-tree li').forEach((li) => {
    li.classList.remove('selected');
    if (currentFile && li.dataset.path === currentFile) li.classList.add('selected');
  });
}

async function selectFile(path) {
  currentFile = path;
  const content = await readFile(path);
  editor.setValue(content);
  highlightCurrentFile();

  if (!$('#preview-section').classList.contains('hidden')) {
    await updatePreview();
  }
}

// -----------------------------
// Import/export
// -----------------------------

async function importFiles(fileList) {
  function uint8ToBase64(u8) {
    // Chunked conversion to avoid call stack limits
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  for (const f of fileList) {
    const name = (f.webkitRelativePath || f.name || '').trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (lower.endsWith('.zip')) {
      const buf = await f.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      for (const filename of Object.keys(zip.files)) {
        const entry = zip.files[filename];
        if (entry.dir) continue;
        // Assume text for common web files; otherwise store as base64
        const isText = /\.(html|htm|css|js|ts|json|md|txt|xml|svg)$/i.test(filename);
        if (isText) {
          const text = await entry.async('string');
          await writeFile(filename, text);
        } else {
          const bytes = await entry.async('uint8array');
          const b64 = uint8ToBase64(bytes);
          // store as data url-ish marker
          await writeFile(filename, `__b64__:${b64}`);
        }
      }
    } else {
      // Text default
      const isText = /^(text\/|application\/json)/i.test(f.type) || /\.(html|htm|css|js|ts|json|md|txt|xml|svg)$/i.test(name);
      if (isText) {
        await writeFile(name, await f.text());
      } else {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const b64 = uint8ToBase64(bytes);
        await writeFile(name, `__b64__:${b64}`);
      }
    }
  }
  await refreshFileTree();
}

async function exportWorkspaceZip() {
  const zip = new JSZip();
  const files = await listFiles();
  for (const f of files) {
    const content = f.content || '';
    if (content.startsWith('__b64__:')) {
      const b64 = content.slice('__b64__:'.length);
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      zip.file(f.path, bin);
    } else {
      zip.file(f.path, content);
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kaixu-workspace.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------
// Local commits
// -----------------------------

async function loadCommits() {
  const commits = await idbAll('commits');
  commits.sort((a, b) => (b.id || 0) - (a.id || 0));
  return commits;
}

async function refreshHistory() {
  const pane = $('#history-pane');
  const commits = await loadCommits();
  pane.innerHTML = '';
  commits.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'commit';
    row.textContent = `#${c.id} — ${c.message} (${new Date(c.time).toLocaleString()})`;
    row.addEventListener('click', () => {
      selectedCommitId = c.id;
      showCommitDetails(c);
    });
    pane.appendChild(row);
  });
}

function showCommitDetails(commit) {
  const pane = $('#history-pane');
  const detail = document.createElement('pre');
  detail.style.whiteSpace = 'pre-wrap';
  detail.style.background = 'rgba(255,255,255,.06)';
  detail.style.border = '1px solid rgba(255,255,255,.10)';
  detail.style.borderRadius = '12px';
  detail.style.padding = '10px';
  detail.textContent = '';
  Object.keys(commit.diff || {}).forEach((file) => {
    detail.textContent += `diff -- ${file}\n`;
    detail.textContent += (commit.diff[file] || '') + '\n\n';
  });
  pane.appendChild(detail);
}

async function commitWorkspace(message) {
  const files = await listFiles();
  const snapshot = files.map(({ path, content }) => ({ path, content }));

  const commits = await loadCommits();
  const lastSnapshot = commits[0]?.snapshot || [];
  const lastMap = {};
  lastSnapshot.forEach(({ path, content }) => { lastMap[path] = content; });

  function buildDiff(path, oldContent, newContent) {
    const oldLines = String(oldContent || '').split('\n');
    const newLines = String(newContent || '').split('\n');
    const lines = [];
    lines.push(`--- a/${path}`);
    lines.push(`+++ b/${path}`);
    lines.push('@@');
    oldLines.forEach((l) => lines.push('-' + l));
    newLines.forEach((l) => lines.push('+' + l));
    return lines.join('\n');
  }

  const diff = {};
  for (const { path, content } of snapshot) {
    const old = lastMap[path] || '';
    if (old !== content) diff[path] = buildDiff(path, old, content);
    delete lastMap[path];
  }
  for (const oldPath of Object.keys(lastMap)) {
    diff[oldPath] = buildDiff(oldPath, lastMap[oldPath], '');
  }

  const commit = { message: message || 'Snapshot', time: Date.now(), snapshot, diff };
  await idbPut('commits', commit);

  await refreshHistory();
  const commits2 = await loadCommits();
  return commits2[0];
}

async function revertToCommit(id) {
  const commit = await idbGet('commits', id);
  if (!commit) return;
  const files = await listFiles();
  for (const f of files) await deleteFile(f.path);
  for (const f of commit.snapshot || []) await writeFile(f.path, f.content || '');
  await refreshFileTree();
  await commitWorkspace(`Revert to #${id}`);
}

async function exportPatch(id) {
  const commit = await idbGet('commits', id);
  if (!commit) return;
  let patchText = '';
  Object.keys(commit.diff || {}).forEach((file) => {
    patchText += `diff --git a/${file} b/${file}\n`;
    patchText += (commit.diff[file] || '') + '\n';
  });
  const blob = new Blob([patchText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `commit-${id}.patch`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------
// Preview (service worker virtual server when possible)
// -----------------------------

let lastPreviewHTML = '';

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // SW not allowed
  try {
    await navigator.serviceWorker.register('sw.js');
  } catch (e) {
    console.warn('SW register failed', e);
  }
}

async function updatePreview() {
  const frame = $('#preview-frame');
  if (!frame) return;

  // If running on http(s) with SW, prefer virtual server preview
  const swReady = (location.protocol.startsWith('http') && navigator.serviceWorker && (navigator.serviceWorker.controller || (await navigator.serviceWorker.ready).active));
  if (swReady) {
    frame.src = `/virtual/index.html?ts=${Date.now()}`;
    return;
  }

  // Fallback: srcdoc with inline JS/CSS (works on file://)
  let indexContent = '';
  if (currentFile === 'index.html') indexContent = editor.getValue();
  else indexContent = await readFile('index.html');

  if (!indexContent) {
    frame.srcdoc = '<p style="padding:1rem;color:#ccc">No index.html found.</p>';
    return;
  }

  let html = indexContent;

  async function inlineScripts(inputHtml) {
    const scriptRegex = /<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/gi;
    let match;
    let resultHtml = inputHtml;
    const tasks = [];
    while ((match = scriptRegex.exec(inputHtml)) !== null) {
      const fullTag = match[0];
      const src = match[1];
      if (/^https?:\/\//i.test(src)) continue;
      const filePath = src.replace(/^\.\//, '');
      tasks.push((async () => {
        let content = (currentFile === filePath) ? editor.getValue() : await readFile(filePath);
        if (String(content).startsWith('__b64__:')) content = '';
        return { fullTag, replacement: `<script>${content || ''}<\/script>` };
      })());
    }
    const reps = await Promise.all(tasks);
    reps.forEach(({ fullTag, replacement }) => { resultHtml = resultHtml.replace(fullTag, replacement); });
    return resultHtml;
  }

  async function inlineStyles(inputHtml) {
    const linkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*href="([^"]+)"[^>]*>/gi;
    let match;
    let resultHtml = inputHtml;
    const tasks = [];
    while ((match = linkRegex.exec(inputHtml)) !== null) {
      const fullTag = match[0];
      const href = match[1];
      if (/^https?:\/\//i.test(href)) continue;
      const filePath = href.replace(/^\.\//, '');
      tasks.push((async () => {
        let content = (currentFile === filePath) ? editor.getValue() : await readFile(filePath);
        if (String(content).startsWith('__b64__:')) content = '';
        return { fullTag, replacement: `<style>${content || ''}<\/style>` };
      })());
    }
    const reps = await Promise.all(tasks);
    reps.forEach(({ fullTag, replacement }) => { resultHtml = resultHtml.replace(fullTag, replacement); });
    return resultHtml;
  }

  html = await inlineScripts(html);
  html = await inlineStyles(html);
  frame.srcdoc = html;
  lastPreviewHTML = html;
}

// -----------------------------
// Cloud sync (Neon)
// -----------------------------

async function api(path, { method = 'GET', body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : null });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function syncToCloud() {
  if (!authToken || !currentWorkspaceId) {
    alert('Sign in first to sync.');
    return;
  }
  const files = await listFiles();
  const obj = {};
  for (const f of files) obj[f.path] = f.content || '';
  await api(`/api/ws-save`, { method: 'POST', body: { id: currentWorkspaceId, files: obj } });
  toast('Synced');
}

async function loadWorkspaceFromCloud(workspaceId) {
  const data = await api(`/api/ws-get?id=${encodeURIComponent(workspaceId)}`);
  const ws = data.workspace;
  currentWorkspaceId = ws.id;
  // Replace local files with server files
  const existing = await listFiles();
  for (const f of existing) await deleteFile(f.path);
  const filesObj = ws.files || {};
  for (const p of Object.keys(filesObj)) {
    await writeFile(p, filesObj[p]);
  }
  await refreshFileTree();
}

// -----------------------------
// Auth
// -----------------------------

function setUserChip() {
  const chip = $('#userChip');
  if (!chip) return;
  if (currentUser?.email) chip.textContent = currentUser.email;
  else chip.textContent = 'Not signed in';

  const btn = $('#authBtn');
  if (btn) btn.textContent = currentUser?.email ? 'Sign out' : 'Sign in';
}

function saveAuthToken(t) {
  authToken = t;
  if (t) localStorage.setItem('KAIXU_AUTH_TOKEN', t);
  else localStorage.removeItem('KAIXU_AUTH_TOKEN');
}

async function tryRestoreSession() {
  const t = localStorage.getItem('KAIXU_AUTH_TOKEN');
  if (!t) return false;
  saveAuthToken(t);
  try {
    const me = await api('/api/auth-me');
    currentUser = me.user;
    setUserChip();
    const ws = me.workspaces?.[0];
    if (ws) await loadWorkspaceFromCloud(ws.id);
    await loadChatFromCloud();
    return true;
  } catch (e) {
    saveAuthToken(null);
    return false;
  }
}

function openAuthModal() {
  $('#authModal').classList.remove('hidden');
  $('#authStatus').textContent = '';
}

function closeAuthModal() {
  $('#authModal').classList.add('hidden');
}

async function submitNetlifySignup(email) {
  // Captures signups in Netlify Forms for audit/lead capture.
  const body = new URLSearchParams({ 'form-name': 'signup', email }).toString();
  try {
    await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  } catch {}
}

async function doSignup() {
  const email = String($('#signupEmail').value || '').trim();
  const password = String($('#signupPassword').value || '');
  $('#authStatus').textContent = 'Creating account…';
  await submitNetlifySignup(email);
  const res = await api('/api/auth-signup', { method: 'POST', body: { email, password } });
  saveAuthToken(res.token);
  currentUser = res.user;
  setUserChip();
  currentWorkspaceId = res.workspace?.id || null;
  if (currentWorkspaceId) await loadWorkspaceFromCloud(currentWorkspaceId);
  await loadChatFromCloud();
  $('#authStatus').textContent = 'Signed up.';
  await sleep(250);
  closeAuthModal();
}

async function doLogin() {
  const email = String($('#loginEmail').value || '').trim();
  const password = String($('#loginPassword').value || '');
  $('#authStatus').textContent = 'Logging in…';
  const res = await api('/api/auth-login', { method: 'POST', body: { email, password } });
  saveAuthToken(res.token);
  currentUser = res.user;
  setUserChip();
  // Fetch workspaces
  const me = await api('/api/auth-me');
  const ws = me.workspaces?.[0];
  if (ws) await loadWorkspaceFromCloud(ws.id);
  await loadChatFromCloud();
  $('#authStatus').textContent = 'Logged in.';
  await sleep(250);
  closeAuthModal();
}

// -----------------------------
// Chat Timeline + AI edits
// -----------------------------

function renderChat() {
  const el = $('#chatTimeline');
  el.innerHTML = '';

  chatMessages.forEach((m, idx) => {
    const div = document.createElement('div');
    div.className = `chatMsg ${m.role}`;

    const meta = document.createElement('div');
    meta.className = 'chatMeta';
    meta.innerHTML = `<span>${m.role.toUpperCase()}</span><span>${m.createdAt ? new Date(m.createdAt).toLocaleTimeString() : ''}</span>`;
    div.appendChild(meta);

    const body = document.createElement('div');
    body.textContent = m.text;
    div.appendChild(body);

    if (m.role === 'assistant') {
      const actions = document.createElement('div');
      actions.className = 'chatActions';

      const btnApply = document.createElement('button');
      btnApply.textContent = m.applied ? 'Applied' : 'Apply';
      btnApply.disabled = !!m.applied;
      btnApply.addEventListener('click', async () => {
        await applyChatEdits(idx);
      });

      const btnUndo = document.createElement('button');
      btnUndo.textContent = 'Undo';
      btnUndo.disabled = !m.applied || !m.checkpointCommitId;
      btnUndo.addEventListener('click', async () => {
        await undoChatEdits(idx);
      });

      actions.appendChild(btnApply);
      actions.appendChild(btnUndo);
      div.appendChild(actions);
    }

    el.appendChild(div);
  });

  el.scrollTop = el.scrollHeight;
}

async function loadChatFromCloud() {
  if (!authToken || !currentWorkspaceId) {
    chatMessages = [];
    renderChat();
    return;
  }
  const data = await api(`/api/chat-list?workspaceId=${encodeURIComponent(currentWorkspaceId)}&limit=300`);
  chatMessages = (data.messages || []).map((m) => ({
    role: m.role,
    text: m.text,
    operations: m.operations || null,
    checkpointCommitId: m.checkpointCommitId || null,
    createdAt: m.createdAt || null,
    applied: false,
    id: m.id
  }));
  renderChat();
}

async function appendChatToCloud(msg) {
  if (!authToken || !currentWorkspaceId) return;
  await api('/api/chat-append', {
    method: 'POST',
    body: {
      workspaceId: currentWorkspaceId,
      role: msg.role,
      text: msg.text,
      operations: msg.operations || null,
      checkpointCommitId: msg.checkpointCommitId || null
    }
  });
}

function looksDestructive(ops) {
  const destructive = ops.filter(op => op.type === 'delete' || op.type === 'rename');
  return destructive.length > 0 || ops.length >= 10;
}

async function applyOperations(ops) {
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const t = op.type;
    if (t === 'create' || t === 'update') {
      const p = String(op.path || '').replace(/^\/+/, '');
      await writeFile(p, String(op.content ?? ''));
    } else if (t === 'delete') {
      const p = String(op.path || '').replace(/^\/+/, '');
      await deleteFile(p);
    } else if (t === 'rename') {
      const from = String(op.from || '').replace(/^\/+/, '');
      const to = String(op.to || '').replace(/^\/+/, '');
      const content = await readFile(from);
      await writeFile(to, content);
      await deleteFile(from);
    }
  }
}

async function applyChatEdits(idx) {
  const msg = chatMessages[idx];
  if (!msg?.operations || msg.applied) return;

  const ops = msg.operations;
  if ($('#diff-safety').checked && looksDestructive(ops)) {
    const ok = confirm('This AI change includes delete/rename or many ops. Apply anyway?');
    if (!ok) return;
  }

  const checkpoint = await commitWorkspace('AI Checkpoint');
  msg.checkpointCommitId = checkpoint.id;

  await applyOperations(ops);
  await refreshFileTree();

  if ($('#commitAfterApply').checked) {
    await commitWorkspace(`AI: ${msg.text.slice(0, 80)}`);
  }

  msg.applied = true;
  renderChat();

  if (!$('#preview-section').classList.contains('hidden')) await updatePreview();
}

async function undoChatEdits(idx) {
  const msg = chatMessages[idx];
  if (!msg?.checkpointCommitId) return;
  await revertToCommit(msg.checkpointCommitId);
  msg.applied = false;
  renderChat();
  if (!$('#preview-section').classList.contains('hidden')) await updatePreview();
}

function buildAgentContext(scope) {
  // Construct a compact workspace payload for the server AI.
  // We include manifest + selected files (or active file).
  return (async () => {
    const files = await listFiles();
    const map = new Map(files.map(f => [f.path, f.content || '']));
    if (currentFile) map.set(currentFile, editor.getValue() || '');

    let includePaths = [];
    if (scope === 'active') {
      includePaths = currentFile ? [currentFile] : ['index.html'];
    } else if (scope === 'selected') {
      includePaths = Array.from(selectedPaths);
      if (includePaths.length === 0 && currentFile) includePaths = [currentFile];
    } else {
      includePaths = Array.from(map.keys());
    }

    includePaths = includePaths.filter(p => map.has(p));

    const manifest = Array.from(map.keys()).sort().map(p => ({ path: p, bytes: String(map.get(p) || '').length }));
    let blob = `ACTIVE_FILE: ${currentFile || ''}\nSCOPE: ${scope}\n\nMANIFEST:\n${JSON.stringify(manifest, null, 2)}\n\n`;
    let used = blob.length;
    const maxChars = 140000;

    for (const p of includePaths.sort()) {
      let content = map.get(p) || '';
      if (content.startsWith('__b64__:')) content = '[BINARY_FILE_BASE64]';
      const chunk = `FILE: ${p}\n\n${content}\n\n---\n\n`;
      if (used + chunk.length > maxChars) break;
      blob += chunk;
      used += chunk.length;
    }

    return blob;
  })();
}

async function sendChat() {
  const input = $('#chatInput');
  const text = String(input.value || '').trim();
  if (!text) return;
  input.value = '';

  const userMsg = { role: 'user', text, createdAt: Date.now() };
  chatMessages.push(userMsg);
  renderChat();
  await appendChatToCloud(userMsg);

  if (!authToken) {
    chatMessages.push({ role: 'assistant', text: 'Sign in to use AI editing.', createdAt: Date.now(), operations: [], applied: false });
    renderChat();
    return;
  }

  const scope = $('#chatScope').value;
  const ctx = await buildAgentContext(scope);
  const prompt = `TASK:\n${text}\n\nPROJECT_CONTEXT:\n${ctx}`;

  // Call server AI proxy (which then calls kAIxU Gate). Server guarantees JSON.
  let result;
  try {
    const modelOverride = localStorage.getItem('KAIXU_MODEL') || null;
    const data = await api('/api/ai-edit', {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: prompt }],
        model: modelOverride || undefined
      }
    });
    result = data.result;
  } catch (e) {
    chatMessages.push({ role: 'assistant', text: `AI error: ${e.message}`, createdAt: Date.now(), operations: [], applied: false });
    renderChat();
    return;
  }

  const assistantMsg = {
    role: 'assistant',
    text: result.reply || result.summary || 'Done.',
    operations: Array.isArray(result.operations) ? result.operations : [],
    createdAt: Date.now(),
    applied: false
  };
  chatMessages.push(assistantMsg);
  renderChat();
  await appendChatToCloud(assistantMsg);

  if ($('#autoApplyEdits').checked && assistantMsg.operations.length) {
    await applyChatEdits(chatMessages.length - 1);
  }
}

// -----------------------------
// Tabs / modals
// -----------------------------

function setActiveTab(name) {
  $$('.tabBtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#files-pane').classList.toggle('hidden', name !== 'files');
  $('#chat-pane').classList.toggle('hidden', name !== 'chat');
  $('#history-pane').classList.toggle('hidden', name !== 'scm');
}

function openTutorial() {
  $('#tutorialModal').classList.remove('hidden');
}
function closeTutorial() {
  $('#tutorialModal').classList.add('hidden');
}

// -----------------------------
// UI bindings
// -----------------------------

function bindEvents() {
  // Side tabs
  $$('.tabBtn').forEach((b) => b.addEventListener('click', () => setActiveTab(b.dataset.tab)));

  // New file modal
  $('#new-file').addEventListener('click', () => {
    $('#new-file-dialog').classList.remove('hidden');
    $('#new-file-path-input').value = '';
    $('#new-file-path-input').focus();
  });
  $('#new-file-cancel').addEventListener('click', () => $('#new-file-dialog').classList.add('hidden'));
  $('#new-file-confirm').addEventListener('click', async () => {
    const p = String($('#new-file-path-input').value || '').trim();
    if (!p) return;
    await writeFile(p, '');
    await refreshFileTree();
    await selectFile(p);
    $('#new-file-dialog').classList.add('hidden');
  });
  $('#new-file-path-input').addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#new-file-confirm').click();
    }
  });

  // Save
  $('#save-file').addEventListener('click', async () => {
    if (!currentFile) return alert('Open a file first.');
    await writeFile(currentFile, editor.getValue());
    await refreshFileTree();
    if (!$('#preview-section').classList.contains('hidden')) await updatePreview();
  });

  // Delete
  $('#delete-file').addEventListener('click', async () => {
    if (!currentFile) return;
    if (!confirm(`Delete ${currentFile}?`)) return;
    await deleteFile(currentFile);
    currentFile = null;
    editor.setValue('');
    await refreshFileTree();
  });

  // Upload
  $('#upload-files').addEventListener('click', () => $('#file-upload').click());
  $('#file-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await importFiles(files);
    e.target.value = '';
  });

  $('#upload-folder').addEventListener('click', () => $('#folder-upload').click());
  $('#folder-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await importFiles(files);
    e.target.value = '';
  });

  // Export
  $('#export-zip').addEventListener('click', exportWorkspaceZip);

  // Search
  $('#search-button').addEventListener('click', async () => {
    const q = String($('#search-input').value || '').trim();
    if (!q) return;
    const files = await listFiles();
    const hits = files.filter(f => String(f.content || '').toLowerCase().includes(q.toLowerCase())).map(f => f.path);
    alert(hits.length ? `Found in:\n${hits.join('\n')}` : 'No matches.');
  });
  $('#replace-button').addEventListener('click', async () => {
    const s = String($('#search-input').value || '');
    const r = String($('#replace-input').value || '');
    if (!s) return;
    const files = await listFiles();
    let count = 0;
    for (const f of files) {
      const c = String(f.content || '');
      if (c.includes(s)) {
        await writeFile(f.path, c.split(s).join(r));
        count++;
      }
    }
    await refreshFileTree();
    alert(`Replaced in ${count} file(s).`);
  });

  // Commit + SCM
  $('#commit-button').addEventListener('click', async () => {
    const msg = String($('#commit-message').value || '').trim();
    await commitWorkspace(msg || 'Commit');
    $('#commit-message').value = '';
    await refreshHistory();
  });
  $('#history-button').addEventListener('click', async () => {
    setActiveTab('scm');
    await refreshHistory();
  });
  $('#revert-button').addEventListener('click', async () => {
    if (!selectedCommitId) return alert('Select a commit in Source tab.');
    if (!confirm(`Revert to #${selectedCommitId}?`)) return;
    await revertToCommit(selectedCommitId);
  });
  $('#export-patch-button').addEventListener('click', async () => {
    if (!selectedCommitId) return alert('Select a commit in Source tab.');
    await exportPatch(selectedCommitId);
  });

  // Preview
  $('#preview-toggle').addEventListener('click', async () => {
    $('#preview-section').classList.toggle('hidden');
    if (!$('#preview-section').classList.contains('hidden')) await updatePreview();
  });
  $('#preview-detach').addEventListener('click', async () => {
    // Prefer /virtual if SW is active; else write HTML directly.
    const swReady = (location.protocol.startsWith('http') && navigator.serviceWorker && (navigator.serviceWorker.controller || (await navigator.serviceWorker.ready).active));
    if (swReady) {
      window.open(`/virtual/index.html?ts=${Date.now()}`, '_blank');
    } else {
      await updatePreview();
      const html = lastPreviewHTML || '<p style="padding:1rem;color:#ccc">No preview</p>';
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    }
  });

  // Cloud sync
  $('#sync-cloud').addEventListener('click', syncToCloud);

  // Tutorial
  $('#tutorial').addEventListener('click', openTutorial);
  $('#tutorialClose').addEventListener('click', closeTutorial);

  // AI settings (model override)
  $('#ai-settings').addEventListener('click', () => {
    const cur = localStorage.getItem('KAIXU_MODEL') || '';
    const next = prompt('Optional: override model (blank = use server default). Example: gemini-2.5-flash', cur);
    if (next === null) return;
    const v = String(next || '').trim();
    if (!v) localStorage.removeItem('KAIXU_MODEL');
    else localStorage.setItem('KAIXU_MODEL', v);
    alert('Saved.');
  });

  // Auth
  $('#authBtn').addEventListener('click', async () => {
    if (authToken && currentUser?.email) {
      const ok = confirm('Sign out?');
      if (!ok) return;
      saveAuthToken(null);
      currentUser = null;
      currentWorkspaceId = null;
      chatMessages = [];
      setUserChip();
      renderChat();
      openAuthModal();
      return;
    }
    openAuthModal();
  });
  $('#authClose').addEventListener('click', closeAuthModal);
  $('#authClose2').addEventListener('click', closeAuthModal);
  $$('.authTabBtn').forEach((b) => b.addEventListener('click', () => {
    $$('.authTabBtn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const which = b.dataset.auth;
    $('#authLogin').classList.toggle('hidden', which !== 'login');
    $('#authSignup').classList.toggle('hidden', which !== 'signup');
  }));
  $('#signupSubmit').addEventListener('click', () => doSignup().catch(e => $('#authStatus').textContent = e.message));
  $('#loginSubmit').addEventListener('click', () => doLogin().catch(e => $('#authStatus').textContent = e.message));

  // Chat
  $('#chatSend').addEventListener('click', () => sendChat());
  $('#chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendChat();
    }
  });

  // Hotkeys
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      $('#save-file').click();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setActiveTab('files');
      $('#search-input').focus();
    }
  });
}

// -----------------------------
// Init
// -----------------------------

async function init() {
  await openDatabase();
  initEditor();
  bindEvents();
  setActiveTab('files');

  setUserChip();

  await registerServiceWorker();

  await refreshFileTree();
  await refreshHistory();

  const ok = await tryRestoreSession();
  if (!ok) {
    // Show auth modal on first load so the user knows it's an account-based IDE
    openAuthModal();
  }

  // First-run tutorial
  const tutSeen = localStorage.getItem('KAIXU_TUTORIAL_SEEN');
  if (!tutSeen) {
    localStorage.setItem('KAIXU_TUTORIAL_SEEN', '1');
    openTutorial();
  }
}

init().catch((e) => {
  console.error(e);
  alert('Startup error: ' + (e?.message || e));
});
