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

// ─── Accessibility: modal focus trap ───────────────────────────────────────
let _focusTrapCleanup = null;
function _openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove('hidden');
  const focusable = 'button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const els = [...modalEl.querySelectorAll(focusable)];
  if (els.length) els[0].focus();
  if (_focusTrapCleanup) _focusTrapCleanup();
  const trap = (e) => {
    if (e.key !== 'Tab' || modalEl.classList.contains('hidden')) return;
    const f = [...modalEl.querySelectorAll(focusable)];
    if (!f.length) return;
    if (e.shiftKey) {
      if (document.activeElement === f[0]) { e.preventDefault(); f[f.length-1].focus(); }
    } else {
      if (document.activeElement === f[f.length-1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  const esc = (e) => { if (e.key === 'Escape') modalEl.classList.add('hidden'); };
  document.addEventListener('keydown', trap);
  document.addEventListener('keydown', esc);
  _focusTrapCleanup = () => {
    document.removeEventListener('keydown', trap);
    document.removeEventListener('keydown', esc);
    _focusTrapCleanup = null;
  };
}
function _closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add('hidden');
  if (_focusTrapCleanup) _focusTrapCleanup();
}

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

var _importCancelled = false;

function _showZipProgress(label, pct) {
  const modal = document.getElementById('zip-progress-modal');
  const bar = document.getElementById('zip-progress-bar');
  const lbl = document.getElementById('zip-progress-label');
  if (modal) modal.classList.remove('hidden');
  if (bar) bar.value = pct;
  if (lbl) lbl.textContent = label;
}

function _hideZipProgress() {
  const modal = document.getElementById('zip-progress-modal');
  if (modal) modal.classList.add('hidden');
}

async function importFiles(fileList) {
  _importCancelled = false;
  const total = fileList.length;
  let done = 0;

  // Collect all files including ZIP entries to compute total
  const allItems = [];
  for (const f of fileList) {
    const name = (f.webkitRelativePath || f.name || '').trim();
    if (!name) continue;
    if (name.toLowerCase().endsWith('.zip')) {
      allItems.push({ type: 'zip', file: f, name });
    } else {
      allItems.push({ type: 'file', file: f, name });
    }
  }

  const showProgress = allItems.length > 5;
  if (showProgress) _showZipProgress(`Preparing… 0/${allItems.length}`, 0);

  for (const item of allItems) {
    if (_importCancelled) { _hideZipProgress(); toast('Import cancelled', 'error'); return; }

    if (item.type === 'zip') {
      const buf = await item.file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const entries = Object.keys(zip.files).filter(k => !zip.files[k].dir);
      const zipTotal = entries.length;
      let zipDone = 0;
      for (const filename of entries) {
        if (_importCancelled) { _hideZipProgress(); toast('Import cancelled', 'error'); return; }
        const entry = zip.files[filename];
        const isText = /\.(html|htm|css|js|ts|json|md|txt|xml|svg|sh|py|yaml|yml|env|gitignore)$/i.test(filename);
        if (isText) {
          await writeFile(filename, await entry.async('string'));
        } else {
          const bytes = await entry.async('uint8array');
          await writeFile(filename, `__b64__:${uint8ToBase64(bytes)}`);
        }
        zipDone++;
        if (showProgress) {
          _showZipProgress(
            `ZIP: ${filename.split('/').pop()} (${zipDone}/${zipTotal})`,
            Math.round((zipDone / zipTotal) * 100)
          );
        }
      }
    } else {
      const f = item.file;
      const name = item.name;
      const isText = /^(text\/|application\/json)/i.test(f.type) ||
        /\.(html|htm|css|js|ts|json|md|txt|xml|svg|sh|py|yaml|yml)$/i.test(name);
      if (isText) {
        await writeFile(name, await f.text());
      } else {
        const bytes = new Uint8Array(await f.arrayBuffer());
        await writeFile(name, `__b64__:${uint8ToBase64(bytes)}`);
      }
    }
    done++;
    if (showProgress) {
      _showZipProgress(`Processing ${done}/${allItems.length} files…`, Math.round((done / allItems.length) * 100));
    }
  }

  _hideZipProgress();
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

// ─── Export-to-client bundle (ZIP + change report) ───────────────────────
async function exportClientBundle() {
  const zip = new JSZip();
  const files = await listFiles();
  const date  = new Date().toISOString().slice(0, 10);

  // 1. All project files
  for (const f of files) {
    const content = f.content || '';
    if (content.startsWith('__b64__:')) {
      const bin = Uint8Array.from(atob(content.slice(8)), c => c.charCodeAt(0));
      zip.file('project/' + f.path, bin);
    } else {
      zip.file('project/' + f.path, content);
    }
  }

  // 2. Change report (markdown + plain text)
  let report = `# Change Report — ${date}\n\nGenerated by kAIxU SuperIDE\n\n`;
  report += `## Modified Files (${files.length} total)\n\n`;

  // Collect recent commit messages from SCM if available
  let commits = [];
  try {
    const log = typeof getCommitLog === 'function' ? (await getCommitLog()) : [];
    commits = log.slice(0, 20);
  } catch {}

  if (commits.length) {
    report += `## Recent Commits\n\n`;
    commits.forEach(c => {
      report += `- **${c.message || c.msg || 'Commit'}** — ${c.timestamp || c.date || ''}\n`;
    });
    report += `\n`;
  }

  report += `## File Listing\n\n`;
  files.forEach(f => { report += `- \`${f.path}\`\n`; });

  zip.file('CHANGE_REPORT.md', report);
  zip.file('CHANGE_REPORT.txt', report.replace(/[#*`]/g, ''));

  const blob = await zip.generateAsync({ type: 'blob' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `client-bundle-${date}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Client bundle exported', 'success');
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
  // Format A: kAIxU context blobs
  // FILE: path/to/file.ext
  //
  // <content>
  //
  // ---
  const fileBlockRe = /^FILE:\s*(.+?)\s*\n\n([\s\S]*?)(?:\n\n---\n\n|$)/gm;
  const fromBlocks = {};
  let blockMatch;
  while ((blockMatch = fileBlockRe.exec(text)) !== null) {
    const path = (blockMatch[1] || '').trim();
    if (!path) continue;
    fromBlocks[path] = (blockMatch[2] || '').replace(/\s+$/g, '');
  }
  if (Object.keys(fromBlocks).length) return fromBlocks;

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
    toast('No import blocks found. Use === filename.js === or FILE: path blocks', 'error');
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
  // Delegate to diff.js viewer if available, otherwise fall back
  if (typeof _renderHistoryList === 'function') {
    await _renderHistoryList();
  } else {
    const pane = $('#history-pane');
    if (!pane) return;
    const commits = await loadCommits();
    pane.innerHTML = '';
    commits.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'commit';
      row.textContent = `#${c.id} — ${c.message || 'Snapshot'} (${new Date(c.time).toLocaleString()})`;
      pane.appendChild(row);
    });
  }
}

// showCommitDetails is now handled by diff.js
function showCommitDetails(commit) {
  if (typeof _renderDiff === 'function') _renderDiff(commit);
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
  if (typeof markOnboardingStep === 'function') markOnboardingStep('commit');
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

// ─── Apply patch ───────────────────────────────────────────────────────────
function _parsePatch(patchText) {
  // Supports the kAIxU simple diff format (--- a/file, +++ b/file, @@, -/+ lines)
  const changes = [];
  const blocks = patchText.split(/^diff --git /m).filter(Boolean);
  for (const block of blocks) {
    const headerMatch = block.match(/^a\/(.+?) b\/(.+?)[\n\r]/);
    if (!headerMatch) continue;
    const filePath = headerMatch[2].trim();
    const lines = block.split('\n');
    const newContent = [];
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith('@@')) { inHunk = true; continue; }
      if (!inHunk) continue;
      if (line.startsWith('+') && !line.startsWith('+++')) {
        newContent.push(line.slice(1));
      } else if (line === '') {
        // end of hunk
      }
    }
    if (filePath) changes.push({ path: filePath, newContent: newContent.join('\n') });
  }
  return changes;
}

function openApplyPatchModal() {
  const modal = document.getElementById('apply-patch-modal');
  if (modal) {
    modal.classList.remove('hidden');
    document.getElementById('apply-patch-preview').innerHTML = '';
    document.getElementById('apply-patch-input').value = '';
  }
}

function closeApplyPatchModal() {
  document.getElementById('apply-patch-modal')?.classList.add('hidden');
}

async function previewPatch() {
  const text = document.getElementById('apply-patch-input')?.value || '';
  const changes = _parsePatch(text);
  const preview = document.getElementById('apply-patch-preview');
  if (!preview) return;
  if (!changes.length) {
    preview.innerHTML = '<div class="patch-parse-empty">No valid hunks found. Make sure you paste a kAIxU patch file.</div>';
    return;
  }
  preview.innerHTML = '';
  for (const c of changes) {
    const current = await readFile(c.path).catch(() => '');
    const div = document.createElement('div');
    div.className = 'patch-file-block';
    const linesOld = (current || '').split('\n').length;
    const linesNew = c.newContent.split('\n').length;
    div.innerHTML =
      `<div class="patch-file-header">📄 ${c.path} <span class="patch-meta">${linesOld} → ${linesNew} lines</span></div>` +
      `<pre class="patch-diff-preview">${_shortDiff(current, c.newContent)}</pre>`;
    preview.appendChild(div);
  }
}

function _shortDiff(oldText, newText) {
  const old_ = oldText.split('\n'), new_ = newText.split('\n');
  const out = [];
  const max = Math.max(old_.length, new_.length);
  for (let i = 0; i < Math.min(max, 40); i++) {
    const o = old_[i] !== undefined ? old_[i] : null;
    const n = new_[i] !== undefined ? new_[i] : null;
    if (o === n) { out.push('  ' + (o || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')); }
    else {
      if (o !== null) out.push('<span class="pdiff-del">- ' + o.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>');
      if (n !== null) out.push('<span class="pdiff-add">+ ' + n.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>');
    }
  }
  if (max > 40) out.push('<span style="opacity:.4">… ' + (max - 40) + ' more lines</span>');
  return out.join('\n');
}

async function commitApplyPatch() {
  const text = document.getElementById('apply-patch-input')?.value || '';
  const changes = _parsePatch(text);
  if (!changes.length) { toast('No valid hunks to apply', 'error'); return; }
  for (const c of changes) {
    await writeFile(c.path, c.newContent);
  }
  await refreshFileTree();
  closeApplyPatchModal();
  await commitWorkspace(`Applied patch (${changes.length} file${changes.length !== 1 ? 's' : ''})`);
  toast(`Patch applied to ${changes.length} file${changes.length !== 1 ? 's' : ''}`, 'success');
}


// -----------------------------
// Preview (service worker virtual server when possible)
// -----------------------------

let lastPreviewHTML = '';
var _previewLastChangedPath = null;
var _previewDebounceTimer  = null;

// Debounced preview update — call instead of updatePreview() from input events.
// delay defaults to 450ms. Tracks filePath for CSS hot-swap.
function debouncedUpdatePreview(filePath, delay) {
  _previewLastChangedPath = filePath || _previewLastChangedPath;
  if (_previewDebounceTimer) clearTimeout(_previewDebounceTimer);
  _previewDebounceTimer = setTimeout(() => {
    _previewDebounceTimer = null;
    if (!$('#preview-section').classList.contains('hidden')) updatePreview();
  }, delay || 450);
}

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

  // CSS-only hot swap: if only a .css file changed, inject new styles without full reload
  if (_previewLastChangedPath && _previewLastChangedPath.endsWith('.css')) {
    try {
      const cssContent = await readFile(_previewLastChangedPath);
      const frame2 = $('#preview-frame');
      if (frame2?.contentDocument) {
        const sheets = Array.from(frame2.contentDocument.querySelectorAll('style[data-hot]'));
        const hotTag = sheets.find(s => s.dataset.hot === _previewLastChangedPath);
        if (hotTag) { hotTag.textContent = cssContent; _previewLastChangedPath = null; return; }
      }
    } catch { /* fall through to full reload */ }
  }
  _previewLastChangedPath = null;

  const swReady = location.protocol.startsWith('http') && navigator.serviceWorker?.controller;
  const route = document.getElementById('preview-route')?.value || '';
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
  // Inject route for SPA routers
  if (route) {
    const inject = `<script>window.__ROUTE__=${JSON.stringify(route)};history.replaceState(null,'',${JSON.stringify(route)});<\/script>`;
    html = html.replace(/<\/head>/i, inject + '</head>');
  }
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
  // Start presence heartbeat for this workspace
  if (typeof startPresence === 'function') startPresence(workspaceId);
  // Load agent memory for this workspace
  loadAgentMemory().catch(() => {});
}

// ─── Auth ──────────────────────────────────────────────────────────────────

function setUserChip() {
  const chip = $('#userChip');
  if (!chip) return;
  if (currentUser?.email) chip.textContent = currentUser.email;
  else chip.textContent = 'Not signed in';

  // Double-click chip to open security settings (MFA)
  chip.title = currentUser?.email ? 'Double-click to manage MFA / 2FA' : '';
  chip.ondblclick = currentUser?.email ? () => openMfaModal() : null;

  const btn = $('#authBtn');
  if (btn) btn.textContent = currentUser?.email ? 'Sign out' : 'Sign in';

  // Show email verify banner if signed in but unverified
  const banner = document.getElementById('email-verify-banner');
  if (banner) {
    const needsVerify = currentUser?.email && currentUser.email_verified === false;
    banner.classList.toggle('hidden', !needsVerify);
  }
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
    if (typeof ghRefreshStatus === 'function') ghRefreshStatus();
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
  if (typeof ghRefreshStatus === 'function') ghRefreshStatus();
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
  if (typeof ghRefreshStatus === 'function') ghRefreshStatus();
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
      // Plan-mode styling
      if (m.isPlan) {
        div.classList.add('plan-msg');
        const badge = document.createElement('div');
        badge.className = 'chat-plan-badge';
        badge.textContent = '📋 PLAN — review, then click Execute';
        div.insertBefore(badge, body);
      }

      const actions = document.createElement('div');
      actions.className = 'chatActions';

      // Execute Plan button (only on plan messages)
      if (m.isPlan) {
        const btnExec = document.createElement('button');
        btnExec.className = 'plan-execute-btn';
        btnExec.textContent = '▶ Execute Plan';
        btnExec.addEventListener('click', () => {
          const planText = m.text;
          const userMsg = chatMessages.slice(0, idx).reverse().find(x => x.role === 'user');
          const originalTask = userMsg ? userMsg.text : '';
          const input = document.getElementById('chatInput');
          if (input) input.value = `Execute this plan now. Apply all changes as JSON operations (no re-planning).\n\n--- PLAN ---\n${planText}\n\n--- ORIGINAL TASK ---\n${originalTask}`;
          const planCheck = document.getElementById('planMode');
          if (planCheck) planCheck.checked = false;
          sendChat();
        });
        actions.appendChild(btnExec);
      }

      const btnApply = document.createElement('button');
      btnApply.textContent = m.applied ? 'Applied' : 'Apply';
      btnApply.disabled = !!m.applied || (m.isPlan && !m.operations?.length);
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

// Check if any op would delete huge amounts of content
async function _checkLargeDeletion(ops) {
  for (const op of ops) {
    if (op.type !== 'update' && op.type !== 'delete') continue;
    try {
      if (op.type === 'delete') return { path: op.path, reason: 'delete' };
      if (op.type === 'update') {
        const existing = await readFile(op.path);
        if (!existing) continue;
        const newLen = (op.content || '').length;
        const oldLen = existing.length;
        if (oldLen > 200 && newLen < oldLen * 0.3) {
          return { path: op.path, reason: `content shrinks from ${oldLen} to ${newLen} chars (${Math.round(newLen/oldLen*100)}%)` };
        }
      }
    } catch { /* file may not exist */ }
  }
  return null;
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
  const safetyOn = $('#diff-safety')?.checked !== false;

  if (safetyOn) {
    // Gate 1: destructive ops require confirmation
    if (looksDestructive(ops)) {
      const deleteOps = ops.filter(o => o.type === 'delete').map(o => o.path);
      const renameOps = ops.filter(o => o.type === 'rename').map(o => `${o.from} → ${o.to}`);
      const details = [
        deleteOps.length ? `Deleting: ${deleteOps.join(', ')}` : '',
        renameOps.length ? `Renaming: ${renameOps.join(', ')}` : '',
        ops.length >= 10 ? `${ops.length} total operations` : ''
      ].filter(Boolean).join('\n');
      const ok = confirm(`⚠️ Diff Safety Gate\n\nThis AI change is potentially destructive:\n${details}\n\nApply anyway?`);
      if (!ok) return;
    }

    // Gate 2: large deletions require typing "DELETE" to confirm
    const largeDel = await _checkLargeDeletion(ops);
    if (largeDel) {
      const answer = prompt(
        `⚠️ Large Content Removal Detected\n\n"${largeDel.path}" — ${largeDel.reason}\n\nType DELETE to confirm you want to proceed:`
      );
      if ((answer || '').trim() !== 'DELETE') {
        toast('Cancelled — large deletion not confirmed', 'info');
        return;
      }
    }
  }

  const checkpoint = await commitWorkspace('AI Checkpoint');
  msg.checkpointCommitId = checkpoint.id;

  await applyOperations(ops);
  await refreshFileTree();
  try {
    const idx2 = await readFile('index.html');
    if (idx2 && !activeTabId) await openFileInEditor('index.html', activePane);
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

// ─── Agent memory ─────────────────────────────────────────────────────────
var _agentMemory = '';

async function loadAgentMemory() {
  if (!authToken || !currentWorkspaceId) return;
  try {
    const data = await api(`/api/agent-memory?workspaceId=${currentWorkspaceId}`);
    _agentMemory = data.memory || '';
  } catch { _agentMemory = ''; }
}

async function saveAgentMemory(text) {
  if (!authToken || !currentWorkspaceId) { toast('Sign in to save agent memory', 'error'); return; }
  try {
    await api('/api/agent-memory', { method: 'POST', body: { workspaceId: currentWorkspaceId, memory: text } });
    _agentMemory = text;
    toast('Agent memory saved', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function openAgentMemoryModal() {
  const modal = document.getElementById('agent-memory-modal');
  if (!modal) return;
  const ta = document.getElementById('agent-memory-input');
  if (ta) ta.value = _agentMemory;
  modal.classList.remove('hidden');
}

function closeAgentMemoryModal() {
  document.getElementById('agent-memory-modal')?.classList.add('hidden');
}

// ─── Tool mode system prompt prefixes ─────────────────────────────────────
function _getToolModePrefix() {
  const mode = document.getElementById('toolMode')?.value || 'default';
  const prefixes = {
    default: '',
    refactor: `TOOL_MODE: REFACTOR — Focus on code structure only. Split large files into modules, reorganize folders, rename for clarity, eliminate duplication. Do not change behavior or add features.\n\n`,
    security: `TOOL_MODE: SECURITY SCAN — Scan all files for: hardcoded secrets/keys, XSS vulnerabilities, SQL injection risks, unsafe eval/innerHTML, missing input validation, insecure dependencies. Report findings in reply, patch what you can safely fix.\n\n`,
    performance: `TOOL_MODE: PERFORMANCE — Analyze bundle size, identify unused code, suggest code splitting, lazy loading, memoization, and caching opportunities. Apply safe optimizations.\n\n`,
    seo: `TOOL_MODE: SEO — Add/fix meta tags, structured data, semantic HTML, alt text on images, page titles, Open Graph tags, canonical URLs, and sitemap references.\n\n`
  };
  return prefixes[mode] || '';
}

async function sendChat(overrideText) {
  const input = $('#chatInput');
  const text = String(overrideText || input.value || '').trim();
  if (!text) return;
  if (!overrideText) input.value = '';

  const userMsg = { role: 'user', text, createdAt: Date.now() };
  chatMessages.push(userMsg);
  renderChat();
  await appendChatToCloud(userMsg);
  markOnboardingStep('chat');
  _meterAiCall(); // non-blocking usage tracking

  if (!authToken) {
    chatMessages.push({ role: 'assistant', text: 'Sign in to use AI editing.', createdAt: Date.now(), operations: [], applied: false });
    renderChat();
    return;
  }

  const scope = $('#chatScope').value;
  const ctx = await buildAgentContext(scope);
  const isPlanMode = document.getElementById('planMode')?.checked;
  const toolPrefix = _getToolModePrefix();
  const memorySection = _agentMemory ? `\nAGENT_MEMORY (workspace conventions):\n${_agentMemory}\n\n` : '';

  const prompt = isPlanMode
    ? `${toolPrefix}PLAN_MODE: Respond with ONLY a numbered plan listing every file you will change and what you will do. Do NOT output any JSON operations — just the plan. End with "Ready to execute."\n\nTASK:\n${text}${memorySection}\n\nPROJECT_CONTEXT:\n${ctx}`
    : `${toolPrefix}TASK:\n${text}${memorySection}\n\nPROJECT_CONTEXT:\n${ctx}`;

  let result;
  try {
    const modelOverride = localStorage.getItem('KAIXU_MODEL') || null;
    const data = await api('/api/ai-edit', {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: prompt }],
        model: modelOverride || undefined,
        workspaceId: currentWorkspaceId || undefined
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
    isPlan: isPlanMode || false,
    createdAt: Date.now(),
    applied: false
  };
  chatMessages.push(assistantMsg);
  renderChat();
  await appendChatToCloud(assistantMsg);

  // Don't auto-apply plan messages — user must click Execute Plan
  if (!isPlanMode && $('#autoApplyEdits').checked && assistantMsg.operations.length) {
    await applyChatEdits(chatMessages.length - 1);
  }
}

// ─── Watch mode ─────────────────────────────────────────────────────────────
var _watchModeEnabled = false;
var _watchDebounce = null;
var _watchLastContent = new Map();

function toggleWatchMode(enabled) {
  _watchModeEnabled = enabled;
  const btn = document.getElementById('watch-mode-btn');
  if (btn) {
    btn.textContent = enabled ? '👁 Watch: ON' : '👁 Watch: OFF';
    btn.classList.toggle('active', enabled);
  }
  if (enabled) toast('Watch mode ON — saves will trigger AI quick-fix pass', 'info');
  else toast('Watch mode OFF', 'info');
}

// Called from writeFile after each save
async function _watchModeTrigger(path, content) {
  if (!_watchModeEnabled || !authToken) return;
  // Only trigger for changed content to avoid loops
  const prev = _watchLastContent.get(path);
  if (prev === content) return;
  _watchLastContent.set(path, content);

  clearTimeout(_watchDebounce);
  _watchDebounce = setTimeout(async () => {
    const prompt = `WATCH_MODE: File "${path}" was just saved. Scan it for obvious errors, bugs, or broken syntax. If everything looks correct, return empty operations and say "Looks good." Only fix genuine issues — do NOT refactor or add features.`;
    const input = document.getElementById('chatInput');
    const prev = input?.value || '';
    try {
      await sendChat(prompt);
    } finally {
      if (input) input.value = prev;
    }
  }, 1500);
}

// ─── Loop mode ────────────────────────────────────────────────────────────
async function runLoopMode(task, maxIterations) {
  maxIterations = Math.min(parseInt(maxIterations) || 3, 10);
  const loopStatus = document.getElementById('loop-status');
  if (loopStatus) loopStatus.textContent = `Running loop (max ${maxIterations} iterations)…`;

  for (let i = 0; i < maxIterations; i++) {
    if (loopStatus) loopStatus.textContent = `Loop iteration ${i + 1}/${maxIterations}…`;

    const prevLen = chatMessages.length;
    await sendChat(i === 0 ? task : `LOOP_ITERATION ${i + 1}: Review the changes made so far and continue until the task is complete. If done, say "LOOP_COMPLETE" in your reply.`);

    // Wait for response
    await new Promise(r => setTimeout(r, 500));

    // Check if AI says it's done
    const lastMsg = chatMessages[chatMessages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg.text.includes('LOOP_COMPLETE')) {
      if (loopStatus) loopStatus.textContent = `Loop complete after ${i + 1} iteration(s)`;
      toast(`Loop complete after ${i + 1} iterations`, 'success');
      return;
    }

    // Auto-apply if enabled
    if ($('#autoApplyEdits')?.checked && chatMessages.length > prevLen) {
      const idx = chatMessages.length - 1;
      if (chatMessages[idx]?.operations?.length) await applyChatEdits(idx);
    }
  }

  if (loopStatus) loopStatus.textContent = `Loop stopped after ${maxIterations} iterations`;
  toast(`Loop stopped at ${maxIterations} iterations`, 'info');
}

// -----------------------------
// Tabs / modals
// -----------------------------

// ─── Password Reset Modal helpers ─────────────────────────────────────────
function openResetModal() {
  document.getElementById('reset-step-1')?.classList.remove('hidden');
  document.getElementById('reset-step-2')?.classList.add('hidden');
  const st = document.getElementById('reset-status');
  if (st) st.textContent = '';
  document.getElementById('reset-modal')?.classList.remove('hidden');
}

function closeResetModal() {
  document.getElementById('reset-modal')?.classList.add('hidden');
}

async function doResetRequest() {
  const email = (document.getElementById('reset-email')?.value || '').trim();
  const status = document.getElementById('reset-status');
  if (!email) { if (status) status.textContent = 'Enter your email.'; return; }
  const btn = document.getElementById('reset-request-btn');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const data = await api('/api/auth-reset-request', { method: 'POST', body: { email } });
    if (status) status.textContent = data.message || 'Check your email for a reset link.';
    // Dev mode: token returned directly so testers can use it immediately
    if (data.dev_token) {
      const tokenEl = document.getElementById('reset-token');
      if (tokenEl) tokenEl.value = data.dev_token;
    }
    document.getElementById('reset-step-1')?.classList.add('hidden');
    document.getElementById('reset-step-2')?.classList.remove('hidden');
  } catch (e) {
    if (status) status.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Send Reset Link';
  }
}

async function doResetConfirm() {
  const token = (document.getElementById('reset-token')?.value || '').trim();
  const newPassword = (document.getElementById('reset-new-pass')?.value || '').trim();
  const status = document.getElementById('reset-status');
  const btn = document.getElementById('reset-confirm-btn');
  if (!token || !newPassword) { if (status) status.textContent = 'Enter token and new password.'; return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const data = await api('/api/auth-reset-confirm', { method: 'POST', body: { token, newPassword } });
    if (status) status.textContent = data.message || 'Password updated! You can now sign in.';
    setTimeout(closeResetModal, 2000);
  } catch (e) {
    if (status) status.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Set New Password';
  }
}

// ─── Side tab switcher ─────────────────────────────────────────────────────
function setActiveTab(name) {
  $$('.tabBtn').forEach((b) => {
    const active = b.dataset.tab === name;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $('#files-pane')?.classList.toggle('hidden', name !== 'files');
  $('#chat-pane')?.classList.toggle('hidden', name !== 'chat');
  $('#history-pane')?.classList.toggle('hidden', name !== 'scm');
  $('#github-pane')?.classList.toggle('hidden', name !== 'github');
  $('#outline-pane')?.classList.toggle('hidden', name !== 'outline');
  $('#problems-pane')?.classList.toggle('hidden', name !== 'problems');
  $('#activity-pane')?.classList.toggle('hidden', name !== 'activity');
  $('#tasks-pane')?.classList.toggle('hidden', name !== 'tasks');
  // Load activity feed when switching to it
  if (name === 'activity' && typeof loadActivityFeed === 'function') {
    const orgSel = document.getElementById('orgSelect');
    const orgId = orgSel?.value || undefined;
    const wsId = window.currentWorkspaceId || undefined;
    loadActivityFeed(orgId, wsId);
  }
  // Load tasks when switching to tasks pane
  if (name === 'tasks') loadTasks();
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
    markOnboardingStep('upload');
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
    if (files.length) { await importFiles(files); markOnboardingStep('upload'); }
    e.target.value = '';
  });
  $('#upload-folder')?.addEventListener('click', () => $('#folder-upload').click());
  $('#folder-upload')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) { await importFiles(files); markOnboardingStep('upload'); }
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
  $('#apply-patch-button')?.addEventListener('click', openApplyPatchModal);
  $('#apply-patch-confirm')?.addEventListener('click', commitApplyPatch);
  $('#apply-patch-preview-btn')?.addEventListener('click', previewPatch);
  $('#apply-patch-close')?.addEventListener('click', closeApplyPatchModal);

  // Preview
  $('#preview-toggle')?.addEventListener('click', async () => {
    $('#preview-section').classList.toggle('hidden');
    if (!$('#preview-section').classList.contains('hidden')) {
      await _populatePreviewEntry();
      updatePreview();
      markOnboardingStep('preview');
    }
  });
  $('#preview-refresh-btn')?.addEventListener('click', () => updatePreview());
  $('#preview-entry')?.addEventListener('change', () => updatePreview());
  $('#preview-route')?.addEventListener('change', () => updatePreview());
  $('#preview-new-tab-btn')?.addEventListener('click', async () => {
    const frame = document.getElementById('preview-frame');
    if (!frame) return;
    if (frame.src && !frame.src.startsWith('about:')) {
      window.open(frame.src, '_blank');
    } else if (lastPreviewHTML) {
      const blob = new Blob([lastPreviewHTML], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    } else {
      toast('Run preview first', 'error');
    }
  });

  // Device emulation
  $$('.dev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.dev-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const wrap = document.getElementById('preview-frame-wrap');
      const frame = document.getElementById('preview-frame');
      const w = btn.dataset.w;
      if (wrap) { wrap.style.maxWidth = w === '100%' ? '' : w; wrap.style.margin = w === '100%' ? '' : '0 auto'; }
      if (frame) { frame.style.maxWidth = w === '100%' ? '' : w; }
    });
  });

  // Console toggle + clear
  $('#preview-console-toggle')?.addEventListener('click', () => {
    const c = document.getElementById('preview-console');
    if (!c) return;
    c.classList.toggle('hidden');
    const btn = document.getElementById('preview-console-toggle');
    if (btn) btn.textContent = c.classList.contains('hidden') ? '▼ Console' : '▲ Console';
  });
  $('#preview-console-clear')?.addEventListener('click', () => {
    const log = document.getElementById('preview-console-log');
    if (log) log.innerHTML = '';
  });

  // Netlify deploy
  $('#deploy-btn')?.addEventListener('click', () => triggerNetlifyDeploy());

  // Secrets banner dismiss
  $('#secrets-banner-close')?.addEventListener('click', () => {
    document.getElementById('secrets-banner')?.classList.add('hidden');
  });

  // Onboarding
  $('#onboarding-close')?.addEventListener('click', () => closeOnboarding());

  // postMessage console capture from preview iframe
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'kaixu-console') return;
    _appendConsoleLog(e.data.level, e.data.args);
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
    if (currentWorkspaceId) {
      await loadWorkspaceFromCloud(currentWorkspaceId);
      await loadChatFromCloud();
      if (typeof ghRefreshStatus === 'function') ghRefreshStatus();
    }
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

  // Help modal
  $('#help-btn')?.addEventListener('click', openHelpModal);
  $('#help-modal-close')?.addEventListener('click', closeHelpModal);
  document.getElementById('help-search')?.addEventListener('input', (e) => _renderHelpResults(e.target.value));
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
      openHelpModal();
    }
  });

  // Billing modal
  $('#billing-btn')?.addEventListener('click', openBillingModal);
  $('#billing-modal-close')?.addEventListener('click', closeBillingModal);
  $('#billing-modal-close2')?.addEventListener('click', closeBillingModal);
  $('#billing-portal-btn')?.addEventListener('click', _openBillingPortal);

  // ZIP cancel button
  $('#zip-cancel-btn')?.addEventListener('click', () => { _importCancelled = true; });

  // MFA modal (wired from user settings or explicit button if added)
  $('#mfa-modal-close')?.addEventListener('click', closeMfaModal);
  $('#mfa-enable-btn')?.addEventListener('click', enableMfa);
  $('#mfa-disable-btn')?.addEventListener('click', disableMfa);

  // Tasks pane
  $('#task-new-btn')?.addEventListener('click', openNewTaskModal);
  $('#task-refresh-btn')?.addEventListener('click', loadTasks);
  $('#task-save-btn')?.addEventListener('click', saveTask);
  $('#task-modal-close')?.addEventListener('click', closeTaskModal);
  $('#task-filter-status')?.addEventListener('change', loadTasks);
  $('#task-filter-priority')?.addEventListener('change', loadTasks);

  // Reviews modal
  $('#scm-review-btn')?.addEventListener('click', openReviewModal);
  $('#review-submit-btn')?.addEventListener('click', submitReview);
  $('#review-modal-close')?.addEventListener('click', closeReviewModal);

  // Tags modal
  $('#scm-tags-btn')?.addEventListener('click', openTagsModal);
  $('#tag-create-btn')?.addEventListener('click', createTag);
  $('#tags-modal-close')?.addEventListener('click', closeTagsModal);

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

  // Password reset flow
  $('#forgot-pw-btn')?.addEventListener('click', () => { closeAuthModal(); openResetModal(); });
  $('#reset-cancel')?.addEventListener('click', closeResetModal);
  $('#reset-cancel2')?.addEventListener('click', closeResetModal);
  $('#reset-request-btn')?.addEventListener('click', doResetRequest);
  $('#reset-confirm-btn')?.addEventListener('click', doResetConfirm);

  // Demo project loader
  $('#demo-loader-btn')?.addEventListener('click', () => {
    if (typeof openDemoModal === 'function') openDemoModal();
  });

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
      { id: 'paste-import', label: 'Import from Pasted Text…', category: 'File', keybinding: 'Ctrl+Shift+V', kb: 'Ctrl+Shift+V', action: openPasteModal },
      { id: 'apply-patch', label: 'Apply Patch…', category: 'File', keybinding: '', action: openApplyPatchModal },
    );
  }

  // Email verify banner
  $('#resend-verify-btn')?.addEventListener('click', async () => {
    try {
      const data = await api('/api/auth-verify-email', { method: 'POST' });
      toast(data.message || 'Verification email resent', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#email-verify-banner-close')?.addEventListener('click', () => {
    $('#email-verify-banner')?.classList.add('hidden');
  });
}

// ─── Preview helpers ──────────────────────────────────────────────────────
async function _populatePreviewEntry() {
  const sel = document.getElementById('preview-entry');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '';
  const files = await listFiles();
  const htmlFiles = files.map(f => f.path || f).filter(p => /\.html?$/i.test(p));
  if (!htmlFiles.length) htmlFiles.push('index.html');
  htmlFiles.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f; opt.textContent = f;
    if (f === current || (!current && f === 'index.html')) opt.selected = true;
    sel.appendChild(opt);
  });
}

function _appendConsoleLog(level, args) {
  const log = document.getElementById('preview-console-log');
  if (!log) return;
  const line = document.createElement('div');
  line.className = `console-line console-${level}`;
  line.textContent = args.join(' ');
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  // Auto-show console on errors
  if (level === 'error') {
    const panel = document.getElementById('preview-console');
    const btn = document.getElementById('preview-console-toggle');
    if (panel?.classList.contains('hidden')) {
      panel.classList.remove('hidden');
      if (btn) btn.textContent = '▲ Console';
    }
  }
}

// ─── Netlify deploy trigger ───────────────────────────────────────────────
async function triggerNetlifyDeploy() {
  const hook = localStorage.getItem('KAIXU_DEPLOY_HOOK') || IDE.deployHook;
  if (!hook) { toast('No deploy hook set — add it in Settings ⚙', 'warn'); return; }
  try {
    const btn = document.getElementById('deploy-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Deploying…'; }
    const res = await fetch(hook, { method: 'POST' });
    if (res.ok) toast('🚀 Deploy triggered!', 'success');
    else toast('Deploy hook responded ' + res.status, 'error');
  } catch (e) {
    toast('Deploy failed: ' + e.message, 'error');
  } finally {
    const btn = document.getElementById('deploy-btn');
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Deploy'; }
  }
}

// ─── Secrets scanner ──────────────────────────────────────────────────────
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY/,
  /AIza[0-9A-Za-z\-_]{35}/,
  /api[_\-]?key\s*[:=]\s*['"][^'"]{10,}/i,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}/i,
];

function _runSecretsCheck(text) {
  const banner = document.getElementById('secrets-banner');
  if (!banner) return;
  const found = SECRET_PATTERNS.some(rx => rx.test(text));
  banner.classList.toggle('hidden', !found);
}

function initSecretsScanner() {
  // Watch all editor textareas for secrets + trigger debounced preview
  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('editor-area')) {
      _runSecretsCheck(e.target.value);
      // Find active tab path for CSS hot-swap detection
      const activeTab = tabs.find(t => t.id === activeTabId);
      debouncedUpdatePreview(activeTab?.path || null, 450);
    }
  });
}

// ─── Onboarding checklist ─────────────────────────────────────────────────
const ONBOARDING_STEPS = ['upload', 'preview', 'chat', 'commit', 'github'];

function initOnboarding() {
  const done = _onboardingDone();
  if (done.size >= ONBOARDING_STEPS.length) return; // all complete
  _renderOnboardingChecks();
  // Show only for fresh users (no workspace files and no auth token)
  const isNew = !localStorage.getItem('KAIXU_AUTH_TOKEN');
  if (isNew) document.getElementById('onboarding-modal')?.classList.remove('hidden');
}

function _onboardingDone() {
  try { return new Set(JSON.parse(localStorage.getItem('KAIXU_ONBOARDING') || '[]')); } catch { return new Set(); }
}

function _renderOnboardingChecks() {
  const done = _onboardingDone();
  ONBOARDING_STEPS.forEach(step => {
    const el = document.querySelector(`#onboarding-list .onboard-item[data-step="${step}"]`);
    if (el) el.dataset.done = done.has(step) ? '1' : '0';
  });
  const progress = document.getElementById('ob-progress');
  if (progress) progress.textContent = `${done.size} / ${ONBOARDING_STEPS.length} complete`;
  // Show complete message if all done
  if (done.size >= ONBOARDING_STEPS.length) {
    document.getElementById('onboarding-complete-msg')?.classList.remove('hidden');
  }
}

function markOnboardingStep(step) {
  const done = _onboardingDone();
  done.add(step);
  localStorage.setItem('KAIXU_ONBOARDING', JSON.stringify([...done]));
  _renderOnboardingChecks();
  if (done.size >= ONBOARDING_STEPS.length) {
    toast('🎉 Onboarding complete!', 'success');
    closeOnboarding();
  }
}

function closeOnboarding() {
  document.getElementById('onboarding-modal')?.classList.add('hidden');
}

// ─── Global Error Reporting ─────────────────────────────────────────────────

async function _reportClientError(err, type) {
  try {
    const message = err?.message || String(err);
    const stack = err?.stack || '';
    await fetch('/.netlify/functions/error-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack, type, url: location.href })
    });
  } catch {} // Never throw from error reporter
}

