/*
  editor.js — Multi-tab editor + split panes + breadcrumbs + file viewers
  Depends on: db.js, ui.js
*/

// ─── Tab State ─────────────────────────────────────────────────────────────
// Tab: { id, path, pane (0|1), dirty, scrollTop }
var tabs = [];
var activeTabId = null;
var activePane = 0;
var splitActive = false;

var _autoSaveTimers = [null, null];

function _makeId() {
  return Math.random().toString(36).slice(2, 9);
}

// ─── Pane / textarea helpers ───────────────────────────────────────────────
function _getTextarea(pane) {
  return document.getElementById('editor-' + pane);
}

function _getTabBar(pane) {
  return document.getElementById('tabs-' + pane);
}

function _getPaneEl(pane) {
  return document.getElementById('pane-' + pane);
}

function _getViewer(pane) {
  return document.getElementById('file-viewer-' + pane);
}

function _getBreadcrumb(pane) {
  return document.getElementById('breadcrumb-' + pane);
}

// ─── Active editor value ───────────────────────────────────────────────────
// editor compatibility shim so app.js code keeps working
var editor = {
  getValue() {
    const tab = _activeTab();
    if (!tab) return '';
    return _getTextarea(tab.pane)?.value || '';
  },
  setValue(v) {
    const tab = _activeTab();
    if (!tab) return;
    const ta = _getTextarea(tab.pane);
    if (ta) ta.value = v || '';
  }
};

// currentFile compat shim
Object.defineProperty(window, 'currentFile', {
  get() { const t = _activeTab(); return t ? t.path : null; },
  set(v) { /* opening handled via openFileInEditor */ }
});

function _activeTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

function _tabsForPane(pane) {
  return tabs.filter(t => t.pane === pane);
}

// ─── Open a file in the editor ─────────────────────────────────────────────
async function openFileInEditor(path, pane) {
  if (pane === undefined) pane = activePane;

  // If already open in this pane, just activate it
  const existing = tabs.find(t => t.path === path && t.pane === pane);
  if (existing) {
    await _activateTab(existing.id);
    return;
  }

  // If already open in the OTHER pane, duplicate reference to this pane
  const content = await readFile(path);
  const id = _makeId();
  tabs.push({ id, path, pane, dirty: false, scrollTop: 0 });
  _activateTab(id, content);
  _trackRecent(path);
}

// ─── Activate tab ──────────────────────────────────────────────────────────
async function _activateTab(id, preloadedContent) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  // Save scroll position of currently active tab in this pane
  const curActive = tabs.find(t => t.id === activeTabId && t.pane === tab.pane);
  if (curActive) {
    const ta = _getTextarea(curActive.pane);
    if (ta) curActive.scrollTop = ta.scrollTop;
  }

  // Save current textarea content to the previously active tab in same pane
  if (curActive && curActive.id !== id) {
    const ta = _getTextarea(tab.pane);
    if (ta) {
      const value = ta.value;
      if (curActive.dirty) await writeFile(curActive.path, value);
    }
  }

  activeTabId = id;
  activePane = tab.pane;

  const content = preloadedContent !== undefined ? preloadedContent : await readFile(tab.path);
  const ext = tab.path.split('.').pop().toLowerCase();

  const ta = _getTextarea(tab.pane);
  const viewer = _getViewer(tab.pane);

  // Decide: native viewer vs text editor
  if (['png','jpg','jpeg','gif','webp','svg','ico','bmp'].includes(ext)) {
    _showImageViewer(tab, content, viewer, ta);
  } else if (['csv','tsv'].includes(ext)) {
    _showCsvViewer(tab, content, viewer, ta);
  } else if (['md','markdown'].includes(ext)) {
    _showMarkdownViewer(tab, content, viewer, ta);
  } else {
    viewer.classList.add('hidden');
    ta.classList.remove('hidden');
    ta.value = content;
    setTimeout(() => { ta.scrollTop = tab.scrollTop || 0; ta.focus(); }, 0);
  }

  _renderTabBar(tab.pane);
  _renderBreadcrumb(tab.pane, tab.path);

  // Update Outline panel
  if (typeof updateOutline === 'function') updateOutline(content, tab.path);
  // Lint file on open
  if (typeof lintFile === 'function') lintFile(tab.path, content);

  // Trigger preview refresh if preview is open
  if (typeof updatePreview === 'function' && !document.getElementById('preview-section').classList.contains('hidden')) {
    updatePreview();
  }
}

// ─── File type viewers ─────────────────────────────────────────────────────
function _showImageViewer(tab, content, viewer, ta) {
  ta.classList.add('hidden');
  viewer.classList.remove('hidden');
  if (content.startsWith('__b64__:')) {
    const ext = tab.path.split('.').pop().toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : 'image/' + ext;
    viewer.innerHTML = `<div style="text-align:center;padding:20px">
      <img src="data:${mime};base64,${content.slice(8)}" style="max-width:100%;border-radius:6px" />
      <div style="margin-top:8px;opacity:.5;font-size:12px">${tab.path}</div>
    </div>`;
  } else {
    viewer.innerHTML = `<pre style="opacity:.5;font-size:12px">${tab.path} — binary not previewable</pre>`;
  }
}

