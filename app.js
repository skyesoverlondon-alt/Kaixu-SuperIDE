/*
  app.js — kAIxU Super IDE bootstrap, auth, AI chat, preview, commits, sync
  Load order: db.js → ui.js → editor.js → explorer.js → search.js → commands.js → app.js

  Fortune-500 build principles:
  - No provider keys in client code
  - All AI edits route through kAIxU Gate via Netlify Functions
  - Auth + sync uses Neon (Postgres) via Netlify Functions
  - Local-first via IndexedDB
*/

// ─── Tiny helpers ──────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Global state ──────────────────────────────────────────────────────────
var authToken = null;
var currentUser = null;
var currentWorkspaceId = null;
var currentOrgId = null;
var chatMessages = [];
var selectedPaths = new Set();
var selectedCommitId = null;

// ─── Import / Export ───────────────────────────────────────────────────────

function uint8ToBase64(u8) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk)
    s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  return btoa(s);
}

async function importFiles(fileList) {
  const total = fileList.length;
  let done = 0;
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
        const isText = /\.(html|htm|css|js|ts|json|md|txt|xml|svg|sh|py)$/i.test(filename);
        if (isText) {
          await writeFile(filename, await entry.async('string'));
        } else {
          const bytes = await entry.async('uint8array');
          await writeFile(filename, `__b64__:${uint8ToBase64(bytes)}`);
        }
      }
    } else {
      const isText = /^(text\/|application\/json)/i.test(f.type) ||
        /\.(html|htm|css|js|ts|json|md|txt|xml|svg|sh|py)$/i.test(name);
      if (isText) {
        await writeFile(name, await f.text());
      } else {
        const bytes = new Uint8Array(await f.arrayBuffer());
        await writeFile(name, `__b64__:${uint8ToBase64(bytes)}`);
      }
    }
    done++;
    if (total > 10) toast(`Importing… ${done}/${total}`);
  }
  await refreshFileTree();
  try {
    const idx = await readFile('index.html');
    if (idx && !activeTabId) await openFileInEditor('index.html', activePane);
  } catch {}
  if (!$('#preview-section').classList.contains('hidden')) updatePreview();
  toast(`Imported ${done} file${done !== 1 ? 's' : ''}`, 'success');
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
  toast('ZIP exported', 'success');
}

// ─── Selective ZIP export (checked files only) ─────────────────────────────
async function exportSelectedZip() {
  const paths = selectedPaths && selectedPaths.size > 0 ? [...selectedPaths] : null;
  if (!paths) { return exportWorkspaceZip(); }
  const zip = new JSZip();
  for (const path of paths) {
    try {
      const content = await readFile(path);
      if (content.startsWith('__b64__:')) {
        const bin = Uint8Array.from(atob(content.slice(8)), (c) => c.charCodeAt(0));
        zip.file(path, bin);
      } else {
        zip.file(path, content);
      }
    } catch {}
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kaixu-selected.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Exported ${paths.length} file${paths.length !== 1 ? 's' : ''}`, 'success');
}

// ─── Clipboard / paste text import ─────────────────────────────────────────
/*
  Supports pasting blocks of text with file delimiters like:
  === filename.ext ===
  …content…
  === other.js ===
  …
*/
function _parsePastedText(text) {
  const files = {};
  const delimRe = /^={3,}\s*(.+?)\s*={3,}\s*$/m;
  const lines = text.split('\n');
  let curPath = null;
  let curLines = [];
  for (const line of lines) {
    const m = line.match(delimRe);
    if (m) {
      if (curPath && curLines.length) files[curPath] = curLines.join('\n');
      curPath = m[1].trim();
      curLines = [];
    } else if (curPath !== null) {
      curLines.push(line);
    }
  }
  if (curPath && curLines.length) files[curPath] = curLines.join('\n');
  return files;
}

function openPasteModal() {
  const modal = document.getElementById('paste-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.querySelector('#paste-textarea')?.focus();
  }
}

function closePasteModal() {
  document.getElementById('paste-modal')?.classList.add('hidden');
}

async function commitPasteImport() {
  const raw = document.getElementById('paste-textarea')?.value || '';
  const files = _parsePastedText(raw);
  const count = Object.keys(files).length;
  if (!count) {
    toast('No file delimiters found. Use: === filename.js ===', 'error');
    return;
  }
  for (const [path, content] of Object.entries(files)) {
    await writeFile(path, content);
  }
  await refreshFileTree();
  closePasteModal();
  toast(`Imported ${count} file${count !== 1 ? 's' : ''} from clipboard`, 'success');
}

// ─── Local commits (Source Control) ───────────────────────────────────────

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
  try {
    const idx = await readFile('index.html');
    if (idx && !activeTabId) await openFileInEditor('index.html', activePane);
  } catch {}
  if (!$('#preview-section').classList.contains('hidden')) updatePreview();
  await commitWorkspace(`Revert to #${id}`);
  toast(`Reverted to commit #${id}`);
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
    // If the page isn't controlled yet, reload once so /virtual works immediately.
    if (!navigator.serviceWorker.controller && !sessionStorage.getItem('kaixu_sw_reloaded')) {
      sessionStorage.setItem('kaixu_sw_reloaded', '1');
      await navigator.serviceWorker.ready;
      location.reload();
    }
  } catch (e) {
    console.warn('SW register failed', e);
  }
}