window.addEventListener('error', (e) => {
  _reportClientError(e.error || e.message, 'uncaught');
});
window.addEventListener('unhandledrejection', (e) => {
  _reportClientError(e.reason, 'unhandledrejection');
});

// ─── Offline Queue Sync ─────────────────────────────────────────────────────

var _offlineQueue = []; // { fn, label }

function _queueOffline(label, fn) {
  _offlineQueue.push({ label, fn });
  toast(`Offline — queued: ${label}`, 'error');
}

async function _flushOfflineQueue() {
  if (!_offlineQueue.length) return;
  toast(`Back online — syncing ${_offlineQueue.length} queued save${_offlineQueue.length !== 1 ? 's' : ''}…`);
  const queue = [..._offlineQueue];
  _offlineQueue = [];
  for (const item of queue) {
    try {
      await item.fn();
    } catch (err) {
      _offlineQueue.push(item); // Re-queue on failure
    }
  }
  if (!_offlineQueue.length) toast('All offline changes synced ✓', 'success');
  else toast(`${_offlineQueue.length} save(s) still failing`, 'error');
}

window.addEventListener('online', _flushOfflineQueue);

// ─── Help Modal ─────────────────────────────────────────────────────────────────

const HELP_DOCS = [
  { cat: 'Editor', kw: 'new file create', title: 'Create a New File', body: 'Click "New File" in the toolbar, or press Ctrl+N. Enter a path like src/index.js.' },
  { cat: 'Editor', kw: 'save file ctrl+s', title: 'Save a File', body: 'Files auto-save every 2 seconds. Press Ctrl+S to save immediately.' },
  { cat: 'Editor', kw: 'split pane dual editor', title: 'Split Editor Pane', body: 'Click the ⬜⬜ button or press Ctrl+\\ to enable a split view.' },
  { cat: 'Editor', kw: 'tab breadcrumb navigate', title: 'Tabs & Breadcrumbs', body: 'Each pane has its own tabs. Click the breadcrumb to navigate directories.' },
  { cat: 'Editor', kw: 'format code autoformat', title: 'Format Document', body: 'Click "{ }" in the toolbar or press Shift+Alt+F to run the auto-formatter.' },
  { cat: 'Editor', kw: 'find replace search', title: 'Find & Replace', body: 'Press Ctrl+H in the editor textarea. Use Ctrl+Shift+F  for workspace search.' },
  { cat: 'Editor', kw: 'snippet tab expand', title: 'Code Snippets', body: 'Type a snippet prefix and press Tab to expand. Manage in the Snippets panel.' },
  { cat: 'Chat', kw: 'ai chat send message', title: 'Chat with kAIxU', body: 'Type in the Chat pane and click Send (or Ctrl+Enter). kAIxU edits your files.' },
  { cat: 'Chat', kw: 'auto apply edits', title: 'Auto-Apply Edits', body: 'With "Auto-apply" checked, AI edits are applied instantly. Uncheck to review first.' },
  { cat: 'Chat', kw: 'diff safety gate large deletion', title: 'Diff Safety', body: 'Diff Safety prevents the AI from deleting >40% of a file at once. Toggle in toolbar.' },
  { cat: 'AI Modes', kw: 'tool mode refactor security performance seo', title: 'AI Tool Modes', body: 'Select a mode (Refactor, Security, Performance, SEO) to give the AI a specialized context.' },
  { cat: 'AI Modes', kw: 'watch mode auto save', title: 'Watch Mode', body: 'Enables automatic AI passes on every save. Configure the prompt in the Watch Mode settings.' },
  { cat: 'AI Modes', kw: 'loop mode repeat iteration', title: 'Loop Mode', body: 'Runs the AI in a loop up to N times. Enter a task, set the iteration count, click Loop.' },
  { cat: 'AI Modes', kw: 'agent memory workspace conventions', title: 'Agent Memory', body: 'Click 🧠 Memory to set workspace conventions (e.g. "use TypeScript strict mode"). Injected into every AI call.' },
  { cat: 'Source Control', kw: 'commit history revert', title: 'Committing Changes', body: 'Enter a commit message in the toolbar and click Commit. Use History to browse & revert.' },
  { cat: 'Source Control', kw: 'branches create switch merge', title: 'Branches', body: 'Click ⌘ Branches in the Source tab to create, switch, merge, or delete branches.' },
  { cat: 'Source Control', kw: 'stash save changes temporarily', title: 'Stash', body: 'Enter a stash message and click Stash to save pending changes. Click Pop to restore.' },
  { cat: 'Source Control', kw: 'blame line author history', title: 'Git Blame', body: 'Click 📋 Blame in the Source tab to see line-by-line commit annotations.' },
  { cat: 'Source Control', kw: 'tags release version', title: 'Tags', body: 'Click 🏷 Tags to create and manage lightweight tags (e.g., v1.0.0) on commits.' },
  { cat: 'Source Control', kw: 'protected branch lock', title: 'Protected Branches', body: 'Lock a branch via the Branches modal. Protected branches block direct commits from non-admins.' },
  { cat: 'Source Control', kw: 'review code request', title: 'Review Requests', body: 'Click 🔍 Review in the Source tab to create a code review request for collaborators.' },
  { cat: 'Preview', kw: 'preview toggle live', title: 'Toggle Preview', body: 'Click "Toggle Preview" to show the live preview iframe.' },
  { cat: 'Preview', kw: 'device emulation mobile tablet desktop', title: 'Device Emulation', body: 'Use the 🖥 📱 buttons in the preview toolbar to switch screen widths.' },
  { cat: 'Preview', kw: 'route spa navigation', title: 'SPA Route Preview', body: 'Enter a route like /about in the route input. It\'s injected as window.__ROUTE__ for SPA routers.' },
  { cat: 'Preview', kw: 'new tab open browser', title: 'Open in New Tab', body: 'Click the 🗗 button in the preview toolbar to open the preview in a new browser tab.' },
  { cat: 'Preview', kw: 'console log debug', title: 'Preview Console', body: 'Click ▼ Console to see console.log output from the preview iframe.' },
  { cat: 'Files', kw: 'import upload zip folder', title: 'Import Files / ZIP', body: 'Click Upload or Folder to import files. ZIP files are extracted automatically with a progress bar.' },
  { cat: 'Files', kw: 'export download zip', title: 'Export Workspace ZIP', body: 'Click "Export ZIP" to download all workspace files as a .zip.' },
  { cat: 'Files', kw: 'paste import text', title: 'Paste Import', body: 'Click 📋 Paste to import code pasted as a structured text block.' },
  { cat: 'Tasks', kw: 'task issue create assign', title: 'Tasks & Issues', body: 'Open the Tasks tab in the sidebar. Click "+ New" to create a task. Assign, prioritize, and track status.' },
  { cat: 'Admin', kw: 'admin panel usage members', title: 'Admin Panel', body: 'Click 🛡 Admin to view usage stats, manage members, invites, webhooks, and settings.' },
  { cat: 'Admin', kw: 'mfa two factor authenticator', title: 'Enable MFA (2FA)', body: 'Open Security settings or the user menu → MFA. Scan the QR code with an authenticator app.' },
  { cat: 'Admin', kw: 'teams groups permissions', title: 'Teams', body: 'Create teams in the Admin panel → Teams tab. Grant teams access to specific workspaces.' },
  { cat: 'Admin', kw: 'workspace delete transfer ownership', title: 'Workspace Admin', body: 'Use ws-admin API or Admin panel to soft-delete or transfer workspace ownership.' },
  { cat: 'Admin', kw: 'webhook event notification', title: 'Webhooks', body: 'In Admin → Webhooks, add a URL and select events (ws.save, chat.append, etc.) to receive.' },
  { cat: 'Shortcuts', kw: 'keyboard shortcut hotkey', title: 'Keyboard Shortcuts', body: 'Ctrl+S: Save | Ctrl+N: New file | Ctrl+\\: Split | Ctrl+Shift+P: Command palette | Ctrl+Shift+F: Search | Ctrl+Enter: Send chat | ?: Help' },
];