function _showCsvViewer(tab, content, viewer, ta) {
  ta.classList.add('hidden');
  viewer.classList.remove('hidden');
  const delim = tab.path.endsWith('.tsv') ? '\t' : ',';
  const rows = content.trim().split('\n').map(r => r.split(delim));
  const headers = rows[0] || [];
  let html = `<div style="margin-bottom:8px;font-size:11px;opacity:.5">${tab.path} — ${rows.length - 1} rows</div>`;
  html += '<div style="overflow:auto"><table>';
  html += '<thead><tr>' + headers.map((h, i) => `<th data-col="${i}" style="cursor:pointer" title="Sort">${h}</th>`).join('') + '</tr></thead>';
  html += '<tbody>' + rows.slice(1).map(r => '<tr>' + headers.map((_, i) => `<td>${r[i] || ''}</td>`).join('') + '</tr>').join('') + '</tbody>';
  html += '</table></div>';
  viewer.innerHTML = html;

  let sortCol = -1, sortAsc = true;
  viewer.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = parseInt(th.dataset.col);
      if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = true; }
      const tbody = viewer.querySelector('tbody');
      const sorted = Array.from(tbody.querySelectorAll('tr')).sort((a, b) => {
        const av = a.cells[col]?.textContent || '';
        const bv = b.cells[col]?.textContent || '';
        return sortAsc ? av.localeCompare(bv, undefined, { numeric: true }) : bv.localeCompare(av, undefined, { numeric: true });
      });
      sorted.forEach(r => tbody.appendChild(r));
      viewer.querySelectorAll('th').forEach(t => t.textContent = t.textContent.replace(/[▲▼]/g, ''));
      th.textContent = th.textContent + (sortAsc ? ' ▲' : ' ▼');
    });
  });
}