async function updatePreview() {
  const frame = $('#preview-frame');
  if (!frame) return;

  // Persist active editor content first
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) {
    const ta = document.getElementById('editor-' + tab.pane);
    if (ta && !ta.classList.contains('hidden')) await writeFile(tab.path, ta.value);
  }

  const swReady = location.protocol.startsWith('http') && navigator.serviceWorker?.controller;
  if (swReady) {
    frame.src = `/virtual/index.html?ts=${Date.now()}`;
    return;
  }

  let html = tab?.path === 'index.html'
    ? (document.getElementById('editor-' + (tab?.pane || 0))?.value || '')
    : await readFile('index.html');

  if (!html) { frame.srcdoc = '<p style="padding:1rem;color:#ccc">No index.html found.</p>'; return; }

  async function inlineAssets(inputHtml, tagRx, wrapFn) {
    let result = inputHtml;
    const tasks = [];
    const rx = new RegExp(tagRx, 'gi');
    let m;
    while ((m = rx.exec(inputHtml)) !== null) {
      const fullTag = m[0], src = m[1];
      if (/^https?:\/\//i.test(src)) continue;
      const p = src.replace(/^\.\//, '');
      tasks.push((async () => {
        let c = tab?.path === p
          ? (document.getElementById('editor-' + (tab?.pane || 0))?.value || '')
          : await readFile(p);
        if (String(c).startsWith('__b64__:')) c = '';
        return { fullTag, replacement: wrapFn(c || '') };
      })());
    }
    (await Promise.all(tasks)).forEach(({ fullTag, replacement }) => { result = result.replace(fullTag, replacement); });
    return result;
  }

  html = await inlineAssets(html, '<script\\s+[^>]*src="([^"]+)"[^>]*><\\/script>', c => `<script>${c}<\/script>`);
  html = await inlineAssets(html, '<link\\s+[^>]*rel=["\']stylesheet["\'][^>]*href="([^"]+)"[^>]*>', c => `<style>${c}<\/style>`);
  frame.srcdoc = html;
  lastPreviewHTML = html;
}

// ─── Orgs + workspaces ─────────────────────────────────────────────────────

function renderOrgSelect(orgs) {
  const sel = $('#orgSelect');
  if (!sel) return;
  sel.innerHTML = '';
  (orgs || []).forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = `${o.name} (${o.role})`;
    sel.appendChild(opt);
  });
  if (currentOrgId) sel.value = currentOrgId;
}

function renderWsSelect(workspaces) {
  const sel = $('#wsSelect');
  if (!sel) return;
  sel.innerHTML = '';
  (workspaces || []).forEach((w) => {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.name;
    sel.appendChild(opt);
  });
  if (currentWorkspaceId) sel.value = currentWorkspaceId;
}