function openHelpModal() {
  const modal = document.getElementById('help-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  _renderHelpResults('');
  document.getElementById('help-search')?.focus();
}

function closeHelpModal() {
  document.getElementById('help-modal')?.classList.add('hidden');
}

function _renderHelpResults(query) {
  const container = document.getElementById('help-results');
  if (!container) return;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? HELP_DOCS.filter(d => d.title.toLowerCase().includes(q) || d.kw.includes(q) || d.cat.toLowerCase().includes(q) || d.body.toLowerCase().includes(q))
    : HELP_DOCS;
  if (!filtered.length) {
    container.innerHTML = '<div style="opacity:.5;font-size:13px;text-align:center;padding:20px">No results found.</div>';
    return;
  }
  container.innerHTML = filtered.map(d => `
    <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px 12px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
        <span style="font-size:10px;background:#4c1d95;color:#c4b5fd;padding:2px 6px;border-radius:999px">${d.cat}</span>
        <span style="font-size:13px;font-weight:600;color:#e2d9f3">${d.title}</span>
      </div>
      <div style="font-size:12px;opacity:.75;line-height:1.5">${d.body}</div>
    </div>`).join('');
}

// ─── MFA Modal ─────────────────────────────────────────────────────────────

async function openMfaModal() {
  const modal = document.getElementById('mfa-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  if (!authToken) { toast('Sign in first', 'error'); return; }
  try {
    const res = await fetch('/.netlify/functions/auth-mfa-setup', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!data.ok) { document.getElementById('mfa-status').textContent = data.error; return; }
    if (data.mfaEnabled) {
      document.getElementById('mfa-setup-view').classList.add('hidden');
      document.getElementById('mfa-enabled-view').classList.remove('hidden');
    } else {
      document.getElementById('mfa-setup-view').classList.remove('hidden');
      document.getElementById('mfa-enabled-view').classList.add('hidden');
      document.getElementById('mfa-secret-display').textContent = `Secret: ${data.secret}`;
      // Render QR as link (no canvas QR lib — show the otpauth URL)
      const wrap = document.getElementById('mfa-qr-placeholder');
      if (wrap) {
        wrap.innerHTML = `<a href="${data.qrUrl}" target="_blank" style="font-size:11px;color:#a259ff;word-break:break-all">Open in Authenticator App →</a><br/><div style="font-size:10px;opacity:.5;margin-top:4px">(or copy the secret above)</div>`;
      }
    }
  } catch (err) {
    document.getElementById('mfa-status').textContent = 'Error loading MFA status';
  }
}

function closeMfaModal() {
  document.getElementById('mfa-modal')?.classList.add('hidden');
}

async function enableMfa() {
  const token = document.getElementById('mfa-token-input')?.value?.trim();
  if (!token || token.length !== 6) { document.getElementById('mfa-status').textContent = 'Enter a 6-digit code'; return; }
  try {
    const res = await fetch('/.netlify/functions/auth-mfa-setup', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (data.ok) {
      document.getElementById('mfa-status').textContent = '✅ MFA enabled!';
      setTimeout(openMfaModal, 1000); // Refresh to show enabled view
    } else {
      document.getElementById('mfa-status').textContent = data.error || 'Failed';
    }
  } catch { document.getElementById('mfa-status').textContent = 'Network error'; }
}

async function disableMfa() {
  const token = document.getElementById('mfa-disable-token-input')?.value?.trim();
  if (!token || token.length !== 6) { document.getElementById('mfa-disable-status').textContent = 'Enter a 6-digit code'; return; }
  try {
    const res = await fetch('/.netlify/functions/auth-mfa-disable', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (data.ok) {
      toast('MFA disabled', 'success');
      closeMfaModal();
    } else {
      document.getElementById('mfa-disable-status').textContent = data.error || 'Failed';
    }
  } catch { document.getElementById('mfa-disable-status').textContent = 'Network error'; }
}

// ─── Tasks / Issues ─────────────────────────────────────────────────────────

var _tasks = [];

async function loadTasks() {
  if (!authToken || !currentWorkspaceId) return;
  const status = document.getElementById('task-filter-status')?.value || '';
  const params = new URLSearchParams({ workspaceId: currentWorkspaceId });
  if (status) params.set('status', status);
  try {
    const res = await fetch(`/.netlify/functions/tasks?${params}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    if (data.ok) { _tasks = data.tasks; _renderTasksList(); }
  } catch {}
}

function _renderTasksList() {
  const list = document.getElementById('tasks-list');
  if (!list) return;
  if (!_tasks.length) {
    list.innerHTML = '<div style="opacity:.4;font-size:12px;text-align:center;padding:20px">No tasks yet. Click + New to create one.</div>';
    return;
  }
  const priorityColors = { high: '#f87171', medium: '#fbbf24', low: '#4ade80' };
  const statusIcons = { open: '○', in_progress: '◑', done: '●' };
  list.innerHTML = _tasks.map(t => `
    <div class="task-card" data-id="${t.id}" style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px 12px;cursor:pointer">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <span style="color:${priorityColors[t.priority] || '#888'};font-size:16px;line-height:1" title="${t.priority} priority">●</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#e2d9f3;margin-bottom:2px">${t.title}</div>
          ${t.description ? `<div style="font-size:11px;opacity:.6;margin-bottom:4px">${t.description}</div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:10px;opacity:.7">
            <span>${statusIcons[t.status] || '○'} ${t.status.replace('_',' ')}</span>
            ${t.due_date ? `<span>📅 ${t.due_date}</span>` : ''}
            ${t.assignee_email ? `<span>👤 ${t.assignee_email}</span>` : ''}
          </div>
        </div>
        <button onclick="event.stopPropagation();openEditTaskModal('${t.id}')" style="font-size:11px;padding:2px 6px">Edit</button>
        <button onclick="event.stopPropagation();deleteTask('${t.id}')" style="font-size:11px;padding:2px 6px;background:#7f1d1d">Del</button>
      </div>
    </div>`).join('');
}

function openNewTaskModal() {
  const modal = document.getElementById('task-modal');
  if (!modal) return;
  document.getElementById('task-modal-title').textContent = 'New Task';
  document.getElementById('task-edit-id').value = '';
  document.getElementById('task-title-input').value = '';
  document.getElementById('task-desc-input').value = '';
  document.getElementById('task-priority-select').value = 'medium';
  document.getElementById('task-status-select').value = 'open';
  document.getElementById('task-due-input').value = '';
  modal.classList.remove('hidden');
}

function openEditTaskModal(id) {
  const task = _tasks.find(t => t.id === id);
  if (!task) return;
  const modal = document.getElementById('task-modal');
  if (!modal) return;
  document.getElementById('task-modal-title').textContent = 'Edit Task';
  document.getElementById('task-edit-id').value = id;
  document.getElementById('task-title-input').value = task.title;
  document.getElementById('task-desc-input').value = task.description || '';
  document.getElementById('task-priority-select').value = task.priority;
  document.getElementById('task-status-select').value = task.status;
  document.getElementById('task-due-input').value = task.due_date || '';
  modal.classList.remove('hidden');
}

function closeTaskModal() {
  document.getElementById('task-modal')?.classList.add('hidden');
}

async function saveTask() {
  const id = document.getElementById('task-edit-id')?.value;
  const title = document.getElementById('task-title-input')?.value?.trim();
  if (!title) { toast('Title required', 'error'); return; }
  const body = {
    title,
    description: document.getElementById('task-desc-input')?.value || '',
    priority: document.getElementById('task-priority-select')?.value || 'medium',
    status: document.getElementById('task-status-select')?.value || 'open',
    dueDate: document.getElementById('task-due-input')?.value || null,
    workspaceId: currentWorkspaceId
  };
  if (id) body.id = id;
  try {
    const res = await fetch('/.netlify/functions/tasks', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.ok) {
      closeTaskModal();
      toast(id ? 'Task updated' : 'Task created', 'success');
      await loadTasks();
    } else {
      toast(data.error || 'Save failed', 'error');
    }
  } catch { toast('Network error', 'error'); }
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await fetch(`/.netlify/functions/tasks?id=${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    toast('Task deleted', 'success');
    await loadTasks();
  } catch { toast('Network error', 'error'); }
}

// ─── Review Requests ─────────────────────────────────────────────────────────

async function openReviewModal() {
  const modal = document.getElementById('review-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  await _loadReviews();
}

function closeReviewModal() {
  document.getElementById('review-modal')?.classList.add('hidden');
}

async function _loadReviews() {
  if (!authToken || !currentWorkspaceId) return;
  try {
    const res = await fetch(`/.netlify/functions/reviews?workspaceId=${currentWorkspaceId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!data.ok) return;
    const list = document.getElementById('review-list-view');
    if (!list) return;
    const statusColors = { pending: '#fbbf24', approved: '#4ade80', changes_requested: '#f87171', closed: '#888' };
    list.innerHTML = data.reviews.length
      ? data.reviews.map(r => `
          <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px 12px">
            <div style="font-size:13px;font-weight:600;margin-bottom:2px">${r.title}</div>
            <div style="display:flex;gap:8px;font-size:10px;opacity:.7">
              <span style="color:${statusColors[r.status] || '#888'}">${r.status.replace('_',' ')}</span>
              <span>by ${r.creator_email}</span>
              <span>${new Date(r.created_at).toLocaleDateString()}</span>
            </div>
          </div>`).join('')
      : '<div style="opacity:.4;font-size:12px;text-align:center;padding:12px">No reviews yet.</div>';
  } catch {}
}

async function submitReview() {
  const title = document.getElementById('review-title-input')?.value?.trim();
  if (!title) { toast('Title required', 'error'); return; }
  const description = document.getElementById('review-desc-input')?.value || '';
  try {
    const res = await fetch('/.netlify/functions/reviews', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: currentWorkspaceId, title, description })
    });
    const data = await res.json();
    if (data.ok) {
      toast('Review request created', 'success');
      document.getElementById('review-title-input').value = '';
      document.getElementById('review-desc-input').value = '';
      await _loadReviews();
    } else {
      toast(data.error || 'Failed', 'error');
    }
  } catch { toast('Network error', 'error'); }
}

// ─── Tags Modal ──────────────────────────────────────────────────────────────

async function openTagsModal() {
  const modal = document.getElementById('tags-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  _renderTagsList();
}

function closeTagsModal() {
  document.getElementById('tags-modal')?.classList.add('hidden');
}

function _renderTagsList() {
  const list = document.getElementById('tags-list');
  if (!list) return;
  const tags = typeof scmListTags === 'function' ? scmListTags() : [];
  list.innerHTML = tags.length
    ? tags.map(t => `
        <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.04);border-radius:6px;padding:6px 10px">
          <span style="font-size:13px;color:#c4b5fd;flex:1">🏷 ${t.name}</span>
          <span style="font-size:11px;opacity:.5">${t.message || ''}</span>
          <button onclick="scmDeleteTag('${t.name}').then(()=>_renderTagsList())" style="font-size:10px;padding:2px 6px;background:#7f1d1d">Del</button>
        </div>`).join('')
    : '<div style="opacity:.4;font-size:12px;text-align:center;padding:12px">No tags yet.</div>';
}

function createTag() {
  const name = document.getElementById('tag-name-input')?.value?.trim();
  const message = document.getElementById('tag-message-input')?.value?.trim() || '';
  if (!name) { toast('Tag name required', 'error'); return; }
  if (typeof scmCreateTag === 'function') {
    scmCreateTag(name, message);
    document.getElementById('tag-name-input').value = '';
    document.getElementById('tag-message-input').value = '';
    _renderTagsList();
    toast(`Tag ${name} created`, 'success');
  }
}

// ─── Billing ───────────────────────────────────────────────────────────────
let _billingData = null;

async function openBillingModal() {
  const modal = document.getElementById('billing-modal');
  if (!modal) return;
  _openModal(modal);
  const currentPlanEl = document.getElementById('billing-current-plan');
  const plansListEl   = document.getElementById('billing-plans-list');
  if (currentPlanEl) currentPlanEl.textContent = 'Loading…';
  if (plansListEl)   plansListEl.innerHTML     = '';

  try {
    const orgId = document.getElementById('orgSelect')?.value || '';
    const res   = await fetch(`/.netlify/functions/billing-plans${orgId ? '?orgId=' + orgId : ''}`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    const data = res.ok ? await res.json() : null;
    _billingData = data;

    // Render current plan
    if (currentPlanEl) {
      const sub = data?.subscription;
      if (sub) {
        const renewDate = sub.current_period_end
          ? new Date(sub.current_period_end).toLocaleDateString() : '—';
        currentPlanEl.innerHTML = `
          <strong>Current plan:</strong> ${sub.plan_name || 'Unknown'} &nbsp;
          <span style="text-transform:capitalize;color:${sub.status === 'active' ? '#4ade80' : '#f87171'}">(${sub.status})</span><br>
          <small style="opacity:.6">Renews ${renewDate} · ${sub.ai_calls_limit === -1 ? 'Unlimited' : sub.ai_calls_limit + ' AI calls/mo'} · ${sub.seats_limit === -1 ? 'Unlimited' : sub.seats_limit} seat(s)</small>`;
        const portalBtn = document.getElementById('billing-portal-btn');
        if (portalBtn) portalBtn.style.display = '';
      } else {
        currentPlanEl.innerHTML = '<strong>Current plan:</strong> Free (no active subscription)';
      }
    }

    // Render plan cards
    if (plansListEl && data?.plans) {
      plansListEl.innerHTML = data.plans.map(p => {
        const price = p.price_cents === 0 ? 'Free'
          : `$${(p.price_cents / 100).toFixed(0)}/mo`;
        const isActive = data.subscription?.plan_slug === p.slug;
        const isFree   = p.slug === 'free';
        const features = (Array.isArray(p.features) ? p.features : JSON.parse(p.features || '[]'));
        return `
          <div style="border:1px solid ${isActive ? '#7c3aed' : 'rgba(255,255,255,.1)'};border-radius:8px;padding:14px;position:relative">
            ${isActive ? '<div style="position:absolute;top:8px;right:8px;font-size:10px;background:#7c3aed;padding:2px 6px;border-radius:3px">Current</div>' : ''}
            <div style="font-weight:700;font-size:15px">${p.name}</div>
            <div style="font-size:20px;font-weight:800;margin:4px 0">${price}</div>
            <div style="font-size:11px;opacity:.6;margin-bottom:8px">${p.description || ''}</div>
            <ul style="font-size:11px;padding:0 0 0 16px;margin:0 0 10px;opacity:.8">
              ${features.map(f => `<li>${f}</li>`).join('')}
            </ul>
            ${isActive || isFree ? '' : `<button onclick="_upgradePlan('${p.stripe_price_id}')" style="width:100%;font-size:12px">Upgrade</button>`}
          </div>`;
      }).join('');
    }
  } catch (err) {
    if (currentPlanEl) currentPlanEl.textContent = 'Failed to load plans.';
    console.error('[billing]', err);
  }
  // Load invoice history asynchronously
  loadBillingInvoices();
}

function closeBillingModal() {
  _closeModal(document.getElementById('billing-modal'));
}

async function _upgradePlan(priceId) {
  if (!priceId) { toast('This plan is not yet available for purchase.', 'info'); return; }
  if (!authToken) { toast('Sign in to upgrade your plan', 'error'); return; }
  try {
    const res  = await fetch('/.netlify/functions/billing-create-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ priceId, orgId: document.getElementById('orgSelect')?.value || '' }),
    });
    const data = await res.json();
    if (data.alreadySubscribed) {
      toast('You already have an active subscription. Use "Manage Subscription" to change plans.', 'info');
      return;
    }
    if (data.url) window.open(data.url, '_blank');
    else toast('Failed to start checkout: ' + (data.error || 'unknown error'), 'error');
  } catch (err) {
    toast('Billing error: ' + err.message, 'error');
  }
}

async function _openBillingPortal() {
  if (!authToken) { toast('Sign in first', 'error'); return; }
  try {
    const res  = await fetch('/.netlify/functions/billing-portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ returnUrl: location.href }),
    });
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank');
    else toast(data || 'Could not open billing portal', 'error');
  } catch (err) {
    toast('Billing portal error: ' + err.message, 'error');
  }
}

async function loadBillingInvoices() {
  const el = document.getElementById('billing-invoices-list');
  if (!el || !authToken) return;
  el.innerHTML = '<div style="color:#888;font-size:12px">Loading invoices…</div>';
  try {
    const orgId = document.getElementById('orgSelect')?.value || '';
    const qs = orgId ? `?orgId=${orgId}` : '';
    const res  = await fetch(`/.netlify/functions/billing-invoices${qs}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const data = await res.json();
    const invoices = data.invoices || [];
    if (!invoices.length) {
      el.innerHTML = '<div style="color:#888;font-size:12px">No invoices yet.</div>';
      return;
    }
    el.innerHTML = invoices.map(inv => {
      const amt  = ((inv.amountPaid || inv.amountDue || 0) / 100).toFixed(2);
      const cur  = (inv.currency || 'usd').toUpperCase();
      const date = inv.created ? new Date(inv.created * 1000).toLocaleDateString() : '';
      const badge = inv.status === 'paid'
        ? '<span style="color:#4ade80">✓ Paid</span>'
        : `<span style="color:#f87171">${inv.status}</span>`;
      const links = [
        inv.pdfUrl    ? `<a href="${inv.pdfUrl}" target="_blank" style="color:#a78bfa;font-size:11px">PDF</a>` : '',
        inv.hostedUrl ? `<a href="${inv.hostedUrl}" target="_blank" style="color:#a78bfa;font-size:11px">View</a>` : '',
      ].filter(Boolean).join(' · ');
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #2a2a3e;font-size:12px">
        <span>${date} — ${inv.planName || inv.number || inv.id}</span>
        <span>${badge} &nbsp; ${cur} ${amt} &nbsp; ${links}</span>
      </div>`;
    }).join('');
    if (data.hasMore) {
      el.innerHTML += '<div style="color:#888;font-size:11px;margin-top:6px">Showing latest 10 · Use Stripe portal to see all</div>';
    }
  } catch (err) {
    el.innerHTML = `<div style="color:#f87171;font-size:12px">Error: ${err.message}</div>`;
  }
}

// Meter an AI call (best-effort — never breaks app)
async function _meterAiCall() {
  try {
    fetch('/.netlify/functions/usage-meter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify({
        event: 'ai_call',
        workspaceId: currentWorkspaceId || undefined,
        orgId: currentOrgId || undefined,
      }),
    }).catch(() => {}); // fire-and-forget
  } catch { /* ignore */ }
}