function _showMarkdownViewer(tab, content, viewer, ta) {
  // Store raw content in textarea (hidden), show rendered in viewer
  ta.value = content;
  ta.classList.add('hidden');
  viewer.classList.remove('hidden');

  // Simple markdown → HTML (headings, bold, italic, code, links, lists)
  const rendered = _simpleMarkdown(content);
  viewer.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button onclick="window._mdToggleEdit(this,'${tab.id}')" style="font-size:11px">← Edit</button>
    </div>
    <div class="md-preview">${rendered}</div>`;
}

window._mdToggleEdit = function(btn, tabId) {
  const t = tabs.find(x => x.id === tabId);
  if (!t) return;
  const ta = _getTextarea(t.pane);
  const viewer = _getViewer(t.pane);
  if (ta.classList.contains('hidden')) {
    ta.classList.remove('hidden');
    viewer.classList.add('hidden');
    ta.focus();
    btn.textContent = 'Preview →';
  } else {
    const rendered = _simpleMarkdown(ta.value);
    viewer.querySelector('.md-preview').innerHTML = rendered;
    ta.classList.add('hidden');
    viewer.classList.remove('hidden');
    btn.textContent = '← Edit';
  }
};

function _simpleMarkdown(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{3} (.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2} (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,.1);padding:1px 4px;border-radius:3px">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
}

// ─── Close tab ─────────────────────────────────────────────────────────────
async function closeTab(id, skipSave = false) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  if (tab.dirty && !skipSave) {
    const ok = confirm(`Save "${tab.path}" before closing?`);
    if (ok) {
      const ta = _getTextarea(tab.pane);
      if (ta) await writeFile(tab.path, ta.value);
    }
  }

  tabs = tabs.filter(t => t.id !== id);

  // Activate next tab in same pane
  const remaining = _tabsForPane(tab.pane);
  if (remaining.length) {
    await _activateTab(remaining[remaining.length - 1].id);
  } else {
    // Pane is empty
    const ta = _getTextarea(tab.pane);
    if (ta) { ta.value = ''; ta.classList.remove('hidden'); }
    const viewer = _getViewer(tab.pane);
    if (viewer) viewer.classList.add('hidden');
    _renderBreadcrumb(tab.pane, null);
    if (activeTabId === id) activeTabId = null;
    if (tab.pane === 1 && _tabsForPane(1).length === 0) {
      // Auto-collapse split if right pane empty
      toggleSplit(false);
    }
  }

  _renderTabBar(tab.pane);
}

// ─── Render tab bar ────────────────────────────────────────────────────────
function _renderTabBar(pane) {
  const bar = _getTabBar(pane);
  if (!bar) return;
  bar.innerHTML = '';

  _tabsForPane(pane).forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.dataset.id = tab.id;

    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tab.path.split('/').pop();
    name.title = tab.path;

    const dirty = document.createElement('span');
    dirty.className = 'tab-dirty';
    dirty.textContent = tab.dirty ? '●' : '';

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.title = 'Close (Ctrl+W)';
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });

    el.appendChild(dirty);
    el.appendChild(name);
    el.appendChild(close);

    el.addEventListener('click', () => _activateTab(tab.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab.id); }); // middle-click

    bar.appendChild(el);
  });
}

// ─── Breadcrumb ────────────────────────────────────────────────────────────
function _renderBreadcrumb(pane, path) {
  const bc = _getBreadcrumb(pane);
  if (!bc) return;
  if (!path) {
    bc.innerHTML = '<span class="bc-empty">No file open</span>';
    return;
  }
  const parts = path.split('/');
  bc.innerHTML = parts.map((p, i) => {
    const builtPath = parts.slice(0, i + 1).join('/');
    return `<span class="bc-seg" title="${builtPath}">${p}</span>`;
  }).join('<span class="bc-sep"> / </span>');
}

// ─── Split pane ────────────────────────────────────────────────────────────
function toggleSplit(force) {
  const pane1 = _getPaneEl(1);
  const handle = document.getElementById('split-handle');
  const pane0 = _getPaneEl(0);

  splitActive = (force !== undefined) ? force : !splitActive;

  if (splitActive) {
    pane1.classList.remove('hidden');
    handle.classList.remove('hidden');
    pane0.style.flex = '1';
    pane1.style.flex = '1';
    toast('Split pane opened · Ctrl+\\ to close');
  } else {
    // Move pane-1 tabs to pane-0 before closing
    const p1tabs = _tabsForPane(1);
    p1tabs.forEach(t => { t.pane = 0; });
    pane1.classList.add('hidden');
    handle.classList.add('hidden');
    pane0.style.flex = '';
    if (p1tabs.length) _renderTabBar(0);
  }
}

function _initSplitHandle() {
  const handle = document.getElementById('split-handle');
  if (!handle) return;
  let dragging = false, startX = 0;
  const pane0 = _getPaneEl(0), pane1 = _getPaneEl(1);

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const section = document.getElementById('editor-section');
    const total = section.offsetWidth;
    const offset = e.clientX - section.getBoundingClientRect().left;
    const pct = Math.max(15, Math.min(85, (offset / total) * 100));
    pane0.style.flex = 'none';
    pane0.style.width = pct + '%';
    pane1.style.flex = '1';
    pane1.style.width = '';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  handle.addEventListener('dblclick', () => {
    pane0.style.flex = '1';
    pane0.style.width = '';
    pane1.style.flex = '1';
    pane1.style.width = '';
  });
}

// ─── Auto-save ─────────────────────────────────────────────────────────────
function _setupAutoSave(pane) {
  const ta = _getTextarea(pane);
  if (!ta) return;

  ta.addEventListener('input', async () => {
    const tab = tabs.find(t => t.pane === pane && t.id === activeTabId) ||
                _tabsForPane(pane).find(t => t.id === activeTabId);
    if (!tab) return;
    tab.dirty = true;
    _renderTabBar(pane);

    clearTimeout(_autoSaveTimers[pane]);

    if (IDE.autoSave === 'keystroke') {
      await _doAutoSave(pane);
    } else if (IDE.autoSave === 'idle') {
      _autoSaveTimers[pane] = setTimeout(() => _doAutoSave(pane), 1000);
    }

    if (!document.getElementById('preview-section').classList.contains('hidden')) {
      clearTimeout(_previewDebounce);
      _previewDebounce = setTimeout(() => { if (typeof updatePreview === 'function') updatePreview(); }, 400);
    }
  });

  ta.addEventListener('blur', async () => {
    if (IDE.autoSave === 'blur') await _doAutoSave(pane);
  });
}

var _previewDebounce = null;

async function _doAutoSave(pane) {
  const tab = _tabsForPane(pane).find(t => t.id === activeTabId) ||
              tabs.find(t => t.pane === pane);
  if (!tab || !tab.path) return;
  const ta = _getTextarea(pane);
  if (!ta || ta.classList.contains('hidden')) return;
  await writeFile(tab.path, ta.value);
  tab.dirty = false;
  _renderTabBar(pane);
  if (typeof refreshFileTree === 'function') refreshFileTree();
  // Lint on save
  if (typeof lintFile === 'function') lintFile(tab.path, ta.value);
}

// ─── Recent files tracking ─────────────────────────────────────────────────
var _recentFiles = [];

function _trackRecent(path) {
  _recentFiles = [path, ..._recentFiles.filter(p => p !== path)].slice(0, 20);
  setMeta('recentFiles', _recentFiles).catch(() => {});
}

async function loadRecentFiles() {
  _recentFiles = (await getMeta('recentFiles', [])) || [];
}

function getRecentFiles() { return _recentFiles; }

// ─── selectFile compat shim (used by app.js) ──────────────────────────────
async function selectFile(path) {
  await openFileInEditor(path, activePane);
}

// ─── Init ──────────────────────────────────────────────────────────────────
function initEditor() {
  _initSplitHandle();
  _setupAutoSave(0);
  _setupAutoSave(1);

  // Split pane button
  document.getElementById('split-btn')?.addEventListener('click', () => toggleSplit());

  applySettings();
}