async function refreshOrgsAndWorkspaces() {
  if (!authToken) return;
  const me = await api('/api/auth-me');
  currentUser = me.user;
  setUserChip();
  const orgs = me.orgs || [];
  currentOrgId = me.defaultOrgId || orgs[0]?.id || null;
  renderOrgSelect(orgs);

  if (currentOrgId) {
    const ws = await api(`/api/ws-list?org_id=${encodeURIComponent(currentOrgId)}`);
    renderWsSelect(ws.workspaces || []);
    if (!currentWorkspaceId && ws.workspaces?.[0]?.id) currentWorkspaceId = ws.workspaces[0].id;
  }

  if (currentWorkspaceId) await loadWorkspaceFromCloud(currentWorkspaceId);
  await loadChatFromCloud();
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
  try {
    const idx = await readFile('index.html');
    if (idx && !activeTabId) await openFileInEditor('index.html', activePane);
  } catch {}
  if (!$('#preview-section').classList.contains('hidden')) updatePreview();
}

// ─── Auth ──────────────────────────────────────────────────────────────────

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
  currentOrgId = res.org?.id || res.defaultOrgId || null;
  await refreshOrgsAndWorkspaces();
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
  try {
    const idx = await readFile('index.html');
    if (idx && !activeTabId) await openFileInEditor('index.html', activePane);
  } catch {}
  if (!$('#preview-section').classList.contains('hidden')) updatePreview();

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

async function buildAgentContext(scope) {
  const files = await listFiles();
  const map = new Map(files.map(f => [f.path, f.content || '']));

  // Include the active editor's latest content
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) {
    const ta = document.getElementById('editor-' + tab.pane);
    if (ta) map.set(tab.path, ta.value || '');
  }

  let includePaths = [];
  if (scope === 'active') {
    includePaths = tab ? [tab.path] : ['index.html'];
  } else if (scope === 'selected') {
    includePaths = Array.from(selectedPaths);
    if (!includePaths.length && tab) includePaths = [tab.path];
  } else {
    includePaths = Array.from(map.keys());
  }
  includePaths = includePaths.filter(p => map.has(p));

  const manifest = Array.from(map.keys()).sort().map(p => ({ path: p, bytes: String(map.get(p) || '').length }));
  let blob = `ACTIVE_FILE: ${tab?.path || ''}\nSCOPE: ${scope}\n\nMANIFEST:\n${JSON.stringify(manifest, null, 2)}\n\n`;
  let used = blob.length;
  const maxChars = 140000;
  for (const p of includePaths.sort()) {
    let content = map.get(p) || '';
    if (content.startsWith('__b64__:')) content = '[BINARY_FILE]';
    const chunk = `FILE: ${p}\n\n${content}\n\n---\n\n`;
    if (used + chunk.length > maxChars) break;
    blob += chunk;
    used += chunk.length;
  }
  return blob;
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

// ─── Side tab switcher ─────────────────────────────────────────────────────
function setActiveTab(name) {
  $$('.tabBtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#files-pane')?.classList.toggle('hidden', name !== 'files');
  $('#chat-pane')?.classList.toggle('hidden', name !== 'chat');
  $('#history-pane')?.classList.toggle('hidden', name !== 'scm');
  $('#outline-pane')?.classList.toggle('hidden', name !== 'outline');
  $('#problems-pane')?.classList.toggle('hidden', name !== 'problems');
}

function openTutorial() { $('#tutorialModal')?.classList.remove('hidden'); }
function closeTutorial() { $('#tutorialModal')?.classList.add('hidden'); }