// ─── RAG: Sync embeddings ──────────────────────────────────────────────────
async function syncEmbeddings() {
  if (!authToken) { toast('Sign in to sync embeddings', 'error'); return; }
  if (!currentWorkspaceId) { toast('Open a workspace first', 'error'); return; }

  // Collect all text files from IndexedDB
  toast('Indexing codebase for AI…', 'info');
  try {
    const req = indexedDB.open('SuperIDE');
    const db  = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
    const tx       = db.transaction('files', 'readonly');
    const store    = tx.objectStore('files');
    const allFiles = await new Promise((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror   = () => rej(r.error);
    });

    // Filter to text files only (skip very large or binary)
    const TEXT_EXTS = /\.(js|ts|jsx|tsx|mjs|cjs|html|htm|css|scss|less|json|jsonc|md|txt|yaml|yml|toml|env|sh|bash|zsh|py|rb|go|rs|java|c|cpp|h|hpp|cs|php|sql|graphql|svelte|vue|astro|xml|csv|ini|cfg|conf)$/i;
    const files = allFiles
      .filter(f => TEXT_EXTS.test(f.path) && typeof f.content === 'string' && f.content.length < 100000)
      .map(f => ({ path: f.path, content: f.content }));

    if (!files.length) { toast('No text files to index', 'info'); return; }

    // Split into batches of 20 files
    const batchSize = 20;
    let totalSynced = 0;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const res   = await fetch('/.netlify/functions/embeddings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body:    JSON.stringify({ action: 'sync', workspaceId: currentWorkspaceId, files: batch }),
      });
      const data = await res.json();
      if (!res.ok) { toast(`Sync error: ${data}`, 'error'); return; }
      totalSynced += data.synced || 0;
    }
    toast(`✓ Indexed ${totalSynced} chunks from ${files.length} files`, 'success');
  } catch (err) {
    toast('Embedding sync failed: ' + err.message, 'error');
  }
}