// ─── Events ─────────────────────────────────────────────────────────────────
function bindEvents() {
  // Side tabs
  $$('.tabBtn').forEach((b) => b.addEventListener('click', () => setActiveTab(b.dataset.tab)));

  // New file dialog
  $('#new-file')?.addEventListener('click', () => {
    $('#new-file-dialog').classList.remove('hidden');
    $('#new-file-path-input').value = '';
    $('#new-file-path-input').focus();
  });
  $('#new-file-cancel')?.addEventListener('click', () => $('#new-file-dialog').classList.add('hidden'));
  $('#new-file-confirm')?.addEventListener('click', async () => {
    const p = String($('#new-file-path-input').value || '').trim();
    if (!p) return;
    await writeFile(p, '');
    await refreshFileTree();
    await openFileInEditor(p, activePane);
    $('#new-file-dialog').classList.add('hidden');
  });
  $('#new-file-path-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') $('#new-file-confirm').click();
  });

  // Save (toolbar button — commands.js also handles Ctrl+S)
  $('#save-file')?.addEventListener('click', async () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;
    const ta = document.getElementById('editor-' + tab.pane);
    if (ta && !ta.classList.contains('hidden')) {
      await writeFile(tab.path, ta.value);
      tab.dirty = false;
      _renderTabBar(tab.pane);
      await refreshFileTree();
      if (!$('#preview-section').classList.contains('hidden')) updatePreview();
    }
  });

  // Delete (toolbar button)
  $('#delete-file')?.addEventListener('click', async () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;
    if (!confirm(`Delete ${tab.path}?`)) return;
    await closeTab(tab.id, true);
    await deleteFile(tab.path);
    await refreshFileTree();
  });

  // Upload
  $('#upload-files')?.addEventListener('click', () => $('#file-upload').click());
  $('#file-upload')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await importFiles(files);
    e.target.value = '';
  });
  $('#upload-folder')?.addEventListener('click', () => $('#folder-upload').click());
  $('#folder-upload')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await importFiles(files);
    e.target.value = '';
  });

  // Drag & drop anywhere
  document.body.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
  document.body.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag-over'); });
  document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) await importFiles(files);
  });

  // Export
  $('#export-zip')?.addEventListener('click', exportWorkspaceZip);
  $('#export-selected-zip')?.addEventListener('click', exportSelectedZip);

  // Paste import
  $('#paste-import-btn')?.addEventListener('click', openPasteModal);
  $('#paste-close')?.addEventListener('click', closePasteModal);
  $('#paste-confirm')?.addEventListener('click', commitPasteImport);
  document.getElementById('paste-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'paste-modal') closePasteModal();
  });

  // Commits + SCM
  $('#commit-button')?.addEventListener('click', async () => {
    const msg = String($('#commit-message').value || '').trim();
    await commitWorkspace(msg || 'Commit');
    $('#commit-message').value = '';
    toast('Committed', 'success');
  });
  $('#history-button')?.addEventListener('click', () => { setActiveTab('scm'); refreshHistory(); });
  $('#revert-button')?.addEventListener('click', async () => {
    if (!selectedCommitId) return alert('Select a commit in Source tab first.');
    if (!confirm(`Revert to #${selectedCommitId}?`)) return;
    await revertToCommit(selectedCommitId);
  });
  $('#export-patch-button')?.addEventListener('click', async () => {
    if (!selectedCommitId) return alert('Select a commit in Source tab first.');
    await exportPatch(selectedCommitId);
  });

  // Preview
  $('#preview-toggle')?.addEventListener('click', async () => {
    $('#preview-section').classList.toggle('hidden');
    if (!$('#preview-section').classList.contains('hidden')) updatePreview();
  });
  $('#preview-detach')?.addEventListener('click', async () => {
    await updatePreview();
    const html = lastPreviewHTML || '<p style="padding:1rem;color:#ccc">No preview</p>';
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  });

  // Org/workspace selectors
  $('#orgSelect')?.addEventListener('change', async (e) => {
    currentOrgId = e.target.value;
    currentWorkspaceId = null;
    const ws = await api(`/api/ws-list?org_id=${encodeURIComponent(currentOrgId)}`);
    renderWsSelect(ws.workspaces || []);
    if (ws.workspaces?.[0]?.id) { currentWorkspaceId = ws.workspaces[0].id; await loadWorkspaceFromCloud(currentWorkspaceId); await loadChatFromCloud(); }
  });
  $('#wsSelect')?.addEventListener('change', async (e) => {
    currentWorkspaceId = e.target.value;
    if (currentWorkspaceId) { await loadWorkspaceFromCloud(currentWorkspaceId); await loadChatFromCloud(); }
  });
  $('#newOrgBtn')?.addEventListener('click', async () => {
    const name = prompt('Org name?') || 'New Org';
    await api('/api/org-create', { method: 'POST', body: { name } });
    await refreshOrgsAndWorkspaces();
    toast('Org created', 'success');
  });
  $('#newWsBtn')?.addEventListener('click', async () => {
    if (!currentOrgId) return alert('Select an org first.');
    const name = prompt('Workspace name?') || 'New Workspace';
    await api('/api/ws-create', { method: 'POST', body: { org_id: currentOrgId, name } });
    await refreshOrgsAndWorkspaces();
    toast('Workspace created', 'success');
  });

  // Cloud sync
  $('#sync-cloud')?.addEventListener('click', syncToCloud);

  // Tutorial
  $('#tutorial')?.addEventListener('click', openTutorial);
  $('#tutorialClose')?.addEventListener('click', closeTutorial);

  // AI settings
  $('#ai-settings')?.addEventListener('click', () => {
    const cur = localStorage.getItem('KAIXU_MODEL') || '';
    const next = prompt('Model override (blank = server default):', cur);
    if (next === null) return;
    const v = String(next || '').trim();
    if (!v) localStorage.removeItem('KAIXU_MODEL'); else localStorage.setItem('KAIXU_MODEL', v);
    toast('AI model saved');
  });

  // Auth
  $('#authBtn')?.addEventListener('click', async () => {
    if (authToken && currentUser?.email) {
      if (!confirm('Sign out?')) return;
      saveAuthToken(null);
      currentUser = null; currentWorkspaceId = null;
      chatMessages = []; setUserChip(); renderChat();
      openAuthModal();
    } else { openAuthModal(); }
  });
  $('#authClose')?.addEventListener('click', closeAuthModal);
  $('#authClose2')?.addEventListener('click', closeAuthModal);
  $$('.authTabBtn').forEach((b) => b.addEventListener('click', () => {
    $$('.authTabBtn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const which = b.dataset.auth;
    $('#authLogin')?.classList.toggle('hidden', which !== 'login');
    $('#authSignup')?.classList.toggle('hidden', which !== 'signup');
  }));
  $('#signupSubmit')?.addEventListener('click', () => doSignup().catch(e => { if ($('#authStatus')) $('#authStatus').textContent = e.message; }));
  $('#loginSubmit')?.addEventListener('click', () => doLogin().catch(e => { if ($('#authStatus')) $('#authStatus').textContent = e.message; }));

  // Chat
  $('#chatSend')?.addEventListener('click', () => sendChat());
  $('#chatInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChat(); }
  });

  // Register extra commands in the palette
  if (typeof COMMANDS !== 'undefined') {
    COMMANDS.push(
      { id: 'export-zip', label: 'Export Workspace ZIP', category: 'File', keybinding: '', action: exportWorkspaceZip },
      { id: 'export-selected-zip', label: 'Export Selected Files ZIP', category: 'File', keybinding: '', action: exportSelectedZip },
      { id: 'paste-import', label: 'Import from Pasted Text…', category: 'File', keybinding: '', action: openPasteModal },
    );
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────
async function init() {
  await openDatabase();
  await initSettings();      // ui.js — load + apply IDE settings
  initEditor();              // editor.js — tabs, split pane, auto-save
  initExplorer();            // explorer.js — file tree + context menus
  initSearch();              // search.js — search panel bindings
  initCommands();            // commands.js — palette + keybindings
  initOutline();             // outline.js — symbol outline panel
  initProblems();            // problems.js — lint / problems panel
  initTemplates();           // templates.js — template browser
  bindSettingsModal();       // ui.js — settings modal bindings
  bindEvents();              // app.js — auth, chat, uploads, preview, commits

  setActiveTab('files');
  setUserChip();

  await registerServiceWorker();
  await refreshFileTree();
  await refreshHistory();

  try {
    const idx = await readFile('index.html');
    if (idx) await openFileInEditor('index.html', 0);
  } catch {}

  const ok = await tryRestoreSession();
  if (!ok) openAuthModal();

  if (!localStorage.getItem('KAIXU_TUTORIAL_SEEN')) {
    localStorage.setItem('KAIXU_TUTORIAL_SEEN', '1');
    openTutorial();
  }
}

init().catch((e) => {
  console.error(e);
  alert('Startup error: ' + (e?.message || e));
});