// ─── RAG: Semantic file search ─────────────────────────────────────────────
async function semanticSearch(query) {
  if (!authToken || !currentWorkspaceId) return [];
  try {
    const res = await fetch(
      `/.netlify/functions/embeddings?workspaceId=${encodeURIComponent(currentWorkspaceId)}&q=${encodeURIComponent(query)}&limit=5`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    const data = await res.json();
    return data.results || [];
  } catch { return []; }
}

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
  initSnippets();            // snippets.js — snippet manager + Tab expansion
  if (typeof initGitHub === 'function') initGitHub(); // github.js — push/pull
  if (typeof initDiff === 'function')   initDiff();   // diff.js — commit history viewer
  if (typeof initDemo === 'function')   initDemo();   // demo.js — starter project loader
  if (typeof initScm === 'function')    initScm();    // scm.js — branches, stash, blame
  if (typeof initAdmin === 'function')  initAdmin();  // admin.js — admin panel
  if (typeof initCollab === 'function') initCollab(); // collab.js — presence, activity, share
  if (typeof checkKeybindingConflicts === 'function') checkKeybindingConflicts();
  initSecretsScanner();      // app.js — secrets pattern watcher
  bindSettingsModal();       // ui.js — settings modal bindings
  bindEvents();              // app.js — auth, chat, uploads, preview, commits

  // Watch mode toggle
  const watchChk = document.getElementById('watchMode');
  if (watchChk) watchChk.addEventListener('change', e => toggleWatchMode(e.target.checked));

  // Loop mode button
  const loopBtn = document.getElementById('loop-mode-btn');
  if (loopBtn) loopBtn.addEventListener('click', () => {
    const task = document.getElementById('chatInput')?.value?.trim();
    if (!task) { toast('Enter a task first', 'error'); return; }
    const iters = parseInt(document.getElementById('loopCount')?.value) || 3;
    runLoopMode(task, iters);
  });

  // Agent memory modal save
  const amSave = document.getElementById('agent-memory-save-btn');
  if (amSave) amSave.addEventListener('click', () => {
    const val = document.getElementById('agent-memory-input')?.value || '';
    saveAgentMemory(val);
    closeAgentMemoryModal();
  });
  const amClose = document.getElementById('agent-memory-modal-close');
  if (amClose) amClose.addEventListener('click', closeAgentMemoryModal);
  const amBtn = document.getElementById('agent-memory-btn');
  if (amBtn) amBtn.addEventListener('click', openAgentMemoryModal);

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

  initOnboarding();

  if (!localStorage.getItem('KAIXU_TUTORIAL_SEEN')) {
    localStorage.setItem('KAIXU_TUTORIAL_SEEN', '1');
    openTutorial();
  }
}

init().catch((e) => {
  console.error(e);
  alert('Startup error: ' + (e?.message || e));
});
